"use client";
/**
 * Pacientes — cadastro PRÓPRIO, separado do Contato (Fatia 6, migration 0726). Só aparece aqui
 * quem tem o cadastro de paciente — não é mais todo `contacts` da organização (Fatia 5). Criar
 * um paciente novo ainda reaproveita o schema de contato (`NewContactDialog`); cadastrar um
 * contato JÁ existente usa a busca abaixo.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ChipDeEtiqueta } from "@/components/tags/ChipDeEtiqueta";
import { NewContactDialog } from "@/components/contacts/NewContactDialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { rotuloParaAEquipe } from "@/lib/contacts/rotulo-do-contato";
import type { Contact } from "@/lib/types/contacts";

interface ContatoResumo {
  id: string;
  name: string | null;
  display_name: string | null;
  phone_number: string | null;
  tags: string[] | null;
}
interface PacienteLinha {
  id: string;
  contact_id: string;
  ativo: boolean;
  created_at: string;
  contact: ContatoResumo | null;
}
type Resumo = { ultima_consulta: string | null; proximo_retorno: string | null };
type Ordenacao = "nome" | "ultima_consulta" | "proximo_retorno";

export function Pacientes() {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [tag, setTag] = useState("");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("nome");
  const [novoPacienteAberto, setNovoPacienteAberto] = useState(false);
  const [buscaCadastro, setBuscaCadastro] = useState("");

  const pacientes = useQuery({
    queryKey: ["odontologia", "pacientes"],
    queryFn: async () =>
      (await apiClient.get<{ data: PacienteLinha[] }>(`/api/v1/odontologia/pacientes?ativo=true`))
        .data,
    retry: false,
  });

  const contactIds = (pacientes.data ?? []).map((p) => p.contact_id);
  const resumo = useQuery({
    queryKey: ["odontologia", "atendimentos", "resumo", contactIds],
    enabled: contactIds.length > 0,
    queryFn: async () =>
      (
        await apiClient.get<{ data: Record<string, Resumo> }>(
          `/api/v1/odontologia/atendimentos/resumo?contact_ids=${contactIds.join(",")}`,
        )
      ).data,
  });

  const cadastrar = useMutation({
    mutationFn: (contactId: string) =>
      apiClient.post<{ data: { id: string } }>("/api/v1/odontologia/pacientes", {
        contact_id: contactId,
      }),
    onSuccess: () => {
      setBuscaCadastro("");
      void qc.invalidateQueries({ queryKey: ["odontologia", "pacientes"] });
    },
  });

  // "Novo paciente" tenta CRIAR um contato. Quando o telefone/e-mail/CPF digitado já é de um
  // contato vivo (409 contact_exists), o caminho certo não é um toast morto — é cadastrar ESSE
  // contato como paciente, que é exatamente o que a pessoa queria.
  function aoAcharContatoExistente(contactId: string): void {
    toast.info(t("Esse contato já existia — cadastrado como paciente."));
    cadastrar.mutate(contactId);
  }

  // Contatos que ainda NÃO são pacientes, para a busca de cadastro — só dispara com texto.
  const contatosParaCadastro = useQuery({
    queryKey: ["odontologia", "contatos-para-cadastro", buscaCadastro],
    enabled: buscaCadastro.trim().length > 0,
    queryFn: async () =>
      (
        await apiClient.get<{ data: Contact[] }>(
          `/api/v1/contacts?search=${encodeURIComponent(buscaCadastro.trim())}&limit=10`,
        )
      ).data,
  });
  const jaSaoPacientes = new Set((pacientes.data ?? []).map((p) => p.contact_id));
  const resultadosCadastro = (contatosParaCadastro.data ?? []).filter((c) => !jaSaoPacientes.has(c.id));

  const linhas = useMemo(() => {
    const lista = (pacientes.data ?? [])
      .filter((p) => p.contact !== null)
      .map((p) => ({
        paciente: p,
        contato: p.contact as ContatoResumo,
        resumo: resumo.data?.[p.contact_id] ?? { ultima_consulta: null, proximo_retorno: null },
      }))
      .filter(({ contato }) => {
        if (tag.trim() && !(contato.tags ?? []).includes(tag.trim())) return false;
        if (!busca.trim()) return true;
        const termo = busca.trim().toLowerCase();
        return (
          rotuloParaAEquipe(contato, t).toLowerCase().includes(termo) ||
          (contato.phone_number ?? "").includes(termo)
        );
      });
    if (ordenacao === "nome") return lista;
    return [...lista].sort((a, b) => {
      const va = a.resumo[ordenacao] ?? "";
      const vb = b.resumo[ordenacao] ?? "";
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      return ordenacao === "ultima_consulta" ? vb.localeCompare(va) : va.localeCompare(vb);
    });
  }, [pacientes.data, resumo.data, ordenacao, busca, tag]);

  const naoInstalado =
    pacientes.error instanceof ApiError && pacientes.error.code === "module_not_installed";
  if (naoInstalado) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {(pacientes.error as ApiError).message}
      </p>
    );
  }
  if (pacientes.isError) {
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

      <div className="rounded-md border border-border p-3">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Cadastrar um contato já existente como paciente")}
          <input
            value={buscaCadastro}
            data-testid="cadastro-busca-contato"
            placeholder={t("Buscar por nome ou telefone")}
            onChange={(e) => setBuscaCadastro(e.target.value)}
            className="w-80 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
          />
        </label>
        {buscaCadastro.trim() && (
          <ul className="mt-2 flex flex-col gap-1">
            {resultadosCadastro.length === 0 ? (
              <li className="text-sm text-text-muted">{t("Nenhum contato encontrado.")}</li>
            ) : (
              resultadosCadastro.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{rotuloParaAEquipe(c, t)}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cadastrar.isPending}
                    onClick={() => cadastrar.mutate(c.id)}
                    data-testid={`cadastrar-${c.id}`}
                  >
                    {t("Cadastrar como paciente")}
                  </Button>
                </li>
              ))
            )}
          </ul>
        )}
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
              {linhas.map(({ paciente, contato, resumo: r }) => (
                <tr key={paciente.id} className="border-b border-border/60" data-testid={`paciente-${paciente.id}`}>
                  <td className="p-2">
                    <Link
                      href={`/app/odontologia/pacientes/${paciente.id}`}
                      className="underline"
                      data-testid={`paciente-link-${paciente.id}`}
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
        onCriado={(novoContato) => cadastrar.mutate(novoContato.id)}
        onContatoExistente={aoAcharContatoExistente}
      />
    </div>
  );
}
