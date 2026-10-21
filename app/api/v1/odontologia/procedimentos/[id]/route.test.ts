/**
 * PATCH /api/v1/odontologia/procedimentos/[id] — edita ou arquiva um procedimento.
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
const PROCEDIMENTO_ID = "33333333-3333-4333-8333-333333333333";

function usuario(role: "manager"): AuthUser {
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

function autorizadoComoManager(): void {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: usuario("manager"),
    org: { orgId: ORG_ID, name: "Org", role: "manager" },
  } as never);
}

function negado(): void {
  vi.mocked(requireRole).mockResolvedValue({
    ok: false,
    response: fail("forbidden_role", "Papel insuficiente.", 403, {}),
  } as never);
}

function fakeSupabase(resultado: { data: unknown; error: { code?: string } | null }) {
  const builder: Record<string, unknown> = {
    update: () => builder,
    select: () => builder,
    eq: () => builder,
    single: () => Promise.resolve(resultado),
  };
  return { client: { from: () => builder } };
}

function patchReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/odontologia/procedimentos/${PROCEDIMENTO_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function ctx() {
  return { params: Promise.resolve({ id: PROCEDIMENTO_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/v1/odontologia/procedimentos/[id]", () => {
  it("manager edita o nome", async () => {
    autorizadoComoManager();
    const { client } = fakeSupabase({ data: { id: PROCEDIMENTO_ID, nome: "Canal" }, error: null });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ nome: "Canal" }), ctx());

    expect(res.status).toBe(200);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "odontologia.procedimento_atualizado" }),
    );
  });

  it("arquivar (só ativo:false) emite odontologia.procedimento_arquivado", async () => {
    autorizadoComoManager();
    const { client } = fakeSupabase({ data: { id: PROCEDIMENTO_ID, ativo: false }, error: null });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ ativo: false }), ctx());

    expect(res.status).toBe(200);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "odontologia.procedimento_arquivado" }),
    );
  });

  it("viewer/agent NÃO editam — write exige manager+", async () => {
    negado();
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ nome: "Canal" }), ctx());
    expect(res.status).toBe(403);
  });

  it("corpo vazio → 422, nunca chega ao banco", async () => {
    autorizadoComoManager();
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({}), ctx());
    expect(res.status).toBe(422);
  });

  it("procedimento de outra organização → 404 (PGRST116)", async () => {
    autorizadoComoManager();
    const { client } = fakeSupabase({ data: null, error: { code: "PGRST116" } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ nome: "Canal" }), ctx());
    expect(res.status).toBe(404);
  });

  it("módulo não instalado (42P01) → 409 com mensagem clara", async () => {
    autorizadoComoManager();
    const { client } = fakeSupabase({ data: null, error: { code: "42P01" } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ nome: "Canal" }), ctx());
    expect(res.status).toBe(409);
  });
});
