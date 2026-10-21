// components/contacts/ProntuarioEAnexos.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));

const CONTACT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PACIENTE_ID = "bbbbbbbb-0000-4000-8000-000000000002";

function renderComQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function montarComRole(role: "agent" | "manager", anexos: unknown[]) {
  vi.doMock("@/hooks/auth/AuthProvider", () => ({
    useAuth: () => ({ activeOrg: { role } }),
  }));
  get.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/v1/odontologia/pacientes?contact_id=")) {
      return { data: [{ id: PACIENTE_ID, contact_id: CONTACT_ID }] };
    }
    return { data: anexos };
  });
  const { ProntuarioEAnexos } = await import("./ProntuarioEAnexos");
  renderComQuery(<ProntuarioEAnexos contactId={CONTACT_ID} />);
}

describe("ProntuarioEAnexos", () => {
  it("contato sem cadastro de paciente → não desenha nada", async () => {
    vi.resetModules();
    vi.doMock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => ({ activeOrg: { role: "agent" } }) }));
    get.mockResolvedValue({ data: [] });
    const { ProntuarioEAnexos } = await import("./ProntuarioEAnexos");
    renderComQuery(<ProntuarioEAnexos contactId={CONTACT_ID} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId("prontuario-e-anexos")).not.toBeInTheDocument();
  });

  it("paciente com anexos: lista, mas agent NÃO vê botão de remover", async () => {
    vi.resetModules();
    await montarComRole("agent", [
      { id: "a1", nome_arquivo: "raio-x.png", tipo_mime: "image/png", tamanho_bytes: 2048, created_at: "x", url: "https://x" },
    ]);
    await waitFor(() => expect(screen.getByText("raio-x.png")).toBeInTheDocument());
    expect(screen.queryByTestId("remover-anexo-a1")).not.toBeInTheDocument();
  });

  it("manager vê o botão de remover o anexo", async () => {
    vi.resetModules();
    await montarComRole("manager", [
      { id: "a1", nome_arquivo: "exame.pdf", tipo_mime: "application/pdf", tamanho_bytes: 100, created_at: "x", url: "https://x" },
    ]);
    await waitFor(() => expect(screen.getByTestId("remover-anexo-a1")).toBeInTheDocument());
  });

  it("link de baixar o prontuário aponta pro endpoint certo", async () => {
    vi.resetModules();
    await montarComRole("agent", []);
    await waitFor(() => expect(screen.getByTestId("prontuario-e-anexos")).toBeInTheDocument());
    expect(screen.getByText("Baixar prontuário em PDF").closest("a")).toHaveAttribute(
      "href",
      `/api/v1/odontologia/pacientes/${PACIENTE_ID}/prontuario`,
    );
  });
});
