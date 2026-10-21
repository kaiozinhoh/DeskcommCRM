// components/agenda/AtendimentoOdontologico.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { get, patch } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import { AtendimentoOdontologico } from "./AtendimentoOdontologico";

const APPOINTMENT_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function renderComQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("bloco de atendimento odontológico", () => {
  it("sem atendimento vinculado a este compromisso, não renderiza nada", async () => {
    get.mockResolvedValue({ data: [] });
    const { container } = renderComQuery(<AtendimentoOdontologico appointmentId={APPOINTMENT_ID} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("atendimento previsto (agendado) mostra o procedimento e os botões de registrar", async () => {
    get.mockResolvedValue({
      data: [
        {
          id: "at-1",
          status: "agendado",
          observacao: null,
          valor_cobrado_cents: null,
          dente_regiao: null,
          procedimentos: [{ id: "p1", nome: "Limpeza" }],
        },
      ],
    });
    renderComQuery(<AtendimentoOdontologico appointmentId={APPOINTMENT_ID} />);
    await waitFor(() => expect(screen.getByText("Limpeza")).toBeInTheDocument());
    expect(screen.getByTestId("registrar-atendimento")).toBeInTheDocument();
    expect(screen.getByTestId("atendimento-marcar-faltou")).toBeInTheDocument();
  });

  it("registrar atendimento chama PATCH com status concluido e os campos preenchidos", async () => {
    get.mockResolvedValue({
      data: [
        {
          id: "at-1",
          status: "agendado",
          observacao: null,
          valor_cobrado_cents: null,
          dente_regiao: null,
          procedimentos: [],
        },
      ],
    });
    patch.mockResolvedValue({ data: { id: "at-1", status: "concluido" } });
    renderComQuery(<AtendimentoOdontologico appointmentId={APPOINTMENT_ID} />);
    await waitFor(() => expect(screen.getByTestId("registrar-atendimento")).toBeInTheDocument());

    const usuario = userEvent.setup();
    await usuario.type(screen.getByTestId("atendimento-dente-regiao"), "36");
    await usuario.click(screen.getByTestId("registrar-atendimento"));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        "/api/v1/odontologia/atendimentos/at-1",
        expect.objectContaining({ status: "concluido", dente_regiao: "36" }),
      ),
    );
  });

  it("atendimento já registrado mostra o status, sem o formulário", async () => {
    get.mockResolvedValue({
      data: [
        {
          id: "at-1",
          status: "concluido",
          observacao: "Tudo certo",
          valor_cobrado_cents: 15000,
          dente_regiao: null,
          procedimentos: [{ id: "p1", nome: "Limpeza" }],
        },
      ],
    });
    renderComQuery(<AtendimentoOdontologico appointmentId={APPOINTMENT_ID} />);
    await waitFor(() => expect(screen.getByText("Concluído")).toBeInTheDocument());
    expect(screen.getByText("Tudo certo")).toBeInTheDocument();
    expect(screen.queryByTestId("registrar-atendimento")).not.toBeInTheDocument();
  });
});
