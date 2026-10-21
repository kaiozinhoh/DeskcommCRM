/**
 * GET /api/v1/odontologia/atendimentos/resumo — última consulta e próximo retorno por paciente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_A = "33333333-3333-4333-8333-333333333333";
const CONTACT_B = "44444444-4444-4444-8444-444444444444";

function usuario(): AuthUser {
  return {
    id: USER_ID,
    email: "a@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR",
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "viewer" }],
  } as AuthUser;
}

function autorizado(): void {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: usuario(),
    org: { orgId: ORG_ID, name: "Org", role: "viewer" },
  } as never);
}

function negado(): void {
  vi.mocked(requireRole).mockResolvedValue({
    ok: false,
    response: fail("forbidden_role", "Papel insuficiente.", 403, {}),
  } as never);
}

function fakeSupabase(resultado: { data: unknown; error: { code?: string } | null }) {
  let chamadasDeIn = 0;
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    in: () => {
      chamadasDeIn += 1;
      return chamadasDeIn >= 2 ? Promise.resolve(resultado) : builder;
    },
  };
  return { client: { from: () => builder } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/odontologia/atendimentos/resumo", () => {
  function req(qs: string): NextRequest {
    return new NextRequest(`http://localhost/api/v1/odontologia/atendimentos/resumo${qs}`);
  }

  it("sem role suficiente → repassa o 403", async () => {
    negado();
    const { GET } = await import("./route");
    const res = await GET(req(`?contact_ids=${CONTACT_A}`));
    expect(res.status).toBe(403);
  });

  it("sem contact_ids → 200 com objeto vazio, sem consultar o banco", async () => {
    autorizado();
    const { GET } = await import("./route");
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({});
  });

  it("agrega a última consulta concluída e o próximo retorno agendado por paciente", async () => {
    autorizado();
    const futuro = new Date(Date.now() + 86_400_000).toISOString();
    const maisFuturo = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const { client } = fakeSupabase({
      data: [
        { contact_id: CONTACT_A, status: "concluido", data_hora: "2026-01-01T10:00:00Z" },
        { contact_id: CONTACT_A, status: "concluido", data_hora: "2026-06-01T10:00:00Z" },
        { contact_id: CONTACT_A, status: "agendado", data_hora: maisFuturo },
        { contact_id: CONTACT_A, status: "agendado", data_hora: futuro },
        { contact_id: CONTACT_B, status: "concluido", data_hora: "2026-03-01T10:00:00Z" },
      ],
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(req(`?contact_ids=${CONTACT_A},${CONTACT_B}`));
    const body = await res.json();

    expect(body.data[CONTACT_A]).toEqual({ ultima_consulta: "2026-06-01T10:00:00Z", proximo_retorno: futuro });
    expect(body.data[CONTACT_B]).toEqual({ ultima_consulta: "2026-03-01T10:00:00Z", proximo_retorno: null });
  });

  it("módulo não instalado (42P01) → 409 com mensagem clara", async () => {
    autorizado();
    const { client } = fakeSupabase({ data: null, error: { code: "42P01" } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(req(`?contact_ids=${CONTACT_A}`));
    expect(res.status).toBe(409);
  });
});
