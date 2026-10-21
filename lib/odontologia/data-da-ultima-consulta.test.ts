import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { logger } from "@/lib/logger";

import { atualizarDataDaUltimaConsulta } from "./data-da-ultima-consulta";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";
const LEAD_ID = "44444444-4444-4444-8444-444444444444";
const DATA_ISO = "2026-11-01T10:00:00.000Z";

/** Query builder mínimo: cada tabela resolve com o que o teste pede para ela. */
function fakeSupabase(porTabela: Record<string, unknown>) {
  const updates: Array<{ tabela: string; valores: unknown }> = [];
  const from = vi.fn((tabela: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: porTabela[`${tabela}:maybeSingle`] ?? null, error: null }),
      update: (valores: unknown) => {
        updates.push({ tabela, valores });
        const resultado = (porTabela[`${tabela}:update`] as { error: unknown } | undefined) ?? { error: null };
        return { eq: () => ({ eq: () => Promise.resolve(resultado) }) };
      },
    };
    // `crm_pipelines` termina a cadeia direto no último `.eq()`.
    if (tabela === "crm_pipelines") {
      builder.eq = () => Promise.resolve({ data: porTabela["crm_pipelines"] ?? [], error: null });
    }
    return builder;
  });
  return { client: { from } as never, updates };
}

function pipeline(settings: Record<string, unknown>) {
  return { id: "pipe-1", settings };
}

function campo(overrides: Partial<{ key: string; label: string; type: string; escopo: string }> = {}) {
  return { key: "data_ultima_consulta", label: "Data da última consulta", type: "date", ...overrides };
}

describe("atualizarDataDaUltimaConsulta", () => {
  it("sem funil nenhum, não escreve em lugar nenhum (melhor esforço)", async () => {
    const { client, updates } = fakeSupabase({ crm_pipelines: [] });
    await atualizarDataDaUltimaConsulta(client, ORG_ID, CONTACT_ID, DATA_ISO);
    expect(updates).toEqual([]);
  });

  it("funil sem campo de data equivalente é ignorado, sem lançar", async () => {
    const { client, updates } = fakeSupabase({
      crm_pipelines: [pipeline({ fields: [{ key: "cor_favorita", label: "Cor favorita", type: "text" }] })],
    });
    await atualizarDataDaUltimaConsulta(client, ORG_ID, CONTACT_ID, DATA_ISO);
    expect(updates).toEqual([]);
  });

  it("campo do NEGÓCIO: grava em crm_leads.custom_fields do lead aberto deste funil", async () => {
    const { client, updates } = fakeSupabase({
      crm_pipelines: [pipeline({ fields: [campo({ escopo: "negocio" })] })],
      "crm_leads:maybeSingle": { id: LEAD_ID, custom_fields: { outro: "valor" } },
      "crm_leads:update": { error: null },
    });
    await atualizarDataDaUltimaConsulta(client, ORG_ID, CONTACT_ID, DATA_ISO);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      tabela: "crm_leads",
      valores: { custom_fields: { outro: "valor", data_ultima_consulta: DATA_ISO } },
    });
  });

  it("campo do NEGÓCIO sem lead aberto neste funil: não escreve (não é onde gravar)", async () => {
    const { client, updates } = fakeSupabase({
      crm_pipelines: [pipeline({ fields: [campo({ escopo: "negocio" })] })],
      "crm_leads:maybeSingle": null,
    });
    await atualizarDataDaUltimaConsulta(client, ORG_ID, CONTACT_ID, DATA_ISO);
    expect(updates).toEqual([]);
  });

  it("campo do CONTATO: grava em contacts.custom_fields", async () => {
    const { client, updates } = fakeSupabase({
      crm_pipelines: [pipeline({ fields: [campo({ escopo: "contato" })] })],
      "contacts:maybeSingle": { custom_fields: { convenio: "Unimed" } },
      "contacts:update": { error: null },
    });
    await atualizarDataDaUltimaConsulta(client, ORG_ID, CONTACT_ID, DATA_ISO);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      tabela: "contacts",
      valores: { custom_fields: { convenio: "Unimed", data_ultima_consulta: DATA_ISO } },
    });
  });

  it("acha pelo RÓTULO quando a chave não bate (a clínica escolhe o nome do campo)", async () => {
    const { client, updates } = fakeSupabase({
      crm_pipelines: [
        pipeline({
          fields: [campo({ key: "ultima_visita_odonto", label: "Última consulta", escopo: "contato" })],
        }),
      ],
      "contacts:maybeSingle": { custom_fields: {} },
      "contacts:update": { error: null },
    });
    await atualizarDataDaUltimaConsulta(client, ORG_ID, CONTACT_ID, DATA_ISO);

    expect(updates).toHaveLength(1);
    expect((updates[0]!.valores as { custom_fields: Record<string, unknown> }).custom_fields).toHaveProperty(
      "ultima_visita_odonto",
      DATA_ISO,
    );
  });

  it("falha na escrita é logada, nunca lança", async () => {
    const { client } = fakeSupabase({
      crm_pipelines: [pipeline({ fields: [campo({ escopo: "contato" })] })],
      "contacts:maybeSingle": { custom_fields: {} },
      "contacts:update": { error: { message: "boom" } },
    });
    await expect(atualizarDataDaUltimaConsulta(client, ORG_ID, CONTACT_ID, DATA_ISO)).resolves.toBeUndefined();
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });
});
