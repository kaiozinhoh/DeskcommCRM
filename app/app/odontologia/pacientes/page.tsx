import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";

import { Pacientes } from "./_client";

export const dynamic = "force-dynamic";

/**
 * PACIENTES — módulo opcional Odontologia (ADR-0002): os MESMOS `contacts` do núcleo,
 * apresentados com vocabulário de clínica. Não duplica a tabela de contatos — só a tela.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");

  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">{t("Pacientes")}</h1>
        <p className="text-sm text-text-muted">
          {t("Os contatos da organização: busca, tags, última consulta e próximo retorno.")}
        </p>
      </div>
      <Pacientes />
    </div>
  );
}
