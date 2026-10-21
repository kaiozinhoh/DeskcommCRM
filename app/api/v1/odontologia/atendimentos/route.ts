/**
 * ATENDIMENTOS ODONTOLÓGICOS — o previsto (status agendado, ligado à Agenda) e o registrado
 * (concluido/faltou/cancelado). A MESMA linha serve os dois momentos (ver migration 0722).
 *
 * Módulo opcional (ADR-0002): a tabela só existe depois que o administrador da instalação
 * instala `odontologia` em `/admin/modulos`. Enquanto não instalado, o Postgres devolve 42P01
 * (tabela inexistente) — traduzido aqui para uma mensagem clara, nunca um 500 cru.
 *
 * ⚠️ CLIENT DE SESSÃO. A RLS da migration 0722 já exige `agent`+ para registrar; a rota cobra o
 * mesmo degrau por clareza de mensagem, não como segunda régua de autoridade.
 *
 * POST aceita `Idempotency-Key`: marcar a consulta (Fatia 4) é ação de criação, e um retry de
 * rede não pode duplicar o atendimento previsto.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { atualizarDataDaUltimaConsulta } from "@/lib/odontologia/data-da-ultima-consulta";
import { garantirPaciente } from "@/lib/odontologia/garantir-paciente";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ENDPOINT = "/api/v1/odontologia/atendimentos";

const MODULO_NAO_INSTALADO =
  "O módulo de odontologia não está instalado nesta instalação. Peça ao administrador para " +
  "instalar em Configurações da instalação › Módulos.";

function moduloNaoInstalado(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

const CAMPOS =
  "id, contact_id, appointment_id, dentista_user_id, dente_regiao, observacao, " +
  "valor_cobrado_cents, status, data_hora, created_at, updated_at";

interface AtendimentoLinha {
  id: string;
  [chave: string]: unknown;
}

/**
 * Os nomes dos procedimentos de cada atendimento, em duas consultas FLAT (sem o embed do
 * PostgREST `tabela(coluna)`): o tipo da coluna em `odontologia_atendimento_procedimentos` e em
 * `odontologia_procedimentos` ainda não está em `lib/database.types.ts` (módulo recém-criado,
 * sem `db push` nesta sandbox) — o parser de tipos do select embedado trava em
 * `GenericStringError` sem o schema real. Mesma solução de `lib/lgpd/export-collector.ts`.
 */
async function procedimentosPorAtendimento(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  atendimentoIds: string[],
): Promise<Map<string, { id: string; nome: string }[]>> {
  const mapa = new Map<string, { id: string; nome: string }[]>();
  if (atendimentoIds.length === 0) return mapa;

  const { data: vinculos } = await supabase
    .from("odontologia_atendimento_procedimentos")
    .select("atendimento_id, procedimento_id")
    .eq("organization_id", organizationId)
    .in("atendimento_id", atendimentoIds);
  const linhas = (vinculos ?? []) as { atendimento_id: string; procedimento_id: string }[];
  const procedimentoIds = [...new Set(linhas.map((v) => v.procedimento_id))];
  if (procedimentoIds.length === 0) return mapa;

  const { data: procedimentos } = await supabase
    .from("odontologia_procedimentos")
    .select("id, nome")
    .eq("organization_id", organizationId)
    .in("id", procedimentoIds);
  const nomePor = new Map(((procedimentos ?? []) as { id: string; nome: string }[]).map((p) => [p.id, p.nome]));

  for (const v of linhas) {
    const nome = nomePor.get(v.procedimento_id);
    if (!nome) continue;
    const lista = mapa.get(v.atendimento_id) ?? [];
    lista.push({ id: v.procedimento_id, nome });
    mapa.set(v.atendimento_id, lista);
  }
  return mapa;
}

