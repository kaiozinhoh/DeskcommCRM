import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { logger } from "@/lib/logger";

import {
  garantirTipoDeAgendamentoOdontologico,
  SLUG_DO_TIPO_PADRAO_ODONTOLOGIA,
} from "./tipo-de-agendamento-padrao";

const ORG_ID = "22222222-2222-4222-8222-222222222222";

function fakeSupabase(resultado: { error: { message: string } | null }) {
  const upsert = vi.fn().mockResolvedValue(resultado);
  return { client: { from: () => ({ upsert }) } as never, upsert };
}

describe("garantirTipoDeAgendamentoOdontologico", () => {
  it("faz upsert idempotente (ignoreDuplicates) pelo slug estável", async () => {
    const { client, upsert } = fakeSupabase({ error: null });
    await garantirTipoDeAgendamentoOdontologico(client, ORG_ID);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: ORG_ID,
        slug: SLUG_DO_TIPO_PADRAO_ODONTOLOGIA,
        category: "consulta",
      }),
      { onConflict: "organization_id,slug", ignoreDuplicates: true },
    );
  });

  it("falha na escrita é logada, nunca lança", async () => {
    const { client } = fakeSupabase({ error: { message: "boom" } });
    await expect(garantirTipoDeAgendamentoOdontologico(client, ORG_ID)).resolves.toBeUndefined();
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });
});
