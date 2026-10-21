import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * GARANTE O CADASTRO DE PACIENTE (Fatia 6) — "um contato só é paciente quando esta linha
 * existe" (migration 0726). Chamado ao registrar o PRIMEIRO atendimento de um contato: a
 * pessoa que atende está, no mesmo gesto, criando o cadastro — sem depender de uma etapa
 * manual antes. Cadastro manual pela tela de Pacientes continua existindo à parte
 * (`POST /api/v1/odontologia/pacientes`), e a trave de unicidade
 * (`odontologia_pacientes_contato_unico`) torna as duas vias idempotentes entre si.
 *
 * DIFERENTE do tipo de agendamento padrão (`garantirTipoDeAgendamentoOdontologico`): aquele é
 * conveniência (a Agenda funciona sem ele) e por isso é melhor-esforço silencioso. Este é parte
 * do contrato — um atendimento sem paciente cadastrado contradiz o desenho — então uma falha
 * real (não o 23505 de corrida esperado) propaga para quem chama decidir, em vez de ser
 * engolida.
 *
 * `insert` simples, não `upsert`: um `upsert` reescreveria `created_by`/`created_at` do
 * cadastro já existente a cada novo atendimento — a trava de unicidade some sem avisar quem
 * de fato criou o paciente. No conflito (23505), uma segunda consulta busca o `id` já
 * existente — duas idas ao banco, mas sem sobrescrever nada.
 */
export async function garantirPaciente(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
  userId: string,
): Promise<
  { ok: true; id: string; criado: boolean } | { ok: false; codigo?: string; mensagem: string }
> {
  const { data, error } = await supabase
    .from("odontologia_pacientes")
    .insert({ organization_id: organizationId, contact_id: contactId, created_by: userId })
    .select("id")
    .single();
  if (!error) return { ok: true, id: (data as { id: string }).id, criado: true };
  if (error.code !== "23505") return { ok: false, codigo: error.code, mensagem: error.message };

  const { data: existente, error: erroBusca } = await supabase
    .from("odontologia_pacientes")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .single();
  if (erroBusca || !existente) {
    return {
      ok: false,
      codigo: erroBusca?.code,
      mensagem: erroBusca?.message ?? "Paciente não encontrado após conflito.",
    };
  }
  return { ok: true, id: (existente as { id: string }).id, criado: false };
}
