// app/app/odontologia/pacientes/_client.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useActiveOrg: () => ({ country: "BR" }) }));
vi.mock("@/hooks/contacts/useCreateContact", () => ({
  useCreateContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { Pacientes } from "./_client";

const CONTACT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CONTACT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function renderComQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("tela de pacientes", () => {
  it("lista os contatos como pacientes, com última consulta e próximo retorno", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/v1/contacts")) {
        return {
          data: [
            { id: CONTACT_A, name: "Ana", display_name: "Ana", phone_number: "+5511999999999", tags: ["novo"] },
            { id: CONTACT_B, name: "Beto", display_name: "Beto", phone_number: null, tags: [] },
          ],
        };
      }
      return {
        data: {
          [CONTACT_A]: { ultima_consulta: "2026-01-01T10:00:00Z", proximo_retorno: null },
          [CONTACT_B]: { ultima_consulta: null, proximo_retorno: "2027-01-01T10:00:00Z" },
        },
      };
    });

    renderComQuery(<Pacientes />);

    await waitFor(() => expect(screen.getByTestId("paciente-link-" + CONTACT_A)).toBeInTheDocument());
    expect(screen.getByTestId("paciente-link-" + CONTACT_B)).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Beto")).toBeInTheDocument();
  });

  it("módulo não instalado mostra a mensagem da API, não um erro genérico", async () => {
    const { ApiError } = await import("@/lib/api/types");
    get.mockRejectedValue(new ApiError(409, "module_not_installed", undefined, "req-1", "Módulo não instalado."));
    renderComQuery(<Pacientes />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Módulo não instalado."));
  });
});
