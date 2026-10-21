import { beforeAll, describe, expect, it } from "vitest";

import {
  countAs,
  GOV_AGENT_A,
  GOV_CONTACT_1,
  GOV_MANAGER,
  GOV_ORG,
  GOV_VIEWER,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * A RLS DE ODONTOLOGIA (procedimentos) É POR OPERAÇÃO, como Honorários (molde da 0480).
 *
 * Procedimento é cadastro/preço de referência da clínica — leitura para a organização,
 * escrita (insert/update/delete) só `manager`+ (mesmo piso do caixa núcleo: preço não é coisa
 * que `agent` configure). A policy ampla automática deixaria qualquer membro escrever, por isso
 * a provisionadora liga a RLS ela mesma.
 */
const ORG_B = "cccccccc-9999-4000-8000-00000000e0b0";
const PROCEDIMENTO = "cccccccc-9999-4000-8000-00000000e001";
const PROCEDIMENTO_DESCARTE = "cccccccc-9999-4000-8000-00000000e002";
const PROCEDIMENTO_OUTRA_ORG = "cccccccc-9999-4000-8000-00000000e003";

function existe(id: string): boolean {
  return lastLine(sql(`select exists(select 1 from public.odontologia_procedimentos where id = '${id}')::text;`)) === "true";
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_odontologia_provisionar();

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'odontologia-rls-b', 'Odontologia RLS B', 'Odonto RLS B')
      on conflict (id) do nothing;
    insert into public.odontologia_procedimentos (id, organization_id, nome, duracao_min) values
      ('${PROCEDIMENTO}', '${GOV_ORG}', 'Limpeza', 30),
      ('${PROCEDIMENTO_DESCARTE}', '${GOV_ORG}', 'Avaliação', 20),
      ('${PROCEDIMENTO_OUTRA_ORG}', '${ORG_B}', 'Canal', 60)
      on conflict (id) do nothing;
  `);
});

describe("viewer e agent não escrevem", () => {
  for (const [papel, usuario] of [
    ["viewer", GOV_VIEWER],
    ["agent", GOV_AGENT_A],
  ] as const) {
    it(`${papel} não cria, não edita e não apaga procedimento`, () => {
      expect(
        writeCountAs(usuario, `insert into public.odontologia_procedimentos (organization_id, nome, duracao_min) values ('${GOV_ORG}', 'Clareamento', 45)`),
      ).toBe(0);
      expect(writeCountAs(usuario, `update public.odontologia_procedimentos set ativo = false where id = '${PROCEDIMENTO}'`)).toBe(0);
      expect(writeCountAs(usuario, `delete from public.odontologia_procedimentos where id = '${PROCEDIMENTO}'`)).toBe(0);
      expect(existe(PROCEDIMENTO)).toBe(true);
    });

    it(`${papel} lê (GET é viewer) — controle positivo`, () => {
      expect(countAs(usuario, `select count(*) from public.odontologia_procedimentos where organization_id = '${GOV_ORG}'`)).toBe(2);
    });
  }
});

describe("manager escreve (as rotas são manager) — controle positivo", () => {
  it("cria, edita e apaga o procedimento da própria organização", () => {
    expect(
      writeCountAs(GOV_MANAGER, `insert into public.odontologia_procedimentos (organization_id, nome, duracao_min) values ('${GOV_ORG}', 'Clareamento', 45)`),
    ).toBe(1);
    expect(writeCountAs(GOV_MANAGER, `update public.odontologia_procedimentos set ativo = false where id = '${PROCEDIMENTO}'`)).toBe(1);
    expect(writeCountAs(GOV_MANAGER, `delete from public.odontologia_procedimentos where id = '${PROCEDIMENTO_DESCARTE}'`)).toBe(1);
  });

  it("não cria nem pendura procedimento em outra organização", () => {
    expect(
      writeCountAs(GOV_MANAGER, `insert into public.odontologia_procedimentos (organization_id, nome, duracao_min) values ('${ORG_B}', 'Fora da org', 10)`),
    ).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `update public.odontologia_procedimentos set ativo = false where id = '${PROCEDIMENTO_OUTRA_ORG}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.odontologia_procedimentos where id = '${PROCEDIMENTO_OUTRA_ORG}'`)).toBe(0);
    expect(existe(PROCEDIMENTO_OUTRA_ORG)).toBe(true);
  });
});

/**
 * ODONTOLOGIA_ATENDIMENTOS — leitura para a organização, `agent`+ registra
 * (insere o previsto, marca concluído/faltou), ninguém apaga pela sessão
 * (nenhuma policy de delete nasce — "não apagar fisicamente" do catálogo de
 * permissões). A régua fina de CORREÇÃO (manager+) é da rota, não da RLS.
 */
