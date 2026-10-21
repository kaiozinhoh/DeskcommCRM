// components/contacts/EmitirAtestadoDialog.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { full_name: "Dra. Ana" } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const PACIENTE_ID = "aaaaaaaa-0000-4000-8000-000000000001";

describe("EmitirAtestadoDialog", () => {
  it("motivo vazio não chama o servidor", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const { EmitirAtestadoDialog } = await import("./EmitirAtestadoDialog");
    render(<EmitirAtestadoDialog open onOpenChange={() => {}} pacienteId={PACIENTE_ID} />);

    fireEvent.click(screen.getByTestId("confirmar-atestado"));
    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled());
  });

  it("preenchido, chama POST no endpoint certo e abre o PDF numa aba nova", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" });
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      blob: async () => blob,
    } as Response);
    const createObjectUrl = vi.fn(() => "blob:fake");
    global.URL.createObjectURL = createObjectUrl;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const onOpenChange = vi.fn();

    const { EmitirAtestadoDialog } = await import("./EmitirAtestadoDialog");
    render(<EmitirAtestadoDialog open onOpenChange={onOpenChange} pacienteId={PACIENTE_ID} />);

    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "repouso pós-extração" } });
    fireEvent.change(screen.getByLabelText("CRO"), { target: { value: "123-SP" } });
    fireEvent.click(screen.getByTestId("confirmar-atestado"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(`/api/v1/odontologia/pacientes/${PACIENTE_ID}/atestado`);
    const corpo = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(corpo).toEqual({
      motivo: "repouso pós-extração",
      dias_afastamento: null,
      dentista_nome: "Dra. Ana",
      dentista_cro: "123-SP",
    });
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith("blob:fake", "_blank"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
