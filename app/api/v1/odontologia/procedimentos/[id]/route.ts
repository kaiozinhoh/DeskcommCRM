/**
 * PATCH /api/v1/odontologia/procedimentos/[id] — edita ou arquiva um procedimento.
 *
 * Arquivar é `ativo: false`, nunca DELETE — a tela não oferece apagar porque um procedimento
 * já usado num atendimento não pode sumir do histórico (a FK de atendimento_procedimentos, na
 * fatia seguinte, aponta para este id).
 *
 * ⚠️ O `.eq("organization_id", ...)` não é decoração: sem ele o PATCH casaria 0 linhas num
 * procedimento de outra organização e o PostgREST devolveria `PGRST116` — que esta rota já
 * traduz para 404, o desfecho certo (CLAUDE.md).
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

const CAMPOS = "id, nome, duracao_min, valor_referencia_cents, ativo, ordem, created_at, updated_at";

const edicaoSchema = z
  .object({
    nome: z.string().trim().min(1).optional(),
    duracao_min: z.number().int().min(1).optional(),
    valor_referencia_cents: z.number().int().min(1).nullable().optional(),
    ordem: z.number().int().optional(),
    ativo: z.boolean().optional(),
  })
  // PATCH vazio gravaria só o `updated_at` e devolveria 200: a tela diria
  // "salvo" sobre uma edição que não existiu.
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar." });

interface Contexto {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: Contexto): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "odontologia_procedimentos" });
  if (!authz.ok) return authz.response;

  const parsed = edicaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("odontologia_procedimentos")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select(CAMPOS)
    .single();

  if (error) {
    if (error.code === "42P01") {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    if (error.code === "PGRST116") {
      return fail("not_found", "Procedimento não encontrado.", 404, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const soArquivou = Object.keys(parsed.data).length === 1 && parsed.data.ativo === false;

  await audit({
    action: soArquivou ? "odontologia.procedimento_arquivado" : "odontologia.procedimento_atualizado",
    resourceType: "odontologia_procedimento",
    resourceId: data.id,
    requestId,
    metadata: { campos: Object.keys(parsed.data) },
  });

  return ok(data, { requestId });
}
