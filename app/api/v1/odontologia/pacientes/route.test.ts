/**
 * GET/POST /api/v1/odontologia/pacientes — Fatia 6: Paciente como cadastro próprio.
 *
 * Ler exige `viewer`; cadastrar exige `agent` (mesma RLS da migration 0726). Cadastrar é
 * idempotente: o mesmo `contact_id` duas vezes devolve o MESMO paciente (200 na segunda vez,
 * nunca duplica). Um 42P01 (tabela ausente — módulo não instalado) vira mensagem clara.
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
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";
const PACIENTE_ID = "44444444-4444-4444-8444-444444444444";

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

/** Query builder mínimo: cada tabela resolve com uma FILA de resultados (um por chamada). */
function fakeSupabase(porTabela: Record<string, Array<{ data: unknown; error: { code?: string; message?: string } | null }>>) {
  const filas: Record<string, Array<{ data: unknown; error: unknown }>> = {};
  for (const [tabela, lista] of Object.entries(porTabela)) filas[tabela] = [...lista];

  const from = vi.fn((tabela: string) => {
    const proximo = () => filas[tabela]?.shift() ?? { data: null, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => Promise.resolve(proximo()),
      eq: () => builder,
      in: () => Promise.resolve(proximo()),
      insert: () => builder,
      single: () => Promise.resolve(proximo()),
      maybeSingle: () => Promise.resolve(proximo()),
    };
    return builder;
  });
  return { client: { from } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/odontologia/pacientes", () => {
  it("viewer autenticado → 200 com a lista, contato embutido", async () => {
    autorizadoComo("viewer");
    const { client } = fakeSupabase({
      odontologia_pacientes: [
        { data: [{ id: PACIENTE_ID, contact_id: CONTACT_ID, ativo: true, created_at: "2026-01-01" }], error: null },
      ],
      contacts: [{ data: [{ id: CONTACT_ID, name: "Ana", display_name: "Ana", phone_number: null, tags: [] }], error: null }],
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/pacientes"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      {
        id: PACIENTE_ID,
        contact_id: CONTACT_ID,
        ativo: true,
        created_at: "2026-01-01",
        contact: { id: CONTACT_ID, name: "Ana", display_name: "Ana", phone_number: null, tags: [] },
      },
    ]);
  });

  it("sem role suficiente → repassa o 403 de requireRole", async () => {
    negado();
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/pacientes"));
    expect(res.status).toBe(403);
  });

  it("módulo não instalado (42P01) → 409 com mensagem clara, não 500", async () => {
    autorizadoComo("viewer");
    const { client } = fakeSupabase({ odontologia_pacientes: [{ data: null, error: { code: "42P01" } }] });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/pacientes"));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("module_not_installed");
  });
});

describe("POST /api/v1/odontologia/pacientes", () => {
  function postReq(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/v1/odontologia/pacientes", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  it("agent cadastra um contato existente como paciente → 201", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({
      contacts: [{ data: { id: CONTACT_ID }, error: null }],
      odontologia_pacientes: [{ data: { id: PACIENTE_ID }, error: null }],
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { POST } = await import("./route");
    const res = await POST(postReq({ contact_id: CONTACT_ID }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toEqual({ id: PACIENTE_ID, contact_id: CONTACT_ID });
  });

  it("cadastrar o MESMO contato duas vezes → 200 na segunda, nunca duplica", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({
      contacts: [{ data: { id: CONTACT_ID }, error: null }],
      odontologia_pacientes: [
        { data: null, error: { code: "23505", message: "duplicate" } },
        { data: { id: PACIENTE_ID }, error: null },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { POST } = await import("./route");
    const res = await POST(postReq({ contact_id: CONTACT_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(PACIENTE_ID);
  });

  it("viewer NÃO cadastra paciente — escrita exige agent+", async () => {
    negado();
    const { POST } = await import("./route");
    const res = await POST(postReq({ contact_id: CONTACT_ID }));
    expect(res.status).toBe(403);
  });

  it("contact_id inválido para a organização → 422, nunca cria o cadastro", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({ contacts: [{ data: null, error: null }] });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { POST } = await import("./route");
    const res = await POST(postReq({ contact_id: CONTACT_ID }));

    expect(res.status).toBe(422);
  });
});
