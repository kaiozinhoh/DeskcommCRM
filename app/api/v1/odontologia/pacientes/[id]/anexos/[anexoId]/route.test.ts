/**
 * DELETE /api/v1/odontologia/pacientes/[id]/anexos/[anexoId] — remoção (Fatia 7).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PACIENTE_ID = "44444444-4444-4444-8444-444444444444";
const ANEXO_ID = "55555555-5555-4555-8555-555555555555";

function usuario(role: "agent" | "manager"): AuthUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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

function fakeSupabase(resultadoBusca: { data: unknown; error: { code?: string } | null }, resultadoDelete: { error: unknown } = { error: null }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(resultadoBusca),
    delete: () => ({ eq: () => Promise.resolve(resultadoDelete) }),
  };
  return { client: { from: () => builder } };
}

function fakeAdmin(removeError: unknown = null) {
  return { storage: { from: () => ({ remove: vi.fn(async () => ({ error: removeError })) }) } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const params = Promise.resolve({ id: PACIENTE_ID, anexoId: ANEXO_ID });

describe("DELETE /api/v1/odontologia/pacientes/[id]/anexos/[anexoId]", () => {
  it("manager remove → 200, storage e banco chamados, audit emitido", async () => {
    autorizadoComo("manager");
    const { client } = fakeSupabase({ data: { id: ANEXO_ID, storage_path: "x/y/z.pdf" }, error: null });
    vi.mocked(createClient).mockResolvedValue(client as never);
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin() as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/anexos/y"), { params });

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "odontologia.prontuario_anexo_removido" }),
    );
  });

  it("agent NÃO remove — exige manager+", async () => {
    negado();
    const { DELETE } = await import("./route");
    const res = await DELETE(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/anexos/y"), { params });
    expect(res.status).toBe(403);
  });

  it("anexo inexistente → 404", async () => {
    autorizadoComo("manager");
    const { client } = fakeSupabase({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/anexos/y"), { params });
    expect(res.status).toBe(404);
  });

  it("falha ao remover do storage → 500, sem apagar a linha do banco", async () => {
    autorizadoComo("manager");
    let deleteChamado = false;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => Promise.resolve({ data: { id: ANEXO_ID, storage_path: "x/y/z.pdf" }, error: null }),
      delete: () => {
        deleteChamado = true;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    };
    vi.mocked(createClient).mockResolvedValue({ from: () => builder } as never);
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ message: "falhou" }) as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/anexos/y"), { params });

    expect(res.status).toBe(500);
    expect(deleteChamado).toBe(false);
  });
});
