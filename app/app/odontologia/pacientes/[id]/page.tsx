import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { paineisDaEntidade } from "@/lib/modulos/dados/paineis";
import { createClient } from "@/lib/supabase/server";

import { ContactDetailClient } from "@/app/app/contacts/[id]/_client";

export const dynamic = "force-dynamic";

/**
 * A ficha do paciente — módulo opcional Odontologia (ADR-0002, Fatia 5).
 *
 * Wrapper fino: reaproveita a MESMA ficha de contato do núcleo
 * (`app/app/contacts/[id]/_client.tsx`) em vez de duplicá-la — o paciente É o contato, só com
 * vocabulário de clínica na URL e no menu. A aba "Histórico de consultas" já aparece sozinha
 * ali, condicionada ao módulo instalado (`activeOrg.modulos_ligados`), então nenhuma prop nova
 * precisa viajar até o cliente.
 */
export default async function PacienteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const { id } = await params;
  const supabase = await createClient();
  // Filtra a org ATIVA, não só a RLS — mesma régua de app/app/contacts/[id]/page.tsx.
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, organization_id")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!contact) notFound();

  const paineisDeModulo = await paineisDaEntidade("contato", activeOrg.orgId);
  return <ContactDetailClient contactId={id} paineisDeModulo={paineisDeModulo} />;
}
