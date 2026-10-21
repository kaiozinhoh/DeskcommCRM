/**
 * GET /api/v1/odontologia/pacientes/[id]/prontuario — o prontuário COMPILADO em PDF (Fatia 7).
 *
 * Sem tabela nova: junta `odontologia_pacientes` + `odontologia_atendimentos` (+ procedimentos)
 * que já existem (DIRC: Calcular) e monta o PDF com `lib/odontologia/prontuario/documento.tsx`
 * (mesmo padrão de `lib/propostas/pdf-da-proposta.ts`). É LEITURA: não grava nada, não audita.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { marcaDaOrganizacaoParaPdf } from "@/lib/propostas/marca-da-organizacao-para-pdf";
import { rotuloParaAEquipe } from "@/lib/contacts/rotulo-do-contato";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import {
  renderProntuarioPdf,
  type AtendimentoDoProntuario,
} from "@/lib/odontologia/prontuario/documento";
import { procedimentosPorAtendimento } from "@/lib/odontologia/procedimentos-por-atendimento";
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

export async function GET(_req: NextRequest, { params }: Params): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "odontologia_pacientes" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await params;
  const orgId = authz.org.orgId;

  const supabase = await createClient();
  const { data: paciente, error: erroPaciente } = await supabase
    .from("odontologia_pacientes")
    .select("id, contact_id")
    .eq("id", id)
    .maybeSingle();
  if (erroPaciente) {
    if (moduloNaoInstalado(erroPaciente)) {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", erroPaciente.message, 500, { requestId });
  }
  if (!paciente) return fail("not_found", t("Paciente não encontrado."), 404, { requestId });

  const contactId = (paciente as { contact_id: string }).contact_id;
  const { data: contato } = await supabase
    .from("contacts")
    .select("id, name, display_name, phone_number")
    .eq("id", contactId)
    .maybeSingle();
  if (!contato) return fail("not_found", t("Contato não encontrado."), 404, { requestId });

  const { data: atendimentos } = await supabase
    .from("odontologia_atendimentos")
    .select("id, dente_regiao, observacao, valor_cobrado_cents, status, data_hora")
    .eq("contact_id", contactId)
    .order("data_hora", { ascending: true });
  const linhas = (atendimentos ?? []) as Array<{
    id: string;
    dente_regiao: string | null;
    observacao: string | null;
    valor_cobrado_cents: number | null;
    status: AtendimentoDoProntuario["status"];
    data_hora: string;
  }>;

  const procedimentosPor = await procedimentosPorAtendimento(
    supabase,
    orgId,
    linhas.map((l) => l.id),
  );
  const moeda = await moedaDaOrganizacao(supabase, orgId);
  const marca = await marcaDaOrganizacaoParaPdf(supabase, orgId);

  const tag = tagDeIdioma(authz.user.idioma);
  const buffer = await renderProntuarioPdf({
    nomeDoPaciente: rotuloParaAEquipe(contato as { name?: string | null; display_name?: string | null; phone_number?: string | null }, t),
    geradoEm: new Date().toLocaleString(tag),
    tagDeIdioma: tag,
    atendimentos: linhas.map((l) => ({
      dataHora: l.data_hora,
      status: l.status,
      denteRegiao: l.dente_regiao,
      observacao: l.observacao,
      valorCobradoCents: l.valor_cobrado_cents,
      moeda,
      procedimentos: (procedimentosPor.get(l.id) ?? []).map((p) => p.nome),
    })),
    marca: { appName: marca.appName, accentHex: marca.accentHex, logoUrl: marca.logoUrl },
    t,
  });

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=prontuario.pdf`,
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}
