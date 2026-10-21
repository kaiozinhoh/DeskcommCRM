-- manifest: Odontologia — Fatia 3: atendimentos (ligados à agenda), auditoria e seção de LGPD.
--
-- Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md. Estende `fn_odontologia_provisionar()`
-- (migration 0721) — a mesma função, corpo inteiro reescrito (D6: reaplicar converge), nunca uma
-- segunda função. Nunca se edita migration já aplicada; como esta ainda não saiu do branch da
-- fatia, o corpo é reescrito aqui mesmo em vez de uma forward-fix nova.
--
-- ── D2/D3: a migration cria a FUNÇÃO; as tabelas só nascem na instalação ────────────────────────
-- `odontologia_atendimentos` e `odontologia_atendimento_procedimentos` nascem junto com
-- `odontologia_procedimentos` quando o administrador da instalação chama
-- `fn_modulo_instalar('odontologia', ...)` — nunca sozinhas.
--
-- ── O desenho: UMA linha serve de "previsto" e de "registrado" ───────────────────────────────
-- Ao marcar a consulta (Fatia 4), nasce uma linha com `status='agendado'` e o(s) procedimento(s)
-- previstos, ligada ao `appointment_id` da Agenda. Ao atender, a MESMA linha é atualizada para
-- `concluido`/`faltou`/`cancelado` — evita tabela duplicada ("previsto" × "realizado") e mantém o
-- histórico (passado) e a agenda (futuro) na mesma consulta, discriminados por `status`/`data_hora`.
-- `appointment_id` é único quando presente: um compromisso tem no máximo um atendimento.
--
-- ── D5: RLS por OPERAÇÃO ──────────────────────────────────────────────────────────────────────
-- Leitura para a organização. `agent`+ registra (insere o previsto e marca concluído/faltou —
-- "registra atendimento" do catálogo de permissões); `manager`+ corrige depois de registrado. A
-- régua fina — o que é primeiro registro e o que é correção de algo já concluído — é decisão de
-- NEGÓCIO, não de RLS: a rota PATCH exige `manager`+ para alterar um atendimento que já saiu de
-- `agendado`, e a policy aqui é o PISO (agent+ em ambas), mesmo desenho de Honorários (a rota
-- cobra o mesmo degrau da RLS por clareza de mensagem, não como segunda régua de autoridade).
-- Sem DELETE nenhuma: nenhuma policy de delete nasce, e RLS ligada sem policy nega por padrão —
-- "não apagar fisicamente" do catálogo de permissões.
--
-- ── LGPD (D8) ─────────────────────────────────────────────────────────────────────────────────
-- `observacao` e `dente_regiao` são texto livre sobre a pessoa (dado de saúde) — diferente de
-- `odontologia_procedimentos` (cadastro da clínica, migration 0721, sem decisão de LGPD nova).
-- Declarada em `modulo_secoes_lgpd` (migration 0485): `trg_lgpd_secoes_de_modulo` redige as duas
-- colunas (`null`) na virada de `is_anonymized` de `contacts`, nos DOIS caminhos de anonimização.
-- Sem o módulo instalado a tabela não existe e `to_regclass` pula, sem erro (a mesma régua da
-- comanda, migration 0619/0620). Valor cobrado, status, data e o vínculo com o compromisso
-- sobrevivem — são registro de atendimento, não texto sobre a pessoa.
--
-- ── Nenhum consumidor real ainda ──────────────────────────────────────────────────────────────
-- A API e a integração com a Agenda entram nas próximas fatias; esta migration só estende o
-- schema que a instalação do módulo provisiona.

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

-- ── fn_odontologia_declarar_secoes_lgpd: a seção de LGPD, numa função própria ──────────────────
-- `observacao`/`dente_regiao` são dado de saúde; nulas na anonimização, nos DOIS caminhos (a
-- cascata e a virada `is_anonymized`), via `trg_lgpd_secoes_de_modulo` (migration 0485). Valor
-- cobrado, status, data e o vínculo com o compromisso sobrevivem. `security definer`: o insert
-- roda como o dono da tabela, por cima do `revoke all` que a 0485 faz em `modulo_secoes_lgpd`.
-- `on conflict do update`: reaplicar o kit sobre um banco com a linha antiga converge (D6).
create or replace function public.fn_odontologia_declarar_secoes_lgpd()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  insert into public.modulo_secoes_lgpd
      (modulo, tabela, ligacao, colunas, colunas_rotulo)
    values (
      'odontologia',
      'odontologia_atendimentos',
      'organization_id = $1 and contact_id = $2',
      array['observacao', 'dente_regiao'],
      '{}'::text[]
    )
    on conflict (modulo, tabela) do update
      set ligacao = excluded.ligacao,
          colunas = excluded.colunas,
          colunas_rotulo = excluded.colunas_rotulo;
end;
$f$;

revoke execute on function public.fn_odontologia_declarar_secoes_lgpd() from public, anon, authenticated;
grant execute on function public.fn_odontologia_declarar_secoes_lgpd() to service_role;
