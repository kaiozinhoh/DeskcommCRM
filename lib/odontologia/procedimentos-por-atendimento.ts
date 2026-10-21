import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Os nomes dos procedimentos de cada atendimento, em duas consultas FLAT (sem o embed do
 * PostgREST `tabela(coluna)`): o tipo da coluna em `odontologia_atendimento_procedimentos` e em
 * `odontologia_procedimentos` ainda não está em `lib/database.types.ts` (módulo recém-criado,
 * sem `db push` nesta sandbox) — o parser de tipos do select embedado trava em
 * `GenericStringError` sem o schema real. Mesma solução de `lib/lgpd/export-collector.ts`.
 *
 * Compartilhado entre `/api/v1/odontologia/atendimentos` e o PDF do prontuário (Fatia 7) — os
 * dois precisam exatamente do mesmo mapa atendimento → procedimentos.
 */
export async function procedimentosPorAtendimento(
  supabase: SupabaseClient,
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
