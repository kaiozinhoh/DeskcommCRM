/**
 * Odontologia — módulo de tabela via ADR-0002 (migrations 0721/0722).
 *
 * Fatia 3 acrescenta `odontologia_atendimentos` e `odontologia_atendimento_procedimentos`.
 * `protecaoPropria` nas três porque a RLS é por OPERAÇÃO (leitura da org, escrita manager+/
 * agent+ conforme a tabela — mesmo padrão de Honorários), ligada dentro da própria função:
 * `fn_proteger_tabelas_de_organizacao()` só enxerga tabela com RLS desligada, então a nossa não
 * ganha a policy ampla — nem deveria (qualquer membro poderia mudar preço ou apagar histórico).
 */
import { moldeDeProvisionadora } from "./molde-de-provisionadora";

moldeDeProvisionadora({
  modulo: "odontologia",
  tabelas: [
    "odontologia_procedimentos",
    "odontologia_atendimentos",
    "odontologia_atendimento_procedimentos",
  ],
  protecaoPropria: [
    "odontologia_procedimentos",
    "odontologia_atendimentos",
    "odontologia_atendimento_procedimentos",
  ],
});
