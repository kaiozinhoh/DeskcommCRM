/**
 * PROCEDIMENTOS DA CLÍNICA ODONTOLÓGICA — cadastro (nome, duração, valor de referência).
 *
 * Módulo opcional (ADR-0002): a tabela só existe depois que o administrador da instalação
 * instala `odontologia` em `/admin/modulos`. Enquanto não instalado, o Postgres devolve 42P01
 * (tabela inexistente) — traduzido aqui para uma mensagem clara, nunca um 500 cru.
 *
 * ⚠️ CLIENT DE SESSÃO. A RLS da migration 0721 já exige `manager`+ para escrever; a rota cobra
 * o mesmo degrau por clareza de mensagem, não como segunda régua de autoridade.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MODULO_NAO_INSTALADO =
  "O módulo de odontologia não está instalado nesta instalação. Peça ao administrador para " +
  "instalar em Configurações da instalação › Módulos.";

function moduloNaoInstalado(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

const CAMPOS = "id, nome, duracao_min, valor_referencia_cents, ativo, ordem, created_at, updated_at";

const criarSchema = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório."),
  duracao_min: z.number().int().min(1).default(30),
  valor_referencia_cents: z.number().int().min(1).nullish(),
  ordem: z.number().int().default(0),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "odontologia_procedimentos" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const ativo = url.searchParams.get("ativo");

  const supabase = await createClient();
  let q = supabase
    .from("odontologia_procedimentos")
    .select(CAMPOS)
    .order("ordem", { ascending: true })
    .order("nome", { ascending: true })
    .limit(500);
  if (ativo === "true") q = q.eq("ativo", true);
  else if (ativo === "false") q = q.eq("ativo", false);

  const { data, error } = await q;
  if (error) {
    if (moduloNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("manager", { requestId, resource: "odontologia_procedimentos" });
  if (!authz.ok) return authz.response;

  const lido = criarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("odontologia_procedimentos")
    .insert({
      organization_id: authz.org.orgId,
      nome: lido.data.nome,
      duracao_min: lido.data.duracao_min,
      valor_referencia_cents: lido.data.valor_referencia_cents ?? null,
      ordem: lido.data.ordem,
    })
    .select(CAMPOS)
    .single();

  if (error) {
    if (moduloNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "odontologia.procedimento_criado",
    resourceType: "odontologia_procedimento",
    resourceId: data.id,
    requestId,
    metadata: { nome: data.nome },
  });

  return ok(data, { requestId, status: 201 });
}
