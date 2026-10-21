/**
 * POST /api/v1/odontologia/pacientes/[id]/atestado — atestado em PDF (Fatia 8).
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
vi.mock("@/lib/propostas/marca-da-organizacao-para-pdf", () => ({
  marcaDaOrganizacaoParaPdf: vi.fn(async () => ({ appName: "Clínica", accentHex: null, logoUrl: null })),
}));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";
const PACIENTE_ID = "44444444-4444-4444-8444-444444444444";

function usuario(role: "viewer" | "agent"): AuthUser {
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

function fakeSupabase(porTabela: Record<string, { data: unknown; error: { code?: string } | null }>) {
  const from = vi.fn((tabela: string) => {
    const resultado = porTabela[tabela] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
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

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/atestado", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const corpoValido = {
  motivo: "necessita de repouso após extração",
  dias_afastamento: 2,
  dentista_nome: "Dra. Ana",
  dentista_cro: "12345-SP",
};

describe("POST /api/v1/odontologia/pacientes/[id]/atestado", () => {
  it("agent emite o atestado → 200, application/pdf, audit SEM motivo/nome do dentista", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({
      odontologia_pacientes: { data: { id: PACIENTE_ID, contact_id: CONTACT_ID }, error: null },
      contacts: { data: { id: CONTACT_ID, name: "Beto", display_name: "Beto", phone_number: null }, error: null },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { POST } = await import("./route");
    const res = await POST(postReq(corpoValido), { params });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "odontologia.atestado_emitido",
        metadata: { paciente_id: PACIENTE_ID, dias_afastamento: 2 },
      }),
    );
    const chamada = vi.mocked(audit).mock.calls[0]?.[0] as { metadata?: Record<string, unknown> };
    expect(JSON.stringify(chamada.metadata)).not.toMatch(/repouso|Dra\. Ana/);
  });

  it("viewer NÃO emite — exige agent+", async () => {
    negado();
    const { POST } = await import("./route");
    const res = await POST(postReq(corpoValido), { params });
    expect(res.status).toBe(403);
  });

  it("motivo vazio → 422, nunca gera o PDF", async () => {
    autorizadoComo("agent");
    const { POST } = await import("./route");
    const res = await POST(postReq({ ...corpoValido, motivo: "" }), { params });
    expect(res.status).toBe(422);
  });

  it("sem dias_afastamento (atestado sem afastamento) → 200 mesmo assim", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({
      odontologia_pacientes: { data: { id: PACIENTE_ID, contact_id: CONTACT_ID }, error: null },
      contacts: { data: { id: CONTACT_ID, name: "Beto", display_name: "Beto", phone_number: null }, error: null },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { dias_afastamento: _omit, ...semDias } = corpoValido;
    const { POST } = await import("./route");
    const res = await POST(postReq(semDias), { params });

    expect(res.status).toBe(200);
  });

  it("paciente inexistente → 404", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({ odontologia_pacientes: { data: null, error: null } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { POST } = await import("./route");
    const res = await POST(postReq(corpoValido), { params });
    expect(res.status).toBe(404);
  });

  it("módulo não instalado (42P01) → 409", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({ odontologia_pacientes: { data: null, error: { code: "42P01" } } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { POST } = await import("./route");
    const res = await POST(postReq(corpoValido), { params });
    expect(res.status).toBe(409);
  });
});