describe("odontologia_atendimentos — agent+ registra, viewer só lê, ninguém apaga", () => {
  const PROCEDIMENTO_ATEND = "cccccccc-9999-4000-8000-00000000e004";
  const ATENDIMENTO = "cccccccc-9999-4000-8000-00000000e011";
  const ATENDIMENTO_OUTRA_ORG = "cccccccc-9999-4000-8000-00000000e012";

  beforeAll(() => {
    sql(`
      insert into public.odontologia_procedimentos (id, organization_id, nome, duracao_min) values
        ('${PROCEDIMENTO_ATEND}', '${GOV_ORG}', 'Avaliação RLS atendimento', 20)
        on conflict (id) do nothing;
      insert into public.odontologia_atendimentos
          (id, organization_id, contact_id, status, data_hora) values
        ('${ATENDIMENTO}', '${GOV_ORG}', '${GOV_CONTACT_1}', 'agendado', now()),
        ('${ATENDIMENTO_OUTRA_ORG}', '${ORG_B}', '${GOV_CONTACT_1}', 'agendado', now())
        on conflict (id) do nothing;
    `);
  });

  it("viewer lê, mas não registra nem edita", () => {
    expect(
      countAs(GOV_VIEWER, `select count(*) from public.odontologia_atendimentos where id = '${ATENDIMENTO}'`),
    ).toBe(1);
    expect(
      writeCountAs(GOV_VIEWER, `insert into public.odontologia_atendimentos (organization_id, contact_id, status, data_hora) values ('${GOV_ORG}', '${GOV_CONTACT_1}', 'agendado', now())`),
    ).toBe(0);
    expect(writeCountAs(GOV_VIEWER, `update public.odontologia_atendimentos set status = 'concluido' where id = '${ATENDIMENTO}'`)).toBe(0);
  });

  it("agent registra (cria e marca concluído/faltou) — controle positivo", () => {
    expect(
      writeCountAs(GOV_AGENT_A, `insert into public.odontologia_atendimentos (organization_id, contact_id, status, data_hora) values ('${GOV_ORG}', '${GOV_CONTACT_1}', 'agendado', now())`),
    ).toBe(1);
    expect(writeCountAs(GOV_AGENT_A, `update public.odontologia_atendimentos set status = 'concluido' where id = '${ATENDIMENTO}'`)).toBe(1);
  });

  it("agent não cria atendimento com contato de outra organização (recusa cross-org na própria FK)", () => {
    expect(
      writeCountAs(GOV_AGENT_A, `insert into public.odontologia_atendimentos (organization_id, contact_id, status, data_hora) values ('${ORG_B}', '${GOV_CONTACT_1}', 'agendado', now())`),
    ).toBe(0);
  });

  it("ninguém apaga pela sessão — nem manager (sem policy de delete)", () => {
    expect(writeCountAs(GOV_MANAGER, `delete from public.odontologia_atendimentos where id = '${ATENDIMENTO}'`)).toBe(0);
    expect(existeAtendimento(ATENDIMENTO)).toBe(true);
  });

  it("membro da organização A não lê atendimento da organização B (cross-org)", () => {
    expect(
      countAs(GOV_AGENT_A, `select count(*) from public.odontologia_atendimentos where id = '${ATENDIMENTO_OUTRA_ORG}'`),
    ).toBe(0);
  });

  describe("odontologia_atendimento_procedimentos — agent+ adiciona, manager+ remove", () => {
    it("agent associa um procedimento ao atendimento", () => {
      expect(
        writeCountAs(
          GOV_AGENT_A,
          `insert into public.odontologia_atendimento_procedimentos (organization_id, atendimento_id, procedimento_id) values ('${GOV_ORG}', '${ATENDIMENTO}', '${PROCEDIMENTO_ATEND}')`,
        ),
      ).toBe(1);
    });

    it("agent não remove (correção é manager+); manager remove — controle positivo", () => {
      expect(
        writeCountAs(
          GOV_AGENT_A,
          `delete from public.odontologia_atendimento_procedimentos where atendimento_id = '${ATENDIMENTO}'`,
        ),
      ).toBe(0);
      expect(
        writeCountAs(
          GOV_MANAGER,
          `delete from public.odontologia_atendimento_procedimentos where atendimento_id = '${ATENDIMENTO}'`,
        ),
      ).toBe(1);
    });
  });
});

function existeAtendimento(id: string): boolean {
  return lastLine(sql(`select exists(select 1 from public.odontologia_atendimentos where id = '${id}')::text;`)) === "true";
}
