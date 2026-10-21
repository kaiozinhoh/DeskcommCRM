import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { Procedimentos } from "./_client";

export const dynamic = "force-dynamic";

/**
 * PROCEDIMENTOS — módulo opcional Odontologia (ADR-0002): o cadastro de procedimentos da
 * clínica (nome, duração padrão, valor de referência).
 *
 * `viewer` lê; criar, editar e arquivar exige `manager`+ — mesma régua da migration 0706
 * (preço de referência não é coisa que `agent` configure).
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");

  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Procedimentos")}</h1>
        <p className="text-sm text-text-muted">
          {t("O cadastro de procedimentos da clínica: nome, duração padrão e valor de referência.")}
        </p>
      </div>
      <Procedimentos podeGerenciar={ROLE_RANK[org.role] >= ROLE_RANK.manager} />
    </div>
  );
}
