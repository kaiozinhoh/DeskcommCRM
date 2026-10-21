import type { SupabaseClient } from "@supabase/supabase-js";

import { camposDoFunil, escopoDoCampo } from "@/lib/leads/campos-do-funil";
import { logger } from "@/lib/logger";
import type { CustomFieldDef } from "@/lib/schemas/settings";

function normalizado(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * O funil declara um campo de data que parece ser "Data da última consulta"?
 * Procura pela CHAVE ou pelo RÓTULO (a clínica escolhe o nome do campo; o
 * módulo não impõe uma chave fixa) — é o que o item 3b do módulo pede:
 * "procurar pela chave/label equivalente; se não achar, ignorar e logar".
 */
function pareceCampoDaUltimaConsulta(campo: CustomFieldDef): boolean {
  if (campo.type !== "date") return false;
  const bate = (s: string) => s.includes("ultimaconsulta") || (s.includes("ultima") && s.includes("consulta"));
  return bate(normalizado(campo.key)) || bate(normalizado(campo.label));
}

/**
 * Atualiza "Data da última consulta" no funil ao registrar um atendimento concluído —
 * MELHOR ESFORÇO: se a organização não declarou um campo assim em nenhum funil, ou a
 * escrita falhar, registra em log e segue. Nunca lança — o registro do atendimento não pode
 * falhar por causa de um campo opcional do funil que a clínica talvez nem tenha criado.
 *
 * O campo pode ser do NEGÓCIO (`crm_leads.custom_fields`, por funil) ou do CONTATO
 * (`contacts.custom_fields`, um valor só) — `lib/leads/campos-do-funil.ts` já resolve essa
 * distinção para o resto do produto (#2791); aqui só se decide ONDE gravar.
 */
export async function atualizarDataDaUltimaConsulta(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
  dataISO: string,
): Promise<void> {
  try {
    const { data: pipelines, error } = await supabase
      .from("crm_pipelines")
      .select("id, settings")
      .eq("organization_id", organizationId);
    if (error || !pipelines) {
      logger.warn("[odontologia] data da última consulta: leitura de funis falhou", {
        organization_id: organizationId,
        error: error?.message,
      });
      return;
    }

    for (const pipeline of pipelines as { id: string; settings: Record<string, unknown> | null }[]) {
      const campo = camposDoFunil(pipeline.settings).find(pareceCampoDaUltimaConsulta);
      if (!campo) continue;

      if (escopoDoCampo(campo) === "contato") {
        const { data: contato } = await supabase
          .from("contacts")
          .select("custom_fields")
          .eq("id", contactId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        const atual = (contato?.custom_fields as Record<string, unknown> | null) ?? {};
        const { error: erroUpdate } = await supabase
          .from("contacts")
          .update({ custom_fields: { ...atual, [campo.key]: dataISO } })
          .eq("id", contactId)
          .eq("organization_id", organizationId);
        if (erroUpdate) {
          logger.warn("[odontologia] data da última consulta: escrita no contato falhou", {
            organization_id: organizationId,
            contact_id: contactId,
            error: erroUpdate.message,
          });
        }
        return;
      }

      // Campo do NEGÓCIO: pertence ao lead deste contato NESTE funil. Sem lead aberto
      // neste funil, este campo não é onde gravar — tenta o próximo funil declarado.
      const { data: lead } = await supabase
        .from("crm_leads")
        .select("id, custom_fields")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .eq("pipeline_id", pipeline.id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lead) continue;

      const atual = (lead.custom_fields as Record<string, unknown> | null) ?? {};
      const { error: erroUpdate } = await supabase
        .from("crm_leads")
        .update({ custom_fields: { ...atual, [campo.key]: dataISO } })
        .eq("id", lead.id)
        .eq("organization_id", organizationId);
      if (erroUpdate) {
        logger.warn("[odontologia] data da última consulta: escrita no negócio falhou", {
          organization_id: organizationId,
          lead_id: lead.id,
          error: erroUpdate.message,
        });
      }
      return;
    }
  } catch (erro) {
    logger.warn("[odontologia] data da última consulta: ignorado por erro inesperado", {
      organization_id: organizationId,
      contact_id: contactId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
  }
}
