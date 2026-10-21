-- manifest: Odontologia — Fatia 6: Paciente como cadastro próprio, separado do Contato.
--
-- Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md. Estende `fn_odontologia_provisionar()`
-- (migrations 0721/0722) — a mesma função, corpo inteiro reescrito (D6: reaplicar converge),
-- nunca uma segunda função.
--
-- ── Por que uma tabela nova, e não só vocabulário sobre `contacts` ──────────────────────────────
-- Até aqui "Paciente" era só rótulo de tela sobre o mesmo `contacts` do núcleo (Fatia 5): todo
-- contato aparecia na lista. Pedido do dono do produto: nem todo contato é paciente — só quem
-- tem o CADASTRO de paciente criado. `odontologia_pacientes` é esse cadastro: `contact_id`
-- obrigatório e único por organização (DIRC: Referenciar, nunca duplicar nome/telefone/e-mail,
-- que continuam só em `contacts`), com `ativo` para "arquivar" (nunca apagar — catálogo de
-- permissões) um paciente que a clínica não atende mais.
--
-- ── Quem cria o cadastro ──────────────────────────────────────────────────────────────────────
-- Pela tela de Pacientes (ação explícita) OU automaticamente no primeiro atendimento registrado
-- para aquele contato (a API de atendimentos garante a linha antes de inserir — Fatia 6,
-- app/api/v1/odontologia/atendimentos/route.ts). As duas formas são "a pessoa criando o
-- cadastro": a trava de unicidade (organization_id, contact_id) é o que impede duplicar.
--
-- ── D5: RLS por OPERAÇÃO ──────────────────────────────────────────────────────────────────────
-- Leitura para a organização. `agent`+ cria (mesmo degrau de quem registra atendimento);
-- `manager`+ arquiva/reativa. Sem DELETE: nenhuma policy de delete nasce, e RLS ligada sem
-- policy nega por padrão.
--
-- ── Nenhuma coluna de LGPD nova ──────────────────────────────────────────────────────────────
-- Esta tabela não guarda texto livre sobre a pessoa — só o vínculo e `ativo`. Nenhuma seção nova
-- em `modulo_secoes_lgpd`; a anonimização do contato não precisa tocar aqui (o vínculo por `id`
-- sobrevive, e nenhuma coluna aqui identifica a pessoa fora do que `contacts` já guarda).

