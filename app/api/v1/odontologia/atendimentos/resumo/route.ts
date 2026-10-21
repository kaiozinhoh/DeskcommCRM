/**
 * GET /api/v1/odontologia/atendimentos/resumo?contact_ids=a,b,c — a última consulta
 * concluída e o próximo retorno agendado de cada paciente, para a lista de Pacientes
 * (Fatia 5) não fazer uma chamada por linha.
 *
 * Sem view materializada nesta primeira entrega (decisão registrada no plano da Fatia 5):
 * busca as linhas relevantes e agrega em memória. Para a lista paginada de pacientes (até
 * `MAX_CONTATOS` por chamada) isto é suficiente; se aparecer num perfil, o caminho é uma
 * view, não reescrever esta rota.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MODULO_NAO_INSTALADO =
  "O módulo de odontologia não está instalado nesta instalação. Peça ao administrador para " +
  "instalar em Configurações da instalação › Módulos.";

const MAX_CONTATOS = 200;

interface LinhaResumo {
  contact_id: string;
  status: string;
  data_hora: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "odontologia_atendimentos" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const contactIds = (url.searchParams.get("contact_ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_CONTATOS);
  if (contactIds.length === 0) return ok({}, { requestId });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("odontologia_atendimentos")
    .select("contact_id, status, data_hora")
    .eq("organization_id", authz.org.orgId)
    .in("contact_id", contactIds)
    .in("status", ["concluido", "agendado"]);

  if (error) {
    if (error.code === "42P01") {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const agora = Date.now();
  const resumo: Record<string, { ultima_consulta: string | null; proximo_retorno: string | null }> = {};
  for (const linha of (data ?? []) as unknown as LinhaResumo[]) {
    const atual = resumo[linha.contact_id] ?? { ultima_consulta: null, proximo_retorno: null };
    if (linha.status === "concluido") {
      if (!atual.ultima_consulta || linha.data_hora > atual.ultima_consulta) {
        atual.ultima_consulta = linha.data_hora;
      }
    } else if (linha.status === "agendado" && new Date(linha.data_hora).getTime() >= agora) {
      if (!atual.proximo_retorno || linha.data_hora < atual.proximo_retorno) {
        atual.proximo_retorno = linha.data_hora;
      }
    }
    resumo[linha.contact_id] = atual;
  }

  return ok(resumo, { requestId });
}
