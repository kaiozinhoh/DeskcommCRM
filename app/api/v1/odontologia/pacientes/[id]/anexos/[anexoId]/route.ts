/**
 * DELETE /api/v1/odontologia/pacientes/[id]/anexos/[anexoId] — remove um anexo do prontuário.
 *
 * `manager`+ (anexo errado é correção — mesma régua do resto do módulo). Remove o OBJETO do
 * storage primeiro: se falhar, a linha do banco continua existindo e o anexo segue aparecendo
 * (fail-safe — nunca referência quebrada apontando para arquivo já apagado).
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

const MODULO_NAO_INSTALADO =
  "O módulo de odontologia não está instalado nesta instalação. Peça ao administrador para " +
  "instalar em Configurações da instalação › Módulos.";

function moduloNaoInstalado(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

interface Params {
  params: Promise<{ id: string; anexoId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Params): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("manager", { requestId, resource: "odontologia_prontuario_anexos" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id: pacienteId, anexoId } = await params;

  const supabase = await createClient();
  const { data: anexo, error: erroAnexo } = await supabase
    .from("odontologia_prontuario_anexos")
    .select("id, storage_path")
    .eq("id", anexoId)
    .eq("paciente_id", pacienteId)
    .maybeSingle();
  if (erroAnexo) {
    if (moduloNaoInstalado(erroAnexo)) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", erroAnexo.message, 500, { requestId });
  }
  if (!anexo) return fail("not_found", t("Anexo não encontrado."), 404, { requestId });
  const storagePath = (anexo as { storage_path: string }).storage_path;

  const admin = createAdminClient();
  const { error: removeErr } = await admin.storage.from(BUCKET).remove([storagePath]);
  if (removeErr) {
    return fail("internal_error", t("Erro ao remover o arquivo. Tente de novo."), 500, { requestId });
  }

  const { error: deleteErr } = await supabase.from("odontologia_prontuario_anexos").delete().eq("id", anexoId);
  if (deleteErr) {
    return fail("internal_error", deleteErr.message, 500, { requestId });
  }

  await audit({
    action: "odontologia.prontuario_anexo_removido",
    resourceType: "odontologia_prontuario_anexo",
    resourceId: anexoId,
    requestId,
    metadata: { paciente_id: pacienteId },
  });

  return ok({ id: anexoId }, { requestId });
}
