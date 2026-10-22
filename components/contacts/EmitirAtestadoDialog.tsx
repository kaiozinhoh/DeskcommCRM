"use client";
/**
 * Diálogo de emissão do atestado (Fatia 8) — nome do paciente já vem fixo (é o paciente aberto);
 * o resto é digitado na hora: motivo, dias de afastamento (opcional) e nome+CRO do dentista.
 * Confirmar baixa o PDF numa aba nova — o servidor não guarda nada (ver a rota).
 */
import { useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pacienteId: string;
}

export function EmitirAtestadoDialog({ open, onOpenChange, pacienteId }: Props) {
  const t = useT();
  const { user } = useAuth();
  const [motivo, setMotivo] = useState("");
  const [diasAfastamento, setDiasAfastamento] = useState("");
  const [dentistaNome, setDentistaNome] = useState(user?.full_name ?? "");
  const [dentistaCro, setDentistaCro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function emitir() {
    if (motivo.trim().length === 0) {
      toast.error(t("Descreva o motivo do atestado."));
      return;
    }
    if (dentistaNome.trim().length === 0 || dentistaCro.trim().length === 0) {
      toast.error(t("Informe o nome e o CRO do dentista."));
      return;
    }
    const dias = diasAfastamento.trim() ? Number(diasAfastamento) : null;
    if (dias !== null && (!Number.isInteger(dias) || dias < 1)) {
      toast.error(t("Dias de afastamento deve ser um número inteiro positivo."));
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch(`/api/v1/odontologia/pacientes/${pacienteId}/atestado`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          motivo: motivo.trim(),
          dias_afastamento: dias,
          dentista_nome: dentistaNome.trim(),
          dentista_cro: dentistaCro.trim(),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        toast.error(json.error?.message ? t(json.error.message) : t("Não consegui gerar o atestado."));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      onOpenChange(false);
      setMotivo("");
      setDiasAfastamento("");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Emitir atestado")}</DialogTitle>
          <DialogDescription>
            {t("Gera um PDF simples, pra imprimir e assinar/carimbar à mão.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="atestado-motivo">{t("Motivo")}</Label>
            <Textarea
              id="atestado-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={t("Ex.: foi submetido a procedimento odontológico nesta data.")}
              maxLength={1000}
            />
          </div>
          <div>
            <Label htmlFor="atestado-dias">{t("Dias de afastamento (opcional)")}</Label>
            <Input
              id="atestado-dias"
              type="number"
              min={1}
              value={diasAfastamento}
              onChange={(e) => setDiasAfastamento(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="atestado-dentista-nome">{t("Nome do dentista")}</Label>
            <Input
              id="atestado-dentista-nome"
              value={dentistaNome}
              onChange={(e) => setDentistaNome(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="atestado-dentista-cro">{t("CRO")}</Label>
            <Input
              id="atestado-dentista-cro"
              value={dentistaCro}
              onChange={(e) => setDentistaCro(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            {t("Cancelar")}
          </Button>
          <Button onClick={emitir} disabled={enviando} data-testid="confirmar-atestado">
            {t("Gerar PDF")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
