import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

/** Identificador estável do tipo padrão do módulo — nunca muda, mesmo se o nome for editado. */
export const SLUG_DO_TIPO_PADRAO_ODONTOLOGIA = "consulta-odontologica";

/**
 * Garante o tipo de agendamento padrão do módulo ("Consulta odontológica"), para a clínica não
 * precisar configurar a Agenda antes de usar Odontologia. MELHOR ESFORÇO: a Agenda continua
 * funcionando com os tipos que a organização já tem — isto só preenche a prateleira quando ela
 * está vazia (nenhum tipo ativo), e nunca falha o carregamento da página por causa disto.
 *
 * Procedimento ≠ tipo de agendamento (ver o plano da Fatia 4): o tipo só decide a DURAÇÃO
 * sugerida e a categoria na Agenda; o procedimento clínico é escolhido à parte, no seletor que
 * a Fatia 4 acrescenta antes do painel de marcação.
 *
 * `upsert` com `ignoreDuplicates`, não `insert`: idempotente de verdade — duas chamadas
 * concorrentes (duas abas abrindo a Agenda ao mesmo tempo) não colidem no índice único
 * `calendar_event_types_org_slug_key` (organization_id, slug).
 */
export async function garantirTipoDeAgendamentoOdontologico(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<void> {
  try {
    const { error } = await supabase.from("calendar_event_types").upsert(
      {
        organization_id: organizationId,
        name: "Consulta odontológica",
        slug: SLUG_DO_TIPO_PADRAO_ODONTOLOGIA,
        category: "consulta",
      },
      { onConflict: "organization_id,slug", ignoreDuplicates: true },
    );
    if (error) {
      logger.warn("[odontologia] tipo de agendamento padrão: não consegui garantir", {
        organization_id: organizationId,
        error: error.message,
      });
    }
  } catch (erro) {
    logger.warn("[odontologia] tipo de agendamento padrão: ignorado por erro inesperado", {
      organization_id: organizationId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
  }
}
