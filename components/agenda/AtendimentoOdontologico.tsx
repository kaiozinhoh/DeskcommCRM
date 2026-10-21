"use client";
/**
 * O bloco "Atendimento" dentro do detalhe do compromisso — módulo opcional Odontologia
 * (ADR-0002). Só aparece quando o módulo está instalado E este compromisso nasceu com um
 * procedimento previsto (a Agenda marcou pelo seletor de procedimento, Fatia 4).
 *
 * ⚠️ Compromisso sem atendimento vinculado não ganha este bloco — registrar um atendimento
 * retroativo (sem ter sido previsto na marcação) fica para a ficha do paciente, não aqui. Fora
 * disso, este registro não substitui o prontuário da clínica.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type Atendimento = {
  id: string;
  status: "agendado" | "concluido" | "faltou" | "cancelado";
  observacao: string | null;
  valor_cobrado_cents: number | null;
  dente_regiao: string | null;
  procedimentos: { id: string; nome: string }[];
};

export function AtendimentoOdontologico({ appointmentId }: { appointmentId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [observacao, setObservacao] = useState("");
  const [denteRegiao, setDenteRegiao] = useState("");
  const [valor, setValor] = useState("");

  const query = useQuery({
    queryKey: ["odontologia", "atendimentos", "compromisso", appointmentId],
    queryFn: async () =>
      (
        await apiClient.get<{ data: Atendimento[] }>(
          `/api/v1/odontologia/atendimentos?appointment_id=${appointmentId}`,
        )
      ).data,
    retry: false,
  });

  const registrar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) =>
      apiClient.patch<{ data: Atendimento }>(
        `/api/v1/odontologia/atendimentos/${atendimento?.id}`,
        corpo,
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["odontologia", "atendimentos"] }),
    onError: showApiError,
  });

  // Módulo não instalado, erro de carga, ou nenhum procedimento previsto para este
  // compromisso: nada a mostrar — não é erro, é ausência de dado.
  const atendimento = (query.data ?? [])[0];
  if (query.isError || !atendimento) return null;

  const previsto = atendimento.status === "agendado";

  return (
    <div className="rounded-lg border p-3" data-testid="bloco-atendimento-odontologico">
      <p className="mb-2 text-sm font-semibold">{t("Atendimento")}</p>
      <p className="text-sm text-text-muted">
        {atendimento.procedimentos.length > 0
          ? atendimento.procedimentos.map((p) => p.nome).join(", ")
          : t("Sem procedimento previsto")}
      </p>

      {previsto ? (
        <div className="mt-3 space-y-2">
          <label className="block">
            {t("Dente/região")} <span className="font-normal opacity-70">({t("opcional")})</span>
            <input
              value={denteRegiao}
              data-testid="atendimento-dente-regiao"
              onChange={(e) => setDenteRegiao(e.target.value)}
              className="mt-1 w-full rounded-md border bg-surface p-2 text-sm"
            />
          </label>
          <label className="block">
            {t("Observação")} <span className="font-normal opacity-70">({t("opcional")})</span>
            <textarea
              value={observacao}
              rows={2}
              data-testid="atendimento-observacao"
              onChange={(e) => setObservacao(e.target.value)}
              className="mt-1 w-full resize-none rounded-md border bg-surface p-2 text-sm"
            />
          </label>
          <label className="block">
            {t("Valor cobrado")} <span className="font-normal opacity-70">({t("opcional")})</span>
            <input
              value={valor}
              inputMode="decimal"
              placeholder="0,00"
              data-testid="atendimento-valor"
              onChange={(e) => setValor(e.target.value)}
              className="mt-1 w-32 rounded-md border bg-surface p-2 text-sm"
            />
          </label>
          <p className="text-xs text-text-muted">
            {t("Este registro não substitui o prontuário da clínica.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              data-testid="registrar-atendimento"
              disabled={registrar.isPending}
              onClick={() =>
                registrar.mutate({
                  status: "concluido",
                  dente_regiao: denteRegiao.trim() || undefined,
                  observacao: observacao.trim() || undefined,
                  valor_cobrado_cents: valor
                    ? Math.round(Number(valor.replace(",", ".")) * 100)
                    : undefined,
                })
              }
            >
              {t("Registrar atendimento")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="atendimento-marcar-faltou"
              disabled={registrar.isPending}
              onClick={() => registrar.mutate({ status: "faltou" })}
            >
              {t("Marcar faltou")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <Badge variant={atendimento.status === "concluido" ? "success" : "neutral"}>
            {t(
              (
                {
                  concluido: "Concluído",
                  faltou: "Faltou",
                  cancelado: "Cancelado",
                } as Record<string, string>
              )[atendimento.status] ?? atendimento.status,
            )}
          </Badge>
          {atendimento.observacao ? (
            <p className="text-sm text-text-muted">{atendimento.observacao}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