const criarSchema = z.object({
  contact_id: z.string().uuid(),
  appointment_id: z.string().uuid().nullish(),
  dentista_user_id: z.string().uuid().nullish(),
  dente_regiao: z.string().trim().max(120).nullish(),
  observacao: z.string().trim().max(2000).nullish(),
  valor_cobrado_cents: z.number().int().min(1).nullish(),
  status: z.enum(["agendado", "concluido", "faltou", "cancelado"]).default("agendado"),
  data_hora: z.string().datetime({ offset: true }),
  procedimento_ids: z.array(z.string().uuid()).default([]),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "odontologia_atendimentos" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const contactId = url.searchParams.get("contact_id");
  const appointmentId = url.searchParams.get("appointment_id");

  const supabase = await createClient();
  let q = supabase
    .from("odontologia_atendimentos")
    .select(CAMPOS)
    .order("data_hora", { ascending: false })
    .limit(200);
  if (contactId) q = q.eq("contact_id", contactId);
  if (appointmentId) q = q.eq("appointment_id", appointmentId);

  const { data, error } = await q;
  if (error) {
    if (moduloNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const linhas = (data ?? []) as unknown as AtendimentoLinha[];
  const procedimentosPor = await procedimentosPorAtendimento(
    supabase,
    authz.org.orgId,
    linhas.map((l) => l.id),
  );
  return ok(
    linhas.map((l) => ({ ...l, procedimentos: procedimentosPor.get(l.id) ?? [] })),
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "odontologia_atendimentos" });
  if (!authz.ok) return authz.response;

  const lido = criarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const chave = chaveDaRequisicao(req);
  if (chave !== null && !z.string().uuid().safeParse(chave).success) {
    return fail("validation_error", "Idempotency-Key deve ser UUID", 400, { requestId });
  }

  const supabase = await createClient();
  // Estreitados aqui: dentro de `criar()` o TypeScript não carrega o `if` de cima.
  const orgId = authz.org.orgId;
  const userId = authz.user.id;
  const corpo = lido.data;

  async function criar(): Promise<unknown> {
    // "Um contato só é paciente quando esta linha existe" (migration 0726) — garante o
    // cadastro ANTES do atendimento, no mesmo gesto de atender. Falha real (não o 23505 de
    // corrida esperado) recusa a criação: um atendimento sem paciente contradiz o desenho.
    const paciente = await garantirPaciente(supabase, orgId, corpo.contact_id, userId);
    if (!paciente.ok) {
      if (moduloNaoInstalado({ code: paciente.codigo })) {
        throw new Recusa(fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId }));
      }
      throw new Recusa(fail("internal_error", paciente.mensagem, 500, { requestId }));
    }
    if (paciente.criado) {
      await audit({
        action: "odontologia.paciente_cadastrado",
        resourceType: "odontologia_paciente",
        resourceId: paciente.id,
        requestId,
        metadata: { contact_id: corpo.contact_id, origem: "primeiro_atendimento" },
      });
    }

    // A FK de `procedimento_id` é conferida pelo dono da tabela, por cima da RLS: sem esta
    // leitura (com a sessão, recortada pela RLS) o atendimento aceitaria o procedimento de
    // outra organização.
    if (corpo.procedimento_ids.length > 0) {
      const { data: procedimentos } = await supabase
        .from("odontologia_procedimentos")
        .select("id")
        .eq("organization_id", orgId)
        .in("id", corpo.procedimento_ids);
      if ((procedimentos?.length ?? 0) !== corpo.procedimento_ids.length) {
        throw new Recusa(
          fail("validation_failed", "Procedimento inválido para esta organização.", 422, { requestId }),
        );
      }
    }

    const { data: atendimento, error } = await supabase
      .from("odontologia_atendimentos")
      .insert({
        organization_id: orgId,
        contact_id: corpo.contact_id,
        appointment_id: corpo.appointment_id ?? null,
        dentista_user_id: corpo.dentista_user_id ?? null,
        dente_regiao: corpo.dente_regiao ?? null,
        observacao: corpo.observacao ?? null,
        valor_cobrado_cents: corpo.valor_cobrado_cents ?? null,
        status: corpo.status,
        data_hora: corpo.data_hora,
        created_by: userId,
      })
      .select(CAMPOS)
      .single();
    const atendimentoLinha = atendimento as AtendimentoLinha | null;

    if (error) {
      if (moduloNaoInstalado(error)) {
        throw new Recusa(fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId }));
      }
      if (error.code === "23503") {
        throw new Recusa(
          fail("validation_failed", "Paciente ou compromisso inválido para esta organização.", 422, {
            requestId,
          }),
        );
      }
      if (error.code === "23505") {
        throw new Recusa(
          fail("validation_failed", "Este compromisso já tem um atendimento.", 422, { requestId }),
        );
      }
      throw new Recusa(fail("internal_error", error.message, 500, { requestId }));
    }
    if (!atendimentoLinha) {
      throw new Recusa(fail("internal_error", "Erro ao registrar o atendimento.", 500, { requestId }));
    }

    if (corpo.procedimento_ids.length > 0) {
      const { error: erroVinculo } = await supabase.from("odontologia_atendimento_procedimentos").insert(
        corpo.procedimento_ids.map((procedimentoId) => ({
          organization_id: orgId,
          atendimento_id: atendimentoLinha.id,
          procedimento_id: procedimentoId,
        })),
      );
      if (erroVinculo) {
        throw new Recusa(fail("internal_error", erroVinculo.message, 500, { requestId }));
      }
    }

    // Melhor esforço, nunca bloqueia a resposta (ver o cabeçalho do helper) — só quando o
    // atendimento JÁ NASCE concluído (registro direto/retroativo); do "agendado" ao
    // concluído é o PATCH quem atualiza (ver [id]/route.ts).
    if (corpo.status === "concluido") {
      await atualizarDataDaUltimaConsulta(supabase, orgId, corpo.contact_id, corpo.data_hora);
    }

    await audit({
      action: corpo.status === "agendado" ? "odontologia.atendimento_agendado" : "odontologia.atendimento_registrado",
      resourceType: "odontologia_atendimento",
      resourceId: atendimentoLinha.id,
      requestId,
      metadata: { contact_id: corpo.contact_id, status: corpo.status },
    });

    const procedimentosPor = await procedimentosPorAtendimento(supabase, orgId, [atendimentoLinha.id]);
    return { ...atendimentoLinha, procedimentos: procedimentosPor.get(atendimentoLinha.id) ?? [] };
  }

  try {
    if (chave === null) return ok(await criar(), { requestId, status: 201 });

    const desfecho = await comIdempotencia({
      db: supabase,
      organizationId: orgId,
      endpoint: ENDPOINT,
      chave,
      corpo,
      executar: async () => ({ resposta: await criar(), status: 201 }),
    });
    if (desfecho.tipo === "conflito") {
      return fail("idempotency_conflict", "Esta chave de idempotência já foi usada com outro conteúdo.", 409, {
        requestId,
      });
    }
    if (desfecho.tipo === "em_curso") {
      return fail("idempotency_in_progress", "O mesmo registro ainda está em curso. Tente de novo em instantes.", 409, {
        requestId,
      });
    }
    return ok(desfecho.resposta, { requestId, status: desfecho.status as 200 | 201 });
  } catch (erro) {
    if (erro instanceof Recusa) return erro.resposta;
    return fail("internal_error", "Erro ao registrar o atendimento.", 500, { requestId });
  }
}

class Recusa extends Error {
  constructor(readonly resposta: Response) {
    super("recusa");
  }
}
