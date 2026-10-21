/**
 * PACIENTE — detalhe (GET) e arquivar/reativar (PATCH). Ver route.ts (lista/criação) para o
 * desenho geral da Fatia 6.
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

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Params): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "odontologia_pacientes" });
  if (!authz.ok) return authz.response;
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("odontologia_pacientes")
    .select("id, contact_id, ativo, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (moduloNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) return fail("not_found", "Paciente não encontrado.", 404, { requestId });

  const paciente = data as { id: string; contact_id: string; ativo: boolean; created_at: string; updated_at: string };
  const { data: contato } = await supabase
    .from("contacts")
    .select("id, name, display_name, phone_number, tags")
    .eq("id", paciente.contact_id)
    .maybeSingle();

  return ok({ ...paciente, contact: contato ?? null }, { requestId });
}

const patchSchema = z.object({ ativo: z.boolean() });

export async function PATCH(req: NextRequest, { params }: Params): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  // Arquivar/reativar é manager+ — mesma régua de quem corrige um atendimento já registrado.
  const authz = await requireRole("manager", { requestId, resource: "odontologia_pacientes" });
  if (!authz.ok) return authz.response;
  const { id } = await params;

  const lido = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("odontologia_pacientes")
    .update({ ativo: lido.data.ativo, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    if (moduloNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) return fail("not_found", "Paciente não encontrado.", 404, { requestId });

  await audit({
    action: lido.data.ativo ? "odontologia.paciente_reativado" : "odontologia.paciente_arquivado",
    resourceType: "odontologia_paciente",
    resourceId: id,
    requestId,
  });

  return ok({ id, ativo: lido.data.ativo }, { requestId });
}
