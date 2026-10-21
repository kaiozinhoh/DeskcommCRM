/**
 * PACIENTES (Fatia 6) — o cadastro próprio, separado do Contato (migration 0726).
 *
 * GET  lista os pacientes da organização (join com `contacts` em duas consultas FLAT — ver o
 *      comentário de `procedimentosPorAtendimento` em ../atendimentos/route.ts, mesmo motivo:
 *      a tabela é recém-criada e `lib/database.types.ts` ainda não a conhece). Busca/tag/ordenação
 *      ficam na tela (lista limitada a 500, suficiente para uma clínica).
 * POST cadastra um contato existente como paciente — idempotente (ver `garantirPaciente`):
 *      chamar duas vezes com o mesmo `contact_id` devolve o mesmo cadastro, nunca duplica.
 *
 * Módulo opcional (ADR-0002): enquanto `odontologia` não está instalado, a tabela não existe e
 * o Postgres devolve 42P01 — traduzido aqui, nunca um 500 cru.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { garantirPaciente } from "@/lib/odontologia/garantir-paciente";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MODULO_NAO_INSTALADO =
  "O módulo de odontologia não está instalado nesta instalação. Peça ao administrador para " +
  "instalar em Configurações da instalação › Módulos.";

function moduloNaoInstalado(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

interface PacienteLinha {
  id: string;
  contact_id: string;
  ativo: boolean;
  created_at: string;
}
interface ContatoResumo {
  id: string;
  name: string | null;
  display_name: string | null;
  phone_number: string | null;
  tags: string[] | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "odontologia_pacientes" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const ativoParam = url.searchParams.get("ativo");

  const supabase = await createClient();
  let q = supabase
    .from("odontologia_pacientes")
    .select("id, contact_id, ativo, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (ativoParam === "true") q = q.eq("ativo", true);
  if (ativoParam === "false") q = q.eq("ativo", false);
  // ativoParam ausente ou "all": sem filtro — a tela decide o que mostrar.

  const { data, error } = await q;
  if (error) {
    if (moduloNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const pacientes = (data ?? []) as PacienteLinha[];
  const contactIds = pacientes.map((p) => p.contact_id);
  let contatosPorId = new Map<string, ContatoResumo>();
  if (contactIds.length > 0) {
    const { data: contatos } = await supabase
      .from("contacts")
      .select("id, name, display_name, phone_number, tags")
      .in("id", contactIds);
    contatosPorId = new Map(((contatos ?? []) as ContatoResumo[]).map((c) => [c.id, c]));
  }

  return ok(
    pacientes.map((p) => ({ ...p, contact: contatosPorId.get(p.contact_id) ?? null })),
    { requestId },
  );
}

const criarSchema = z.object({ contact_id: z.string().uuid() });

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "odontologia_pacientes" });
  if (!authz.ok) return authz.response;

  const lido = criarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const orgId = authz.org.orgId;

  const { data: contato, error: erroContato } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", lido.data.contact_id)
    .maybeSingle();
  if (erroContato) return fail("internal_error", erroContato.message, 500, { requestId });
  if (!contato) {
    return fail("validation_failed", "Contato inválido para esta organização.", 422, { requestId });
  }

  const resultado = await garantirPaciente(supabase, orgId, lido.data.contact_id, authz.user.id);
  if (!resultado.ok) {
    if (moduloNaoInstalado({ code: resultado.codigo })) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", resultado.mensagem, 500, { requestId });
  }

  if (resultado.criado) {
    await audit({
      action: "odontologia.paciente_cadastrado",
      resourceType: "odontologia_paciente",
      resourceId: resultado.id,
      requestId,
      metadata: { contact_id: lido.data.contact_id, origem: "manual" },
    });
  }

  return ok({ id: resultado.id, contact_id: lido.data.contact_id }, { requestId, status: resultado.criado ? 201 : 200 });
}
