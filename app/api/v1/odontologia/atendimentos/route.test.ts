/**
 * GET/POST /api/v1/odontologia/atendimentos — módulo opcional de clínica (ADR-0002).
 *
 * Ler exige `viewer`; registrar exige `agent` (mesma RLS da migration 0722). Um 42P01 (tabela
 * ausente — módulo não instalado) vira uma mensagem clara, nunca um 500 cru.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";

function usuario(role: "viewer" | "agent"): AuthUser {
  return {
    id: USER_ID,
    email: "a@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR",
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role }],
  } as AuthUser;
}

function autorizadoComo(role: "viewer" | "agent"): void {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: usuario(role),
    org: { orgId: ORG_ID, name: "Org", role },
  } as never);
}

function negado(): void {
  vi.mocked(requireRole).mockResolvedValue({
    ok: false,
    response: fail("forbidden_role", "Papel insuficiente.", 403, {}),
  } as never);
}

/** Query builder mínimo: cada tabela resolve com o resultado dado para ela. */
function fakeSupabase(porTabela: Record<string, { data: unknown; error: { code?: string } | null }>) {
  const from = vi.fn((tabela: string) => {
    const resultado = porTabela[tabela] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => Promise.resolve(resultado),
      eq: () => builder,
      in: () => Promise.resolve(resultado),
      insert: () => builder,
      single: () => Promise.resolve(resultado),
    };
    return builder;
  });
  return { client: { from } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/odontologia/atendimentos", () => {
  it("viewer autenticado → 200 com a lista", async () => {
    autorizadoComo("viewer");
    const { client } = fakeSupabase({
      odontologia_atendimentos: {
        data: [{ id: "a1", contact_id: CONTACT_ID, status: "agendado" }],
        error: null,
      },
      odontologia_atendimento_procedimentos: { data: [], error: null },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/atendimentos"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([{ id: "a1", contact_id: CONTACT_ID, status: "agendado", procedimentos: [] }]);
  });

  it("sem role suficiente → repassa o 403 de requireRole", async () => {
    negado();
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/atendimentos"));
    expect(res.status).toBe(403);
  });

  it("módulo não instalado (42P01) → 409 com mensagem clara, não 500", async () => {
    autorizadoComo("viewer");
    const { client } = fakeSupabase({
      odontologia_atendimentos: { data: null, error: { code: "42P01" } },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/atendimentos"));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("module_not_installed");
  });
});

describe("POST /api/v1/odontologia/atendimentos", () => {
  function postReq(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/v1/odontologia/atendimentos", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  const corpoValido = { contact_id: CONTACT_ID, data_hora: "2026-11-01T10:00:00Z" };

  it("agent registra um atendimento previsto (sem procedimento) — controle positivo", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({
      odontologia_atendimentos: {
        data: { id: "a1", contact_id: CONTACT_ID, status: "agendado" },
        error: null,
      },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { POST } = await import("./route");
    const res = await POST(postReq(corpoValido));

    expect(res.status).toBe(201);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "odontologia.atendimento_agendado" }),
    );
  });

  it("registro direto já concluído emite odontologia.atendimento_registrado", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({
      odontologia_atendimentos: {
        data: { id: "a1", contact_id: CONTACT_ID, status: "concluido" },
        error: null,
      },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { POST } = await import("./route");
    const res = await POST(postReq({ ...corpoValido, status: "concluido" }));

    expect(res.status).toBe(201);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "odontologia.atendimento_registrado" }),
    );
  });

  it("viewer NÃO registra — write exige agent+", async () => {
    negado();
    const { POST } = await import("./route");
    const res = await POST(postReq(corpoValido));
    expect(res.status).toBe(403);
  });

  it("contact_id ausente → 422, nunca chega ao banco", async () => {
    autorizadoComo("agent");
    const { POST } = await import("./route");
    const res = await POST(postReq({ data_hora: "2026-11-01T10:00:00Z" }));
    expect(res.status).toBe(422);
  });

  it("procedimento de outra organização → 422, e o atendimento não é gravado", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({
      odontologia_procedimentos: { data: [], error: null }, // nenhum achado = inválido
    });
    const from = vi.fn(client.from);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const { POST } = await import("./route");
    const res = await POST(
      postReq({ ...corpoValido, procedimento_ids: ["99999999-9999-4999-8999-999999999999"] }),
    );

    expect(res.status).toBe(422);
    expect(from).not.toHaveBeenCalledWith("odontologia_atendimentos");
  });
});
