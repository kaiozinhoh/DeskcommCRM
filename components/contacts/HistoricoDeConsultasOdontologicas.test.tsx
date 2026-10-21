// components/contacts/HistoricoDeConsultasOdontologicas.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));

import { HistoricoDeConsultasOdontologicas } from "./HistoricoDeConsultasOdontologicas";

const CONTACT_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function renderComQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("histórico de consultas odontológicas", () => {
  it("sem consulta nenhuma, mostra a mensagem vazia e o botão de nova consulta", async () => {
    get.mockResolvedValue({ data: [] });
    renderComQuery(<HistoricoDeConsultasOdontologicas contactId={CONTACT_ID} />);
    await waitFor(() => expect(screen.getByText("Nenhuma consulta ainda.")).toBeInTheDocument());
    expect(screen.getByText("Nova consulta").closest("a")).toHaveAttribute(
      "href",
      `/app/agenda?contato=${CONTACT_ID}`,
    );
  });

  it("separa agendado (Próximas) do que já aconteceu (Histórico)", async () => {
    get.mockResolvedValue({
      data: [
        {
          id: "a1",
          status: "agendado",
          data_hora: "2027-01-01T10:00:00Z",
          observacao: null,
          valor_cobrado_cents: null,
          dente_regiao: null,
          procedimentos: [{ id: "p1", nome: "Limpeza" }],
        },
        {
          id: "a2",
          status: "concluido",
          data_hora: "2026-01-01T10:00:00Z",
          observacao: "Tudo certo",
          valor_cobrado_cents: 15000,
          dente_regiao: "36",
          procedimentos: [{ id: "p2", nome: "Canal" }],
        },
      ],
    });
    renderComQuery(<HistoricoDeConsultasOdontologicas contactId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByText("Próximas")).toBeInTheDocument());
    expect(screen.getByText("Histórico")).toBeInTheDocument();
    expect(screen.getByTestId("atendimento-a1")).toBeInTheDocument();
    expect(screen.getByTestId("atendimento-a2")).toBeInTheDocument();
    expect(screen.getByText("Tudo certo")).toBeInTheDocument();
  });
});
