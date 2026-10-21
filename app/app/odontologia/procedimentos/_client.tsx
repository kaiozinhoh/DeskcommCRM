"use client";
/**
 * Procedimentos da clínica odontológica — o cadastro de nome, duração e valor de referência.
 *
 * Módulo opcional (ADR-0002): antes de instalado, toda leitura devolve 409
 * `module_not_installed`. A tela não trata isso como erro genérico — mostra o mesmo texto que a
 * rota manda (quem resolve é o administrador da instalação, em Configurações da instalação ›
 * Módulos, não quem está nesta tela).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { formatCents } from "@/lib/money";

export type Procedimento = {
  id: string;
  nome: string;
  duracao_min: number;
  valor_referencia_cents: number | null;
  ativo: boolean;
  ordem: number;
};

export function Procedimentos({ podeGerenciar }: { podeGerenciar: boolean }) {
  const t = useT();
  const qc = useQueryClient();

  const procedimentos = useQuery({
    queryKey: ["odontologia", "procedimentos"],
    queryFn: async () =>
      (await apiClient.get<{ data: Procedimento[] }>("/api/v1/odontologia/procedimentos")).data,
    retry: false,
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["odontologia", "procedimentos"] });

  const criar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) =>
      apiClient.post<{ data: Procedimento }>("/api/v1/odontologia/procedimentos", corpo),
    onSuccess: invalidar,
    onError: showApiError,
  });

  const editar = useMutation({
    mutationFn: ({ id, corpo }: { id: string; corpo: Record<string, unknown> }) =>
      apiClient.patch<{ data: Procedimento }>(`/api/v1/odontologia/procedimentos/${id}`, corpo),
    onSuccess: invalidar,
    onError: showApiError,
  });

  const naoInstalado =
    procedimentos.error instanceof ApiError && procedimentos.error.code === "module_not_installed";

  if (naoInstalado) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {(procedimentos.error as ApiError).message}
      </p>
    );
  }

  if (procedimentos.isError) {
    return <p className="text-sm text-danger">{t("Não foi possível carregar os procedimentos.")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {podeGerenciar ? (
        <FormularioDeProcedimento criando={criar.isPending} onCriar={(corpo) => criar.mutate(corpo)} />
      ) : null}

      <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-sm font-semibold">{t("Procedimentos")}</h2>
        {(procedimentos.data ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum procedimento ainda.")}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {(procedimentos.data ?? []).map((p) => (
                <LinhaDoProcedimento
                  key={p.id}
                  procedimento={p}
                  podeGerenciar={podeGerenciar}
                  salvando={editar.isPending}
                  onSalvar={(corpo) => editar.mutate({ id: p.id, corpo })}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function LinhaDoProcedimento({
  procedimento: p,
  podeGerenciar,
  salvando,
  onSalvar,
}: {
  procedimento: Procedimento;
  podeGerenciar: boolean;
  salvando: boolean;
  onSalvar: (corpo: Record<string, unknown>) => void;
}) {
  const t = useT();
  const [editando, setEditando] = useState(false);

  if (editando) {
    return (
      <tr className="border-b border-border/60" data-testid={`procedimento-editar-${p.id}`}>
        <td colSpan={4} className="py-2">
          <FormularioDeProcedimento
            criando={salvando}
            valoresIniciais={p}
            onCriar={(corpo) => {
              onSalvar(corpo);
              setEditando(false);
            }}
            onCancelar={() => setEditando(false)}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border/60" data-testid={`procedimento-${p.id}`}>
      <td className="py-2">
        {p.nome}
        {!p.ativo ? (
          <Badge variant="neutral" className="ml-2">
            {t("Arquivado")}
          </Badge>
        ) : null}
      </td>
      <td className="py-2 tabular-nums text-text-muted">
        {p.duracao_min} {t("min")}
      </td>
      <td className="py-2 tabular-nums text-text-muted">
        {p.valor_referencia_cents != null ? formatCents(p.valor_referencia_cents, "BRL") : "—"}
      </td>
      <td className="py-2 text-right">
        {podeGerenciar ? (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditando(true)} data-testid={`editar-${p.id}`}>
              {t("Editar")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={salvando}
              onClick={() => onSalvar({ ativo: !p.ativo })}
              data-testid={`arquivar-${p.id}`}
            >
              {p.ativo ? t("Arquivar") : t("Reativar")}
            </Button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function FormularioDeProcedimento({
  criando,
  valoresIniciais,
  onCriar,
  onCancelar,
}: {
  criando: boolean;
  valoresIniciais?: Procedimento;
  onCriar: (corpo: Record<string, unknown>) => void;
  onCancelar?: () => void;
}) {
  const t = useT();
  const [nome, setNome] = useState(valoresIniciais?.nome ?? "");
  const [duracao, setDuracao] = useState(String(valoresIniciais?.duracao_min ?? 30));
  const [valor, setValor] = useState(
    valoresIniciais?.valor_referencia_cents != null
      ? (valoresIniciais.valor_referencia_cents / 100).toString().replace(".", ",")
      : "",
  );

  const duracaoMin = Number(duracao);
  const valorCents = valor ? Math.round(Number(valor.replace(",", ".")) * 100) : null;
  const pode = !criando && nome.trim().length > 0 && duracaoMin > 0;

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pode) return;
        onCriar({ nome: nome.trim(), duracao_min: duracaoMin, valor_referencia_cents: valorCents });
        if (!valoresIniciais) {
          setNome("");
          setDuracao("30");
          setValor("");
        }
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Nome")}
        <input
          value={nome}
          data-testid="procedimento-nome"
          onChange={(e) => setNome(e.target.value)}
          className="w-48 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Duração (min)")}
        <input
          value={duracao}
          inputMode="numeric"
          data-testid="procedimento-duracao"
          onChange={(e) => setDuracao(e.target.value)}
          className="w-24 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Valor de referência")}
        <input
          value={valor}
          inputMode="decimal"
          placeholder={t("opcional")}
          data-testid="procedimento-valor"
          onChange={(e) => setValor(e.target.value)}
          className="w-28 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
        />
      </label>

      <Button type="submit" disabled={!pode} data-testid="salvar-procedimento">
        {valoresIniciais ? t("Salvar") : t("Criar procedimento")}
      </Button>
      {onCancelar ? (
        <Button type="button" variant="outline" onClick={onCancelar}>
          {t("Cancelar")}
        </Button>
      ) : null}
    </form>
  );
}
