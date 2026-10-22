/**
 * O CONTATO QUE JÁ EXISTE NÃO VIRA UM TOAST MORTO.
 *
 * `POST /api/v1/contacts` recusa com 409 `contact_exists` (e `details.contact_id`)
 * quando o telefone/e-mail/CPF digitado já é de um contato VIVO da organização
 * (app/api/v1/contacts/_handler.ts). Até aqui, quem tentasse "criar" alguém que já
 * existe só via o toast de erro e ficava sem próximo passo — achado real na tela de
 * Pacientes (Fatia 6): "Novo paciente" com o telefone de um contato já cadastrado
 * recusava, e não havia caminho para cadastrar ESSE contato como paciente.
 *
 * `onContatoExistente` é essa continuação: recebe o `contact_id` do conflito, pra
 * quem chamou decidir o que fazer (a tela de Pacientes cadastra ele como paciente).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NewContactDialog } from "@/components/contacts/NewContactDialog";

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useActiveOrg: () => ({ currency: "BRL", country: null }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

const CONTACT_ID_EXISTENTE = "ct-existente-9";

const CORPO_DO_CONFLITO = {
  error: {
    code: "contact_exists",
    message: "Já existe um contato com este telefone.",
    details: { contact_id: CONTACT_ID_EXISTENTE },
    request_id: "req-1",
  },
};

function envolver(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(CORPO_DO_CONFLITO), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("NewContactDialog · onContatoExistente", () => {
  it("em 409 contact_exists, entrega o contact_id do conflito e fecha o diálogo", async () => {
    const onContatoExistente = vi.fn();
    const onOpenChange = vi.fn();
    const onCriado = vi.fn();
    const user = userEvent.setup();
    envolver(
      <NewContactDialog
        open
        onOpenChange={onOpenChange}
        onCriado={onCriado}
        onContatoExistente={onContatoExistente}
      />,
    );

    await user.type(screen.getByLabelText(/Telefone/i), "+5511999998888");
    await user.click(screen.getByRole("button", { name: /Criar contato/i }));

    await waitFor(() => expect(onContatoExistente).toHaveBeenCalledWith(CONTACT_ID_EXISTENTE));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCriado).not.toHaveBeenCalled();
  });

  it("sem onContatoExistente, o 409 só sai pelo toast — não quebra nada", async () => {
    const user = userEvent.setup();
    envolver(<NewContactDialog open onOpenChange={vi.fn()} />);

    await user.type(screen.getByLabelText(/Telefone/i), "+5511999998888");
    await user.click(screen.getByRole("button", { name: /Criar contato/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });
});
