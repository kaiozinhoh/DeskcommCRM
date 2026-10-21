// app/app/odontologia/procedimentos/_client.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { get, post, patch } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import { ApiError } from "@/lib/api/types";

import { Procedimentos } from "./_client";

function renderComQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const PROCEDIMENTO = {
  id: "p1",
  nome: "Limpeza",
  duracao_min: 30,
  valor_referencia_cents: 15000,
  ativo: true,
  ordem: 0,
};

describe("tela de procedimentos", () => {
  it("lista os procedimentos recebidos da API", async () => {
    get.mockResolvedValue({ data: [PROCEDIMENTO] });
    renderComQuery(<Procedimentos podeGerenciar={false} />);
    await waitFor(() => expect(screen.getByText("Limpeza")).toBeInTheDocument());
    expect(screen.getByText(/30/)).toBeInTheDocument();
  });

  it("módulo não instalado mostra a mensagem da API, não um erro genérico", async () => {
    get.mockRejectedValue(new ApiError(409, "module_not_installed", undefined, "req-1", "Módulo não instalado."));
    renderComQuery(<Procedimentos podeGerenciar={false} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Módulo não instalado."));
  });

  it("sem podeGerenciar, não mostra o formulário nem os botões de gerenciar", async () => {
    get.mockResolvedValue({ data: [PROCEDIMENTO] });
    renderComQuery(<Procedimentos podeGerenciar={false} />);
    await waitFor(() => expect(screen.getByText("Limpeza")).toBeInTheDocument());
    expect(screen.queryByTestId("salvar-procedimento")).not.toBeInTheDocument();
    expect(screen.queryByTestId("arquivar-p1")).not.toBeInTheDocument();
  });

  it("manager cria um procedimento pelo formulário", async () => {
    get.mockResolvedValue({ data: [] });
    post.mockResolvedValue({ data: { ...PROCEDIMENTO, id: "p2" } });
    renderComQuery(<Procedimentos podeGerenciar={true} />);
    await waitFor(() => expect(screen.getByTestId("procedimento-nome")).toBeInTheDocument());

    const usuario = userEvent.setup();
    await usuario.type(screen.getByTestId("procedimento-nome"), "Canal");
    await usuario.click(screen.getByTestId("salvar-procedimento"));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/odontologia/procedimentos",
        expect.objectContaining({ nome: "Canal" }),
      ),
    );
  });

  it("manager arquiva um procedimento ativo", async () => {
    get.mockResolvedValue({ data: [PROCEDIMENTO] });
    patch.mockResolvedValue({ data: { ...PROCEDIMENTO, ativo: false } });
    renderComQuery(<Procedimentos podeGerenciar={true} />);
    await waitFor(() => expect(screen.getByTestId("arquivar-p1")).toBeInTheDocument());

    const usuario = userEvent.setup();
    await usuario.click(screen.getByTestId("arquivar-p1"));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/api/v1/odontologia/procedimentos/p1", { ativo: false }),
    );
  });
});
