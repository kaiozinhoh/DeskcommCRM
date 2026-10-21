"use client";
/**
 * Pacientes — os MESMOS `contacts` do núcleo, com vocabulário de clínica. Módulo opcional
 * Odontologia (ADR-0002, Fatia 5). Criar/editar paciente usa as rotas e schemas de contatos
 * existentes (`NewContactDialog`) — nenhuma tabela nova aqui.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ChipDeEtiqueta } from "@/components/tags/ChipDeEtiqueta";
import { NewContactDialog } from "@/components/contacts/NewContactDialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { rotuloParaAEquipe } from "@/lib/contacts/rotulo-do-contato";
import type { Contact } from "@/lib/types/contacts";

type Resumo = { ultima_consulta: string | null; proximo_retorno: string | null };
type Ordenacao = "nome" | "ultima_consulta" | "proximo_retorno";

export function Pacientes() {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [busca, setBusca] = useState("");
  const [tag, setTag] = useState("");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("nome");
  const [novoPacienteAberto, setNovoPacienteAberto] = useState(false);

  const contatos = useQuery({
    queryKey: ["odontologia", "pacientes", busca, tag],
    queryFn: async () => {
      const parametros = new URLSearchParams({ limit: "100", order_by: "name" });
      if (busca.trim()) parametros.set("search", busca.trim());
      if (tag.trim()) parametros.append("tag", tag.trim());
      return (await apiClient.get<{ data: Contact[] }>(`/api/v1/contacts?${parametros}`)).data;
    },
    retry: false,
  });

  const ids = (contatos.data ?? []).map((c) => c.id);
  const resumo = useQuery({
    queryKey: ["odontologia", "atendimentos", "resumo", ids],
    enabled: ids.length > 0,
    queryFn: async () =>
      (
        await apiClient.get<{ data: Record<string, Resumo> }>(
          `/api/v1/odontologia/atendimentos/resumo?contact_ids=${ids.join(",")}`,
        )
      ).data,
  });

  const linhas = useMemo(() => {
    const lista = (contatos.data ?? []).map((c) => ({
      contato: c,
      resumo: resumo.data?.[c.id] ?? { ultima_consulta: null, proximo_retorno: null },
    }));
    if (ordenacao === "nome") return lista;
    return [...lista].sort((a, b) => {
      const va = a.resumo[ordenacao] ?? "";
      const vb = b.resumo[ordenacao] ?? "";
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      return ordenacao === "ultima_consulta" ? vb.localeCompare(va) : va.localeCompare(vb);
    });
  }, [contatos.data, resumo.data, ordenacao]);

  const naoInstalado =
    contatos.error instanceof ApiError && contatos.error.code === "module_not_installed";
  if (naoInstalado) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {(contatos.error as ApiError).message}
      </p>
    );
  }
  if (contatos.isError) {
    return <p className="text-sm text-danger">{t("Não foi possível carregar os pacientes.")}</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Buscar")}
          <input
            value={busca}
            data-testid="pacientes-busca"
            placeholder={t("Nome ou telefone")}
            onChange={(e) => setBusca(e.target.value)}
            className="w-56 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Tag")}
          <input
            value={tag}
            data-testid="pacientes-tag"
            placeholder={t("filtrar por tag")}
            onChange={(e) => setTag(e.target.value)}
            className="w-40 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Ordenar por")}
          <select
            value={ordenacao}
            data-testid="pacientes-ordenar"
            onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
            className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
          >
            <option value="nome">{t("Nome")}</option>
            <option value="ultima_consulta">{t("Última consulta")}</option>
            <option value="proximo_retorno">{t("Próximo retorno")}</option>
          </select>
        </label>
        <Button className="ml-auto" onClick={() => setNovoPacienteAberto(true)} data-testid="novo-paciente">
          {t("Novo paciente")}
        </Button>
      </div>

      <section className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        {linhas.length === 0 ? (
          <p className="p-3 text-sm text-text-muted">{t("Nenhum paciente encontrado.")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-text-muted">
                <th className="p-2">{t("Nome")}</th>
                <th className="p-2">{t("Telefone")}</th>
                <th className="p-2">Tags</th>
                <th className="p-2">{t("Última consulta")}</th>
                <th className="p-2">{t("Próximo retorno")}</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ contato, resumo: r }) => (
                <tr key={contato.id} className="border-b border-border/60" data-testid={`paciente-${contato.id}`}>
                  <td className="p-2">
                    <Link
                      href={`/app/odontologia/pacientes/${contato.id}`}
                      className="underline"
                      data-testid={`paciente-link-${contato.id}`}
                    >
                      {rotuloParaAEquipe(contato, t)}
                    </Link>
                  </td>
                  <td className="p-2 tabular-nums text-text-muted">{contato.phone_number ?? "—"}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {(contato.tags ?? []).map((tg) => (
                        <ChipDeEtiqueta key={tg} tag={tg} />
                      ))}
                    </div>
                  </td>
                  <td className="p-2 text-text-muted">
                    {r.ultima_consulta
                      ? new Date(r.ultima_consulta).toLocaleDateString(tagDoIdioma)
                      : "—"}
                  </td>
                  <td className="p-2 text-text-muted">
                    {r.proximo_retorno
                      ? new Date(r.proximo_retorno).toLocaleDateString(tagDoIdioma)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <NewContactDialog
        open={novoPacienteAberto}
        onOpenChange={setNovoPacienteAberto}
        onCriado={() => void contatos.refetch()}
      />
    </div>
  );
}
