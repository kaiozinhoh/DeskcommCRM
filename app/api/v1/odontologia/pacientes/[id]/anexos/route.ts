/**
 * ANEXOS DO PRONTUÁRIO (Fatia 7) — exame, raio-x, prontuário externo escaneado. O arquivo mora
 * no bucket privado `odontologia-anexos` (migration 0727); esta tabela só referencia (DIRC).
 *
 * GET  lista os anexos do paciente, com signed URL (1h — é visualização, não envio).
 * POST sobe um arquivo (multipart/form-data, campo `file`) — PDF ou imagem, até 10 MB (mesmo
 *      limite do bucket). `agent`+, mesmo degrau de quem registra o atendimento que o exame
 *      acompanha.
 *
 * Módulo opcional (ADR-0002): enquanto `odontologia` não está instalado, a tabela não existe e
 * o Postgres devolve 42P01 — traduzido aqui, nunca um 500 cru.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BUCKET = "odontologia-anexos";
const TAMANHO_MAXIMO = 10 * 1024 * 1024; // 10 MB — mesmo limite do bucket (migration 0727)

const MODULO_NAO_INSTALADO =
  "O módulo de odontologia não está instalado nesta instalação. Peça ao administrador para " +
  "instalar em Configurações da instalação › Módulos.";

function moduloNaoInstalado(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

// Mesma allowlist do bucket (migration 0727) — a extensão sai do MIME aceito, nunca do que o
// browser mandou em `file.name` (igual à doutrina de app/api/v1/ai/knowledge/sources/upload).
const EXTENSAO_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

interface Params {
  params: Promise<{ id: string }>;
}

async function pacienteDaOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pacienteId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase.from("odontologia_pacientes").select("id").eq("id", pacienteId).maybeSingle();
  return (data as { id: string } | null) ?? null;
}

export async function GET(_req: NextRequest, { params }: Params): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "odontologia_prontuario_anexos" });
  if (!authz.ok) return authz.response;
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("odontologia_prontuario_anexos")
    .select("id, nome_arquivo, tipo_mime, tamanho_bytes, storage_path, created_at")
    .eq("paciente_id", id)
    .order("created_at", { ascending: false });
  if (error) {
    if (moduloNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const linhas = (data ?? []) as Array<{
    id: string;
    nome_arquivo: string;
    tipo_mime: string;
    tamanho_bytes: number;
    storage_path: string;
    created_at: string;
  }>;

  const admin = createAdminClient();
  const comUrl = await Promise.all(
    linhas.map(async (a) => {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(a.storage_path, 60 * 60);
      return {
        id: a.id,
        nome_arquivo: a.nome_arquivo,
        tipo_mime: a.tipo_mime,
        tamanho_bytes: a.tamanho_bytes,
        created_at: a.created_at,
        url: signed?.signedUrl ?? null,
      };
    }),
  );

  return ok(comUrl, { requestId });
}

export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "odontologia_prontuario_anexos" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id: pacienteId } = await params;
  const orgId = authz.org.orgId;

  const supabase = await createClient();
  const paciente = await pacienteDaOrg(supabase, pacienteId);
  if (!paciente) {
    return fail("not_found", t("Paciente não encontrado."), 404, { requestId });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return fail("invalid_request", t("Falha ao processar o envio do arquivo."), 400, { requestId });
  }
  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return fail("invalid_request", t("Nenhum arquivo foi enviado."), 400, { requestId });
  }
  const file = fileEntry;

  if (file.size > TAMANHO_MAXIMO) {
    return fail("payload_too_large", t("O arquivo passa de 10 MB."), 413, { requestId });
  }
  const ext = EXTENSAO_POR_MIME[file.type];
  if (!ext) {
    return fail(
      "unsupported_media_type",
      t("Envie PDF ou imagem (PNG, JPEG ou WEBP)."),
      415,
      { requestId },
    );
  }

  const admin = createAdminClient();
  const storagePath = `${orgId}/${pacienteId}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadErr) {
    return fail("internal_error", t("Erro ao guardar o arquivo."), 500, { requestId });
  }

  const { data: anexo, error: insertErr } = await supabase
    .from("odontologia_prontuario_anexos")
    .insert({
      organization_id: orgId,
      paciente_id: pacienteId,
      storage_path: storagePath,
      nome_arquivo: file.name || t("Arquivo sem nome"),
      tipo_mime: file.type,
      tamanho_bytes: file.size,
      created_by: authz.user.id,
    })
    .select("id")
    .single();
  if (insertErr || !anexo) {
    await admin.storage.from(BUCKET).remove([storagePath]);
    if (moduloNaoInstalado(insertErr)) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", insertErr?.message ?? t("Erro ao registrar o anexo."), 500, { requestId });
  }
  const anexoId = (anexo as { id: string }).id;

  await audit({
    action: "odontologia.prontuario_anexo_criado",
    resourceType: "odontologia_prontuario_anexo",
    resourceId: anexoId,
    requestId,
    metadata: { paciente_id: pacienteId, nome_arquivo: file.name, tipo_mime: file.type },
  });

  return ok({ id: anexoId }, { requestId, status: 201 });
}
