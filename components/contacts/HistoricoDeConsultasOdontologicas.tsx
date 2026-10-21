"use client";
/**
 * Histórico de consultas odontológicas — aba condicional na ficha do contato (módulo
 * opcional Odontologia, ADR-0002, Fatia 5). Reaproveita os MESMOS `contacts` do núcleo —
 * não existe tabela de "paciente" própria, só vocabulário de clínica nesta aba.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { formatCents } from "@/lib/money";

type Atendimento = {
  id: string;
  status: "agendado" | "concluido" | "faltou" | "cancelado";
  data_hora: string;
  observacao: string | null;
  valor_cobrado_cents: number | null;
  dente_regiao: string | null;
  procedimentos: { id: string; nome: string }[];
};

const ROTULO_DO_STATUS: Record<string, string> = {
  agendado: "Agendado",
  concluido: "Concluído",
  faltou: "Faltou",
  cancelado: "Cancelado",
};

function variantDoStatus(status: string): "default" | "success" | "warning" | "neutral" {
  if (status === "concluido") return "success";
  if (status === "faltou") return "warning";
  if (status === "agendado") return "default";
  return "neutral";
}

export function HistoricoDeConsultasOdontologicas({ contactId }: { contactId: string }) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();

  const query = useQuery({
    queryKey: ["odontologia", "atendimentos", "contato", contactId],
    queryFn: async () =>
      (
        await apiClient.get<{ data: Atendimento[] }>(
          `/api/v1/odontologia/atendimentos?contact_id=${contactId}`,
        )
      ).data,
    retry: false,
  });

  if (query.isError) {
    return <p className="text-sm text-danger">{t("Não foi possível carregar o histórico.")}</p>;
  }

  const atendimentos = query.data ?? [];
  // Divide por STATUS, não por "data_hora >= agora": chamar `Date.now()` no corpo do
  // componente é impuro para a regra do React (o resultado mudaria a qualquer
  // milissemundo, sem relação com uma mudança de estado/prop) — e o status já basta,
  // porque um atendimento "agendado" vencido e não registrado é exatamente o que o
  // bloco da Agenda (Fatia 4) existe para fechar, não um segundo relógio aqui.
  const futuros = atendimentos.filter((a) => a.status === "agendado");
  const passados = atendimentos.filter((a) => a.status !== "agendado");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          {t("Este registro não substitui o prontuário da clínica.")}
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href={`/app/agenda?contato=${contactId}`}>{t("Nova consulta")}</Link>
        </Button>
      </div>

      {atendimentos.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nenhuma consulta ainda.")}</p>
      ) : (
        <>
          {futuros.length > 0 ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold">{t("Próximas")}</h3>
              <ListaDeAtendimentos itens={futuros} tagDoIdioma={tagDoIdioma} t={t} />
            </section>
          ) : null}
          {passados.length > 0 ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold">{t("Histórico")}</h3>
              <ListaDeAtendimentos itens={passados} tagDoIdioma={tagDoIdioma} t={t} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ListaDeAtendimentos({
  itens,
  tagDoIdioma,
  t,
}: {
  itens: Atendimento[];
  tagDoIdioma: string;
  t: (s: string) => string;
}) {
  return (
    <ul className="space-y-2">
      {itens.map((a) => (
        <li key={a.id} className="rounded-md border border-border p-3" data-testid={`atendimento-${a.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {new Date(a.data_hora).toLocaleString(tagDoIdioma, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <Badge variant={variantDoStatus(a.status)}>{t(ROTULO_DO_STATUS[a.status] ?? a.status)}</Badge>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {a.procedimentos.length > 0
              ? a.procedimentos.map((p) => p.nome).join(", ")
              : t("Sem procedimento previsto")}
            {a.dente_regiao ? ` · ${a.dente_regiao}` : ""}
          </p>
          {a.observacao ? <p className="mt-1 text-sm">{a.observacao}</p> : null}
          {a.valor_cobrado_cents != null ? (
            <p className="mt-1 text-sm tabular-nums text-text-muted">
              {formatCents(a.valor_cobrado_cents, "BRL")}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
