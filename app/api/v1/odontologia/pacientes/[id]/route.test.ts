/**
 * GET/PATCH /api/v1/odontologia/pacientes/[id] — detalhe e arquivar/reativar (Fatia 6).
 *
 * Arquivar/reativar exige `manager` (mesma régua de quem corrige um atendimento já registrado).
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
const PACIENTE_ID = "44444444-4444-4444-8444-444444444444";

function usuario(role: "viewer" | "manager"): AuthUser {
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

function autorizadoComo(role: "viewer" | "manager"): void {
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

function fakeSupabase(porTabela: Record<string, { data: unknown; error: { code?: string } | null }>) {
  const from = vi.fn((tabela: string) => {
    const resultado = porTabela[tabela] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      update: () => builder,
      maybeSingle: () => Promise.resolve(resultado),
    };
    return builder;
  });
  return { client: { from } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const params = Promise.resolve({ id: PACIENTE_ID });

describe("GET /api/v1/odontologia/pacientes/[id]", () => {
  it("viewer autenticado → 200 com o contato embutido", async () => {
    autorizadoComo("viewer");
    const { client } = fakeSupabase({
      odontologia_pacientes: {
        data: { id: PACIENTE_ID, contact_id: CONTACT_ID, ativo: true, created_at: "x", updated_at: "x" },
        error: null,
      },
      contacts: { data: { id: CONTACT_ID, name: "Ana" }, error: null },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x"), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(PACIENTE_ID);
    expect(body.data.contact).toEqual({ id: CONTACT_ID, name: "Ana" });
  });

  it("paciente inexistente → 404", async () => {
    autorizadoComo("viewer");
    const { client } = fakeSupabase({ odontologia_pacientes: { data: null, error: null } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x"), { params });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/odontologia/pacientes/[id]", () => {
  function patchReq(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/v1/odontologia/pacientes/x", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  it("manager arquiva → audit paciente_arquivado", async () => {
    autorizadoComo("manager");
    const { client } = fakeSupabase({ odontologia_pacientes: { data: { id: PACIENTE_ID }, error: null } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ ativo: false }), { params });

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "odontologia.paciente_arquivado" }));
  });

  it("manager reativa → audit paciente_reativado", async () => {
    autorizadoComo("manager");
    const { client } = fakeSupabase({ odontologia_pacientes: { data: { id: PACIENTE_ID }, error: null } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ ativo: true }), { params });

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "odontologia.paciente_reativado" }));
  });

  it("viewer NÃO arquiva — exige manager+", async () => {
    negado();
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ ativo: false }), { params });
    expect(res.status).toBe(403);
  });

  it("paciente inexistente → 404", async () => {
    autorizadoComo("manager");
    const { client } = fakeSupabase({ odontologia_pacientes: { data: null, error: null } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ ativo: false }), { params });
    expect(res.status).toBe(404);
  });
});
