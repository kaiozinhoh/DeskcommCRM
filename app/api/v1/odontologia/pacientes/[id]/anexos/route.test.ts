// @vitest-environment node
/**
 * GET/POST /api/v1/odontologia/pacientes/[id]/anexos — anexos do prontuário (Fatia 7).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
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
      order: () => Promise.resolve(resultado),
      eq: () => builder,
      insert: () => builder,
      single: () => Promise.resolve(resultado),
      maybeSingle: () => Promise.resolve(resultado),
    };
    return builder;
  });
  return { client: { from } };
}

function fakeAdmin(signedUrl = "https://exemplo.supabase.co/sign/x") {
  const storage = {
    from: () => ({
      createSignedUrl: vi.fn(async () => ({ data: { signedUrl }, error: null })),
      upload: vi.fn(async () => ({ error: null })),
      remove: vi.fn(async () => ({ error: null })),
    }),
  };
  return { storage };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const params = Promise.resolve({ id: PACIENTE_ID });

describe("GET /api/v1/odontologia/pacientes/[id]/anexos", () => {
  it("viewer autenticado → 200 com signed URL", async () => {
    autorizadoComo("viewer");
    const { client } = fakeSupabase({
      odontologia_prontuario_anexos: {
        data: [
          {
            id: "a1",
            nome_arquivo: "raio-x.png",
            tipo_mime: "image/png",
            tamanho_bytes: 1000,
            storage_path: `${ORG_ID}/${PACIENTE_ID}/a1.png`,
            created_at: "2026-01-01",
          },
        ],
        error: null,
      },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin() as never);

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/anexos"), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      {
        id: "a1",
        nome_arquivo: "raio-x.png",
        tipo_mime: "image/png",
        tamanho_bytes: 1000,
        created_at: "2026-01-01",
        url: "https://exemplo.supabase.co/sign/x",
      },
    ]);
  });

  it("módulo não instalado (42P01) → 409", async () => {
    autorizadoComo("viewer");
    const { client } = fakeSupabase({ odontologia_prontuario_anexos: { data: null, error: { code: "42P01" } } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/anexos"), { params });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/v1/odontologia/pacientes/[id]/anexos", () => {
  function postReq(file: File): NextRequest {
    const fd = new FormData();
    fd.set("file", file);
    return new NextRequest("http://localhost/api/v1/odontologia/pacientes/x/anexos", {
      method: "POST",
      body: fd,
    });
  }

  it("agent sobe um PDF → 201", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({
      odontologia_pacientes: { data: { id: PACIENTE_ID }, error: null },
      odontologia_prontuario_anexos: { data: { id: "anexo1" }, error: null },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin() as never);

    const file = new File([new Uint8Array([1, 2, 3])], "exame.pdf", { type: "application/pdf" });
    const { POST } = await import("./route");
    const res = await POST(postReq(file), { params });

    expect(res.status).toBe(201);
  });

  it("viewer NÃO sobe anexo — escrita exige agent+", async () => {
    negado();
    const file = new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" });
    const { POST } = await import("./route");
    const res = await POST(postReq(file), { params });
    expect(res.status).toBe(403);
  });

  it("tipo não suportado (ex.: .docx) → 415, nunca sobe", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({ odontologia_pacientes: { data: { id: PACIENTE_ID }, error: null } });
    vi.mocked(createClient).mockResolvedValue(client as never);
    const admin = fakeAdmin();
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const file = new File([new Uint8Array([1])], "doc.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const { POST } = await import("./route");
    const res = await POST(postReq(file), { params });

    expect(res.status).toBe(415);
  });

  it("paciente inexistente → 404, nunca sobe o arquivo", async () => {
    autorizadoComo("agent");
    const { client } = fakeSupabase({ odontologia_pacientes: { data: null, error: null } });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const file = new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" });
    const { POST } = await import("./route");
    const res = await POST(postReq(file), { params });

    expect(res.status).toBe(404);
  });
});
