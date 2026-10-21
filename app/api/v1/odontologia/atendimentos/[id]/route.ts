/**
 * PATCH /api/v1/odontologia/atendimentos/[id] — registra o desfecho (concluído/faltou) ou
 * corrige um atendimento já registrado.
 *
 * ⚠️ A régua fina de autoridade é desta rota, não da RLS (migration 0722 é o piso, `agent`+):
 * enquanto o atendimento está `agendado` (ainda não aconteceu), registrar o desfecho é trabalho
 * normal de `agent`+. Depois que ele sai de `agendado` (concluído/faltou/cancelado — já
 * aconteceu), qualquer edição é CORREÇÃO e exige `manager`+ — e toda correção emite
 * `odontologia.atendimento_corrigido` em vez de `odontologia.atendimento_registrado`.
 *
 * Não muda os procedimentos do atendimento (isso só acontece na criação, Fatia 4 escolhe o
 * previsto ao marcar); esta rota só move o DESFECHO e os campos do que aconteceu na cadeira.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MODULO_NAO_INSTALADO =
  "O módulo de odontologia não está instalado nesta instalação. Peça ao administrador para " +
  "instalar em Configurações da instalação › Módulos.";

const CAMPOS =
  "id, contact_id, appointment_id, dentista_user_id, dente_regiao, observacao, " +
  "valor_cobrado_cents, status, data_hora, created_at, updated_at";

const edicaoSchema = z
  .object({
    status: z.enum(["agendado", "concluido", "faltou", "cancelado"]).optional(),
    dentista_user_id: z.string().uuid().nullable().optional(),
    dente_regiao: z.string().trim().max(120).nullable().optional(),
    observacao: z.string().trim().max(2000).nullable().optional(),
    valor_cobrado_cents: z.number().int().min(1).nullable().optional(),
    data_hora: z.string().datetime({ offset: true }).optional(),
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
  const authz = await requireRole("agent", { requestId, resource: "odontologia_atendimentos" });
  if (!authz.ok) return authz.response;

  const parsed = edicaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();

  const { data: antes, error: erroLeitura } = await supabase
    .from("odontologia_atendimentos")
    .select("status")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (erroLeitura) {
    if (erroLeitura.code === "42P01") {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", erroLeitura.message, 500, { requestId });
  }
  if (!antes) {
    return fail("not_found", "Atendimento não encontrado.", 404, { requestId });
  }

  // Já saiu de "agendado" (já aconteceu, de um jeito ou de outro): editar agora é CORREÇÃO.
  const ehCorrecao = antes.status !== "agendado";
  if (ehCorrecao && !roleAtLeast(authz.org.role, "manager")) {
    return fail(
      "forbidden_role",
      "Corrigir um atendimento já registrado exige papel de gerente ou administrador.",
      403,
      { requestId },
    );
  }

  // `.single()` numa tabela que ainda não está em `lib/database.types.ts` (módulo recém-criado,
  // sem `db push` nesta sandbox) infere `GenericStringError`; o cast é só o fallback de tipo,
  // os dados vêm certos do PostgREST.
  const { data, error } = await supabase
    .from("odontologia_atendimentos")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select(CAMPOS)
    .single();
  const atendimento = data as { id: string } | null;

  if (error) {
    if (error.code === "42P01") {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    if (error.code === "PGRST116") {
      return fail("not_found", "Atendimento não encontrado.", 404, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!atendimento) {
    return fail("not_found", "Atendimento não encontrado.", 404, { requestId });
  }

  await audit({
    action: ehCorrecao ? "odontologia.atendimento_corrigido" : "odontologia.atendimento_registrado",
    resourceType: "odontologia_atendimento",
    resourceId: atendimento.id,
    requestId,
    metadata: { campos: Object.keys(parsed.data), status_anterior: antes.status },
  });

  return ok(atendimento, { requestId });
}
