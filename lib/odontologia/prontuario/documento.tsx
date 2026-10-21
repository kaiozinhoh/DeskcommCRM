// lib/odontologia/prontuario/documento.tsx
/**
 * O PRONTUÁRIO COMPILADO EM PDF — DIRC: Calcular. Nenhuma tabela nova: junta o que já está em
 * `odontologia_pacientes` + `odontologia_atendimentos` (+ procedimentos) numa página só, na
 * ordem cronológica. Mesmo padrão de `lib/propostas/documento/pdf-do-documento.tsx`
 * (@react-pdf/renderer, marca da organização).
 *
 * Este documento NÃO substitui o prontuário legal da clínica (ver migration 0722) — é um
 * resumo do que o sistema registrou, para impressão/anexo ao prontuário físico.
 */
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

const styles = StyleSheet.create({
  page: { padding: 32, paddingBottom: 48, fontSize: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  logo: { width: 96, height: 40, objectFit: "contain" },
  titulo: { fontSize: 16, fontWeight: 700 },
  subtitulo: { fontSize: 11, marginTop: 2 },
  aviso: { fontSize: 8, color: "#666", marginTop: 12, marginBottom: 8 },
  atendimento: { marginTop: 10, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: "#ccc" },
  atendimentoData: { fontSize: 11, fontWeight: 700 },
  atendimentoLinha: { fontSize: 10, marginTop: 2 },
  rotulo: { fontWeight: 700 },
  footer: { position: "absolute", bottom: 24, left: 32, right: 32, fontSize: 8, color: "#666" },
  vazio: { marginTop: 16, fontSize: 10, color: "#666" },
});

export interface AtendimentoDoProntuario {
  dataHora: string;
  status: "agendado" | "concluido" | "faltou" | "cancelado";
  denteRegiao: string | null;
  observacao: string | null;
  valorCobradoCents: number | null;
  moeda: string;
  procedimentos: string[];
}

export interface ProntuarioPdfInput {
  nomeDoPaciente: string;
  geradoEm: string;
  atendimentos: AtendimentoDoProntuario[];
  marca: { appName: string | null; accentHex: string | null; logoUrl: string | null };
  t: (texto: string) => string;
}

const ROTULO_DO_STATUS: Record<AtendimentoDoProntuario["status"], string> = {
  agendado: "Agendado",
  concluido: "Concluído",
  faltou: "Faltou",
  cancelado: "Cancelado",
};

function formatarMoeda(cents: number, moeda: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(cents / 100);
}

function Atendimento({ a, t }: { a: AtendimentoDoProntuario; t: (texto: string) => string }): React.ReactElement {
  return (
    <View style={styles.atendimento} wrap={false}>
      <Text style={styles.atendimentoData}>
        {new Date(a.dataHora).toLocaleString("pt-BR")} — {t(ROTULO_DO_STATUS[a.status])}
      </Text>
      {a.procedimentos.length > 0 ? (
        <Text style={styles.atendimentoLinha}>
          <Text style={styles.rotulo}>{t("Procedimentos")}: </Text>
          {a.procedimentos.join(", ")}
        </Text>
      ) : null}
      {a.denteRegiao ? (
        <Text style={styles.atendimentoLinha}>
          <Text style={styles.rotulo}>{t("Dente/região")}: </Text>
          {a.denteRegiao}
        </Text>
      ) : null}
      {a.observacao ? (
        <Text style={styles.atendimentoLinha}>
          <Text style={styles.rotulo}>{t("Observação")}: </Text>
          {a.observacao}
        </Text>
      ) : null}
      {a.valorCobradoCents !== null ? (
        <Text style={styles.atendimentoLinha}>
          <Text style={styles.rotulo}>{t("Valor cobrado")}: </Text>
          {formatarMoeda(a.valorCobradoCents, a.moeda)}
        </Text>
      ) : null}
    </View>
  );
}

function ProntuarioPdfDoc({ d }: { d: ProntuarioPdfInput }): React.ReactElement {
  const accent = d.marca.accentHex ?? undefined;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.titulo, accent ? { color: accent } : {}]}>{d.t("Prontuário odontológico")}</Text>
            <Text style={styles.subtitulo}>{d.nomeDoPaciente}</Text>
          </View>
          {d.marca.logoUrl ? (
            <Image src={d.marca.logoUrl} style={styles.logo} />
          ) : d.marca.appName ? (
            <Text>{d.marca.appName}</Text>
          ) : null}
        </View>

        <Text style={styles.aviso}>
          {d.t(
            "Resumo gerado automaticamente a partir dos atendimentos registrados — não substitui o prontuário legal da clínica.",
          )}{" "}
          {d.t("Gerado em")} {d.geradoEm}.
        </Text>

        {d.atendimentos.length === 0 ? (
          <Text style={styles.vazio}>{d.t("Nenhum atendimento registrado ainda.")}</Text>
        ) : (
          d.atendimentos.map((a, i) => <Atendimento key={i} a={a} t={d.t} />)
        )}

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${d.marca.appName ?? d.t("Prontuário odontológico")} — ${d.t("página")} ${pageNumber} ${d.t("de")} ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export async function renderProntuarioPdf(input: ProntuarioPdfInput): Promise<Buffer> {
  const buf = await renderToBuffer(<ProntuarioPdfDoc d={input} />);
  return buf as Buffer;
}
