/**
 * POST /api/v1/odontologia/pacientes/[id]/atestado — atestado simples em PDF (Fatia 8).
 *
 * Pra imprimir e assinar/carimbar à mão — sem assinatura digital, sem numeração/controle
 * sequencial (decisão do dono do produto). `agent`+, mesmo degrau de quem registra o
 * atendimento que o atestado documenta.
 *
 * ⚠️ Sem tabela: o atestado não é persistido (nasce, é devolvido, acaba). O audit log registra
 * QUE foi emitido (quando, pra qual paciente, quantos dias) — nunca o MOTIVO nem o nome do
 * dentista: `api_audit_log.metadata` não passa pela redação de LGPD por coluna
 * (`modulo_secoes_lgpd` só conhece as tabelas que a provisionadora declara), e motivo clínico
 * em texto livre guardado ali seria um vazamento silencioso, pelo mesmo raciocínio do aviso
 * sobre os anexos na migration 0727.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { rotuloParaAEquipe } from "@/lib/contacts/rotulo-do-contato";
import { marcaDaOrganizacaoParaPdf } from "@/lib/propostas/marca-da-organizacao-para-pdf";
import { renderAtestadoPdf } from "@/lib/odontologia/atestado/documento";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MODULO_NAO_INSTALADO =
  "O módulo de odontologia não está instalado nesta instalação. Peça ao administrador para " +
  "instalar em Configurações da instalação › Módulos.";

function moduloNaoInstalado(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

const corpoSchema = z.object({
  motivo: z.string().trim().min(1).max(1000),
  dias_afastamento: z.number().int().min(1).max(365).nullish(),
  dentista_nome: z.string().trim().min(1).max(120),
  dentista_cro: z.string().trim().min(1).max(40),
});

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "odontologia_pacientes" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id: pacienteId } = await params;
  const orgId = authz.org.orgId;

  const lido = corpoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? t("Corpo inválido."), 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const { data: paciente, error: erroPaciente } = await supabase
    .from("odontologia_pacientes")
    .select("id, contact_id")
    .eq("id", pacienteId)
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

  const marca = await marcaDaOrganizacaoParaPdf(supabase, orgId);
  const buffer = await renderAtestadoPdf({
    nomeDoPaciente: rotuloParaAEquipe(
      contato as { name?: string | null; display_name?: string | null; phone_number?: string | null },
      t,
    ),
    data: new Date().toLocaleDateString(tagDeIdioma(authz.user.idioma)),
    motivo: lido.data.motivo,
    diasAfastamento: lido.data.dias_afastamento ?? null,
    dentistaNome: lido.data.dentista_nome,
    dentistaCro: lido.data.dentista_cro,
    marca: { appName: marca.appName, accentHex: marca.accentHex, logoUrl: marca.logoUrl },
    t,
  });

  await audit({
    action: "odontologia.atestado_emitido",
    resourceType: "odontologia_paciente",
    resourceId: pacienteId,
    requestId,
    metadata: { paciente_id: pacienteId, dias_afastamento: lido.data.dias_afastamento ?? null },
  });

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=atestado.pdf",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}