create or replace function public.fn_odontologia_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.odontologia_procedimentos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,

    nome text not null check (btrim(nome) <> ''),
    duracao_min integer not null default 30 check (duracao_min > 0),
    valor_referencia_cents bigint check (valor_referencia_cents is null or valor_referencia_cents > 0),
    ativo boolean not null default true,
    ordem integer not null default 0,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists odontologia_procedimentos_org_idx
    on public.odontologia_procedimentos (organization_id);
  create index if not exists odontologia_procedimentos_org_ativo_idx
    on public.odontologia_procedimentos (organization_id, ativo);

  alter table public.odontologia_procedimentos enable row level security;
  drop policy if exists tenant_isolation_odontologia_procedimentos_all on public.odontologia_procedimentos;

  drop policy if exists odontologia_procedimentos_select on public.odontologia_procedimentos;
  -- Cada `create policy` deste corpo ocupa DUAS linhas de propósito (#1906). O
  -- `update.sh` de v1.39.0 a v1.63.0 lê as regras do TEXTO deste arquivo (nome
  -- da regra e tabela na MESMA linha do create), até dentro de corpo de função,
  -- e cobraria estas regras numa instalação sem o módulo. Esse script antigo
  -- fica no disco durante a atualização, então o conserto dele não alcança
  -- quem atualiza: a forma do texto sim. Vigiado por
  -- tests/unit/adr-0002-funcao-provisionadora.test.ts.
  create policy odontologia_procedimentos_select
    on public.odontologia_procedimentos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );

  drop policy if exists odontologia_procedimentos_insert on public.odontologia_procedimentos;
  create policy odontologia_procedimentos_insert
    on public.odontologia_procedimentos
    for insert
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));

  drop policy if exists odontologia_procedimentos_update on public.odontologia_procedimentos;
  create policy odontologia_procedimentos_update
    on public.odontologia_procedimentos
    for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));

  drop policy if exists odontologia_procedimentos_delete on public.odontologia_procedimentos;
  create policy odontologia_procedimentos_delete
    on public.odontologia_procedimentos
    for delete
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')));
  revoke all on public.odontologia_procedimentos from anon;

  comment on table public.odontologia_procedimentos is
    'Cadastro de procedimentos da clínica odontológica (nome, duração padrão, valor de referência). Leitura para a organização, escrita manager+.';

  -- ── odontologia_atendimentos (Fatia 3) ───────────────────────────────────
  create table if not exists public.odontologia_atendimentos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,

    -- Igual a conversations/messages: nunca cascade. Anonimizar o contato
    -- redige observacao/dente_regiao (seção de LGPD abaixo); o histórico do
    -- atendimento (status, valor, data) sobrevive à anonimização.
    contact_id uuid not null references public.contacts(id) on delete restrict,
    -- Nulo quando o atendimento não nasceu de um agendamento (registro
    -- direto/retroativo). `set null`: apagar o compromisso não apaga o
    -- atendimento — o histórico clínico sobrevive à agenda.
    appointment_id uuid references public.calendar_appointments(id) on delete set null,
    dentista_user_id uuid references auth.users(id) on delete set null,

    dente_regiao text,
    observacao text,
    valor_cobrado_cents bigint check (valor_cobrado_cents is null or valor_cobrado_cents > 0),

    -- A MESMA linha serve de previsto (agendado) e de registrado
    -- (concluido/faltou) — ver o cabeçalho desta migration.
    status text not null default 'agendado' check (status in ('agendado', 'concluido', 'faltou', 'cancelado')),
    data_hora timestamptz not null,

    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists odontologia_atendimentos_org_idx
    on public.odontologia_atendimentos (organization_id);
  create index if not exists odontologia_atendimentos_org_contato_idx
    on public.odontologia_atendimentos (organization_id, contact_id, data_hora desc);
  create unique index if not exists odontologia_atendimentos_appointment_unico
    on public.odontologia_atendimentos (appointment_id) where appointment_id is not null;

  alter table public.odontologia_atendimentos enable row level security;
  drop policy if exists tenant_isolation_odontologia_atendimentos_all on public.odontologia_atendimentos;

  drop policy if exists odontologia_atendimentos_select on public.odontologia_atendimentos;
  create policy odontologia_atendimentos_select
    on public.odontologia_atendimentos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );

  drop policy if exists odontologia_atendimentos_insert on public.odontologia_atendimentos;
  -- `agent`+ registra (cria o previsto, marca concluído/faltou); a régua fina
  -- de quando uma edição é CORREÇÃO (manager+) é da rota PATCH, não da RLS —
  -- ver o cabeçalho desta migration.
  create policy odontologia_atendimentos_insert
    on public.odontologia_atendimentos
    for insert
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'agent')
                    and exists (select 1 from public.contacts c
                                 where c.id = contact_id and c.organization_id = odontologia_atendimentos.organization_id)));

  drop policy if exists odontologia_atendimentos_update on public.odontologia_atendimentos;
  create policy odontologia_atendimentos_update
    on public.odontologia_atendimentos
    for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'agent')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'agent')));
  revoke all on public.odontologia_atendimentos from anon;

  comment on table public.odontologia_atendimentos is
    'Atendimento odontológico: previsto (status agendado, ligado ao compromisso da Agenda) e registrado (concluido/faltou/cancelado). Leitura para a organização; agent+ registra, manager+ corrige (régua da rota). Observação e dente/região são dado de saúde — seção de LGPD declarada abaixo. Este registro não substitui o prontuário da clínica.';

  -- ── odontologia_atendimento_procedimentos (N:N) ──────────────────────────
  create table if not exists public.odontologia_atendimento_procedimentos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    atendimento_id uuid not null references public.odontologia_atendimentos(id) on delete cascade,
    -- `restrict`: um procedimento já usado num atendimento não pode ser apagado
    -- (só arquivado, ativo=false) — a tela de Configurações não oferece
    -- apagar, e esta FK é a trava de banco por cima disso.
    procedimento_id uuid not null references public.odontologia_procedimentos(id) on delete restrict,
    created_at timestamptz not null default now(),

    constraint odontologia_atendimento_procedimentos_unico unique (atendimento_id, procedimento_id)
  );

  create index if not exists odontologia_atendimento_procedimentos_org_idx
    on public.odontologia_atendimento_procedimentos (organization_id);
  create index if not exists odontologia_atendimento_procedimentos_atendimento_idx
    on public.odontologia_atendimento_procedimentos (organization_id, atendimento_id);

  alter table public.odontologia_atendimento_procedimentos enable row level security;
  drop policy if exists tenant_isolation_odontologia_atendimento_procedimentos_all on public.odontologia_atendimento_procedimentos;

  drop policy if exists odontologia_atendimento_procedimentos_select on public.odontologia_atendimento_procedimentos;
  create policy odontologia_atendimento_procedimentos_select
    on public.odontologia_atendimento_procedimentos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );

  drop policy if exists odontologia_atendimento_procedimentos_insert on public.odontologia_atendimento_procedimentos;
  create policy odontologia_atendimento_procedimentos_insert
    on public.odontologia_atendimento_procedimentos
    for insert
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'agent')
                    and exists (select 1 from public.odontologia_atendimentos a
                                 where a.id = atendimento_id
                                   and a.organization_id = odontologia_atendimento_procedimentos.organization_id)
                    and exists (select 1 from public.odontologia_procedimentos p
                                 where p.id = procedimento_id
                                   and p.organization_id = odontologia_atendimento_procedimentos.organization_id)));

  drop policy if exists odontologia_atendimento_procedimentos_delete on public.odontologia_atendimento_procedimentos;
  -- Remover um procedimento de um atendimento já registrado é CORREÇÃO — o
  -- mesmo piso de `odontologia_atendimentos_update`, mas aqui a RLS já exige
  -- manager+ (não há "primeiro registro" que precise de agent+ para apagar;
  -- o INSERT é que cobre a criação).
  create policy odontologia_atendimento_procedimentos_delete
    on public.odontologia_atendimento_procedimentos
    for delete
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')));
  revoke all on public.odontologia_atendimento_procedimentos from anon;

  comment on table public.odontologia_atendimento_procedimentos is
    'Procedimentos previstos/realizados de um atendimento (N:N). Leitura para a organização; agent+ adiciona, manager+ remove (correção).';


  -- ── odontologia_pacientes (Fatia 6) ──────────────────────────────
  create table if not exists public.odontologia_pacientes (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- `restrict`, nunca cascade: apagar o cadastro de paciente nunca é o
    -- caminho (catálogo de permissões — "nunca hard-delete"); o contato é que
    -- pode ser anonimizado, e aí o vínculo por `id` sobrevive.
    contact_id uuid not null references public.contacts(id) on delete restrict,
    -- "Arquivar" em vez de apagar: um paciente que a clínica não atende mais
    -- some das listas sem perder o histórico de atendimentos.
    ativo boolean not null default true,

    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- Um contato tem no máximo um cadastro de paciente por organização — é a
    -- trava que torna "criar o cadastro" idempotente (a API de atendimentos
    -- pode tentar de novo sem duplicar).
    constraint odontologia_pacientes_contato_unico unique (organization_id, contact_id)
  );

  create index if not exists odontologia_pacientes_org_idx
    on public.odontologia_pacientes (organization_id);
  create index if not exists odontologia_pacientes_org_ativo_idx
    on public.odontologia_pacientes (organization_id, ativo);

  alter table public.odontologia_pacientes enable row level security;
  drop policy if exists tenant_isolation_odontologia_pacientes_all on public.odontologia_pacientes;

  drop policy if exists odontologia_pacientes_select on public.odontologia_pacientes;
  create policy odontologia_pacientes_select
    on public.odontologia_pacientes
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );

  drop policy if exists odontologia_pacientes_insert on public.odontologia_pacientes;
  -- `agent`+ cria — mesmo degrau de quem registra um atendimento (a criação
  -- automática no primeiro atendimento usa este mesmo piso).
  create policy odontologia_pacientes_insert
    on public.odontologia_pacientes
    for insert
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'agent')
                    and exists (select 1 from public.contacts c
                                 where c.id = contact_id and c.organization_id = odontologia_pacientes.organization_id)));

  drop policy if exists odontologia_pacientes_update on public.odontologia_pacientes;
  -- `manager`+ arquiva/reativa — a mesma régua de quem corrige um atendimento
  -- já registrado.
  create policy odontologia_pacientes_update
    on public.odontologia_pacientes
    for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));
  revoke all on public.odontologia_pacientes from anon;

  comment on table public.odontologia_pacientes is
    'O cadastro de Paciente — separado do Contato (DIRC: Referenciar, nunca duplicar nome/telefone). Um contato só é paciente quando esta linha existe. Leitura para a organização; agent+ cria (manual ou automático no primeiro atendimento); manager+ arquiva/reativa. Sem DELETE — nunca hard-delete.';

  -- ── Backfill: quem JÁ tinha atendimento antes desta migration ────────────
  -- `odontologia_atendimentos` nasceu na 0722 sem depender de `odontologia_pacientes`
  -- (que só existe a partir daqui). Clone que já instalou o módulo e já registrou
  -- atendimento tem gente com histórico e SEM o cadastro novo — sem este passo, essas
  -- pessoas somem da lista de Pacientes (que passa a ler só esta tabela). `distinct
  -- on` + o atendimento mais ANTIGO por contato: o paciente nasce "como se" tivesse
  -- sido cadastrado desde o primeiro atendimento, não a partir de hoje. Roda sempre —
  -- idempotente pelo `on conflict do nothing` (D6: reaplicar converge, nunca duplica).
  insert into public.odontologia_pacientes (organization_id, contact_id, created_by, created_at)
    select distinct on (a.organization_id, a.contact_id)
        a.organization_id, a.contact_id, a.created_by, a.created_at
      from public.odontologia_atendimentos a
      order by a.organization_id, a.contact_id, a.created_at asc
    on conflict (organization_id, contact_id) do nothing;

  -- ── LGPD (D8, migration 0485): declara a seção, numa função PRÓPRIA ─────
  -- `fn_odontologia_declarar_secoes_lgpd()` e não um `insert` aqui dentro: o
  -- molde de forma da D4 (`tests/invariants/molde-de-provisionadora.ts`,
  -- `alvosDeEscritaNoCorpo`) reprova a provisionadora que escreve em tabela do
  -- NÚCLEO (`modulo_secoes_lgpd` nasce na 0485) fora da lista do que ela cria —
  -- o mesmo desenho de `fn_financeiro_declarar_secoes_lgpd` (migration 0619).
  perform public.fn_odontologia_declarar_secoes_lgpd();

  -- RLS já ligada por nós, então esta rotina não mexe mais nela (D5) — só
  -- aplica as travas de suporte, que dependem de RLS já estar de pé.
  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

-- D4: as DUAS origens de EXECUTE (CLAUDE.md, migrations item 9) — o grant a PUBLIC que o
-- Postgres dá ao criar a função, e o `alter default privileges ... to anon` do baseline.
revoke execute on function public.fn_odontologia_provisionar() from public, anon, authenticated;
grant execute on function public.fn_odontologia_provisionar() to service_role;
