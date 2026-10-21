/**
 * Odontologia — módulo de tabela via ADR-0002 (migration 0706).
 *
 * Fatia 1: só `odontologia_procedimentos` nasce aqui. `protecaoPropria` porque a RLS é por
 * OPERAÇÃO (leitura da org, escrita manager+ — mesmo padrão de Honorários), ligada dentro da
 * própria função: `fn_proteger_tabelas_de_organizacao()` só enxerga tabela com RLS desligada,
 * então a nossa não ganha a policy ampla — nem deveria (qualquer membro poderia mudar preço).
 */
import { moldeDeProvisionadora } from "./molde-de-provisionadora";

moldeDeProvisionadora({
  modulo: "odontologia",
  tabelas: ["odontologia_procedimentos"],
  protecaoPropria: ["odontologia_procedimentos"],
});
