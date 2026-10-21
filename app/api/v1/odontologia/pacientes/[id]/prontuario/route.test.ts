/**
 * GET /api/v1/odontologia/pacientes/[id]/prontuario — PDF compilado (Fatia 7).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/propostas/marca-da-organizacao-para-pdf", () => ({
  marcaDaOrganizacaoParaPdf: vi.fn(async () => ({ appName: "Clínica", accentHex: null, logoUrl: null })),
}));
vi.mock("@/lib/catalogo/moeda-da-org", () => ({ moedaDaOrganizacao: vi.fn(async () => "BRL") }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";
const PACIENTE_ID = "44444444-4444-4444-8444-444444444444";

function usuario(): AuthUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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

function fakeSupabase(porTabela: Record<string, { data: unknown; error: { code?: string } | null }>) {
  const from = vi.fn((tabela: string) => {
    const resultado = porTabela[tabela] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      eq: () => builder,
      in: () => Promise.resolve(resultado),
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

describe("GET /api/v1/odontologia/pacientes/[id]/prontuario", () => {
  it("gera o PDF (200, application/pdf)", async () => {
    autorizado();
    const { client } = fakeSupabase({
      odontologia_pacientes: { data: { id: PACIENTE_ID, contact_id: CONTACT_ID }, error: null },
      contacts: { data: { id: CONTACT_ID, name: "Ana", display_name: "Ana", phone_number: null }, error: null },
      odontologia_atendimentos: { data: [], error: null },
      odontologia_atendimento_procedimentos: { data: [], error: null },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/prontuario"), { params });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
  });

  it("sem role suficiente → repassa o 403", async () => {
    negado();
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/prontuario"), { params });
    expect(res.status).toBe(403);
  });

  it("paciente inexistente → 404", async () => {
    autorizado();
    const { client } = fakeSupabase({ odontologia_pacientes: { data: null, error: null } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/prontuario"), { params });
    expect(res.status).toBe(404);
  });

  it("módulo não instalado (42P01) → 409", async () => {
    autorizado();
    const { client } = fakeSupabase({ odontologia_pacientes: { data: null, error: { code: "42P01" } } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/prontuario"), { params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("module_not_installed");
  });
});
