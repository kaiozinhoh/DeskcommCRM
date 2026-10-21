// lib/odontologia/atestado/documento.tsx
/**
 * O ATESTADO EM PDF (Fatia 8) — simples, pra imprimir e assinar/carimbar à mão. Sem assinatura
 * digital, sem numeração/controle sequencial (decisão explícita do dono do produto). Mesmo
 * padrão de `lib/odontologia/prontuario/documento.tsx` (@react-pdf/renderer, marca da
 * organização).
 */
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, lineHeight: 1.5 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  logo: { width: 96, height: 40, objectFit: "contain" },
  titulo: { fontSize: 16, fontWeight: 700, textAlign: "center", marginTop: 32, marginBottom: 24 },
  corpo: { fontSize: 11, textAlign: "justify" },
  assinatura: { marginTop: 64 },
  linhaAssinatura: { borderTopWidth: 1, borderTopColor: "#000", width: 260, marginTop: 32 },
  nomeDentista: { marginTop: 4, fontSize: 10 },
  rodape: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: "#666" },
});

export interface AtestadoPdfInput {
  nomeDoPaciente: string;
  data: string;
  motivo: string;
  diasAfastamento: number | null;
  dentistaNome: string;
  dentistaCro: string;
  marca: { appName: string | null; accentHex: string | null; logoUrl: string | null };
  t: (texto: string) => string;
}

function AtestadoPdfDoc({ d }: { d: AtestadoPdfInput }): React.ReactElement {
  const accent = d.marca.accentHex ?? undefined;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {d.marca.logoUrl ? (
            <Image src={d.marca.logoUrl} style={styles.logo} />
          ) : d.marca.appName ? (
            <Text>{d.marca.appName}</Text>
          ) : (
            <View />
          )}
          <Text>{d.data}</Text>
        </View>

        <Text style={[styles.titulo, accent ? { color: accent } : {}]}>{d.t("Atestado odontológico")}</Text>

        <Text style={styles.corpo}>
          {d.t("Atesto, para os devidos fins, que")} {d.nomeDoPaciente} {d.motivo}
          {d.diasAfastamento !== null
            ? ` ${d.t("Necessita de afastamento de suas atividades por")} ${d.diasAfastamento} ${
                d.diasAfastamento === 1 ? d.t("dia") : d.t("dias")
              }, ${d.t("a partir desta data")}.`
            : ""}
        </Text>

        <View style={styles.assinatura}>
          <View style={styles.linhaAssinatura} />
          <Text style={styles.nomeDentista}>
            {d.dentistaNome} — {d.t("CRO")} {d.dentistaCro}
          </Text>
        </View>

        <Text style={styles.rodape}>
          {d.t(
            "Documento gerado pelo DeskcommCRM — a assinatura/carimbo é aplicada manualmente após a impressão.",
          )}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderAtestadoPdf(input: AtestadoPdfInput): Promise<Buffer> {
  const buf = await renderToBuffer(<AtestadoPdfDoc d={input} />);
  return buf as Buffer;
}
