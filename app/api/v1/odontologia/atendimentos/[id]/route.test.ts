/**
 * PATCH /api/v1/odontologia/atendimentos/[id] — registra o desfecho ou corrige.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ATENDIMENTO_ID = "44444444-4444-4444-8444-444444444444";

function usuario(role: "agent" | "manager"): AuthUser {
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

function autorizadoComo(role: "agent" | "manager"): void {
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

/** `statusAntes` é o que a leitura (`maybeSingle`) devolve antes do update. */
function fakeSupabase(statusAntes: string | null, resultadoUpdate: { data: unknown; error: { code?: string } | null }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    update: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: statusAntes ? { status: statusAntes } : null, error: null }),
    single: () => Promise.resolve(resultadoUpdate),
  };
  return { client: { from: () => builder } };
}

function patchReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/odontologia/atendimentos/${ATENDIMENTO_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function ctx() {
  return { params: Promise.resolve({ id: ATENDIMENTO_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/v1/odontologia/atendimentos/[id]", () => {
  it("agent registra o desfecho de um atendimento ainda agendado", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase("agendado", {
      data: { id: ATENDIMENTO_ID, status: "concluido" },
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ status: "concluido" }), ctx());

    expect(res.status).toBe(200);
  });

  it("agent NÃO corrige um atendimento já concluído — exige manager+", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase("concluido", { data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ observacao: "corrigindo" }), ctx());

    expect(res.status).toBe(403);
  });

  it("manager corrige um atendimento já concluído — controle positivo", async () => {
    autorizadoComo("manager");
    const { client } = fakeSupabase("concluido", {
      data: { id: ATENDIMENTO_ID, status: "concluido", observacao: "corrigido" },
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ observacao: "corrigido" }), ctx());

    expect(res.status).toBe(200);
  });

  it("viewer/sem role NÃO acessa — write exige agent+", async () => {
    negado();
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ status: "concluido" }), ctx());
    expect(res.status).toBe(403);
  });

  it("corpo vazio → 422, nunca chega ao banco", async () => {
    autorizadoComo("agent");
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({}), ctx());
    expect(res.status).toBe(422);
  });

  it("atendimento de outra organização → 404 (leitura não encontra)", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase(null, { data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ status: "concluido" }), ctx());
    expect(res.status).toBe(404);
  });
});
