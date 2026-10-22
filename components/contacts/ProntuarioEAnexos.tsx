"use client";
/**
 * Prontuário compilado (PDF) + anexos (exame, raio-x, prontuário externo escaneado) — Fatia 7.
 * Vive na MESMA aba "Histórico de consultas" da ficha do contato, abaixo da lista de
 * atendimentos. Só aparece quando o contato JÁ é paciente (tem `odontologia_pacientes`
 * cadastrado) — um contato que nunca foi atendido não tem prontuário pra baixar.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { EmitirAtestadoDialog } from "@/components/contacts/EmitirAtestadoDialog";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { roleAtLeast } from "@/lib/auth/types";

interface Paciente {
  id: string;
  contact_id: string;
}
interface Anexo {
  id: string;
  nome_arquivo: string;
  tipo_mime: string;
  tamanho_bytes: number;
  created_at: string;
  url: string | null;
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProntuarioEAnexos({ contactId }: { contactId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { activeOrg } = useAuth();
  const podeRemover = roleAtLeast(activeOrg?.role ?? null, "manager");
  const inputRef = useRef<HTMLInputElement>(null);
  const [erroUpload, setErroUpload] = useState<string | null>(null);
  const [atestadoAberto, setAtestadoAberto] = useState(false);

  const paciente = useQuery({
    queryKey: ["odontologia", "paciente-por-contato", contactId],
    queryFn: async () =>
      (
        await apiClient.get<{ data: Paciente[] }>(
          `/api/v1/odontologia/pacientes?contact_id=${contactId}`,
        )
      ).data,
    retry: false,
  });
  const pacienteId = paciente.data?.[0]?.id ?? null;

  const anexos = useQuery({
    queryKey: ["odontologia", "anexos", pacienteId],
    enabled: pacienteId !== null,
    queryFn: async () =>
      (await apiClient.get<{ data: Anexo[] }>(`/api/v1/odontologia/pacientes/${pacienteId}/anexos`)).data,
  });

  const subir = useMutation({
    // `fetch` direto, não `apiClient.post`: o cliente SEMPRE faz `JSON.stringify(body)`
    // (lib/api/client.ts) — passar FormData ali o transformaria em "[object FormData]".
    // Mesmo padrão de components/ai/NovoMaterialDialog.tsx (upload de material).
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/v1/odontologia/pacientes/${pacienteId}/anexos`, {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as { data?: unknown; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? t("Erro ao subir o arquivo."));
      return json.data;
    },
    onSuccess: () => {
      setErroUpload(null);
      void qc.invalidateQueries({ queryKey: ["odontologia", "anexos", pacienteId] });
    },
    onError: (err: unknown) => {
      setErroUpload(err instanceof Error ? err.message : t("Erro ao subir o arquivo."));
    },
  });

  const remover = useMutation({
    mutationFn: (anexoId: string) =>
      apiClient.delete(`/api/v1/odontologia/pacientes/${pacienteId}/anexos/${anexoId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["odontologia", "anexos", pacienteId] }),
  });

  if (!pacienteId) return null;

  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="prontuario-e-anexos">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("Prontuário odontológico")}</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAtestadoAberto(true)} data-testid="emitir-atestado">
            {t("Emitir atestado")}
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/v1/odontologia/pacientes/${pacienteId}/prontuario`} target="_blank" rel="noreferrer">
              {t("Baixar prontuário em PDF")}
            </a>
          </Button>
        </div>
      </div>
      <EmitirAtestadoDialog open={atestadoAberto} onOpenChange={setAtestadoAberto} pacienteId={pacienteId} />

      <div>
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase text-text-muted">{t("Anexos")}</h4>
          <Button
            size="sm"
            variant="outline"
            disabled={subir.isPending}
            onClick={() => inputRef.current?.click()}
            data-testid="anexar-arquivo"
          >
            {t("Anexar arquivo")}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) subir.mutate(file);
              e.target.value = "";
            }}
          />
        </div>
        {erroUpload ? <p className="mt-1 text-sm text-danger">{erroUpload}</p> : null}

        {(anexos.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{t("Nenhum anexo ainda.")}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {(anexos.data ?? []).map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 text-sm"
                data-testid={`anexo-${a.id}`}
              >
                <a href={a.url ?? "#"} target="_blank" rel="noreferrer" className="underline">
                  {a.nome_arquivo}
                </a>
                <span className="text-text-muted">{formatarTamanho(a.tamanho_bytes)}</span>
                {podeRemover ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remover.isPending}
                    onClick={() => remover.mutate(a.id)}
                    data-testid={`remover-anexo-${a.id}`}
                  >
                    {t("Remover")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
