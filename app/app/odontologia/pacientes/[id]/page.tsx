import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { paineisDaEntidade } from "@/lib/modulos/dados/paineis";
import { createClient } from "@/lib/supabase/server";

import { ContactDetailClient } from "@/app/app/contacts/[id]/_client";

export const dynamic = "force-dynamic";

/**
 * A ficha do paciente — módulo opcional Odontologia (ADR-0002, Fatia 6).
 *
 * `id` agora é o do CADASTRO de paciente (`odontologia_pacientes.id`), não mais o do contato
 * (ver migration 0726: Paciente é um cadastro próprio, separado do Contato). Resolve o
 * `contact_id` e reaproveita a MESMA ficha do núcleo (`app/app/contacts/[id]/_client.tsx`) em
 * vez de duplicá-la — mas chega já na aba "Histórico de consultas" (`defaultTab="odontologia"`):
 * quem abre pela lista de Pacientes quer ver o atendimento, não a visão geral do contato.
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
  const { data: paciente } = await supabase
    .from("odontologia_pacientes")
    .select("id, contact_id")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!paciente) notFound();

  const contactId = (paciente as { contact_id: string }).contact_id;
  const paineisDeModulo = await paineisDaEntidade("contato", activeOrg.orgId);
  return (
    <ContactDetailClient
      contactId={contactId}
      paineisDeModulo={paineisDeModulo}
      defaultTab="odontologia"
    />
  );
}
