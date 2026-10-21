-- manifest: Odontologia — módulo de tabela (ADR-0002): cadastro de procedimentos da clínica.
--
-- Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md. Molde: `fn_honorarios_provisionar()`
-- (migration 0480), primeiro módulo oficial a usar o mecanismo.
--
-- ── D2: a migration cria a FUNÇÃO, nunca a tabela ────────────────────────────────────────────
-- `public.fn_odontologia_provisionar()` — sem parâmetro, `security definer`, corpo com
-- `create table if not exists`. As tabelas só nascem quando um administrador da instalação
-- chama `fn_modulo_instalar('odontologia', ...)` em `/admin/modulos`.
--
-- ── Destino (DoD 18): extensão ────────────────────────────────────────────────────────────────
-- Procedimentos, atendimentos e o histórico de consultas são especialização de clínica
-- odontológica — sem este módulo, Contatos e Agenda do núcleo continuam inteiros. Este módulo
-- só descreve o CADASTRO de procedimentos nesta fatia; atendimentos (ligados à Agenda) entram
-- numa migration seguinte que estende esta mesma função.
--
-- ── D4: por que a função não é porta de adulteração ──────────────────────────────────────────
-- Sem parâmetro; idempotente (`if not exists` em tudo); só `service_role` executa (revoke das
-- duas origens — CLAUDE.md, migrations item 9).
--
-- ── D5: RLS por OPERAÇÃO, não a policy ampla automática ──────────────────────────────────────
-- A policy ampla automática (`fn_proteger_tabelas_de_organizacao`) deixa qualquer membro da
-- organização escrever. Procedimento é cadastro/preço de referência da clínica — leitura para
-- a organização, escrita só `manager`+ (mesmo padrão de Honorários e do caixa núcleo: "preço não
-- é coisa que `agent` configure"). A função liga a RLS ela mesma, com policy por operação, ANTES
-- de chamar a rotina automática — a partir daí ela não enxerga mais esta tabela.
--
-- ── LGPD ──────────────────────────────────────────────────────────────────────────────────────
-- Nenhuma coluna de `odontologia_procedimentos` é dado da pessoa — é cadastro da clínica (nome
-- do procedimento, duração, valor de referência). Nenhum passo novo na cascata de anonimização.
-- A tabela de atendimentos (migration seguinte) tem texto livre sobre a pessoa e vai precisar do
-- mecanismo de `modulo_secoes_lgpd` (migration 0485) — não entra aqui.
--
-- ── Nenhum consumidor real ainda ──────────────────────────────────────────────────────────────
-- Instalar o módulo é ação do administrador da instalação (D3) — não roda sozinho nesta
-- migration. Até alguém instalar, a lista de módulos ativos continua vazia e a tabela não existe.

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

  -- ── RLS POR OPERAÇÃO (D5, ligada aqui e não pela rotina automática) ────────
  -- Molde da 0480 (honorários): leitura para a organização, escrita (insert/
  -- update/delete) só `manager`+. Arquivar (ativo=false) em vez de apagar
  -- quando já usado em atendimento é decisão da APLICAÇÃO (a rota PATCH), não
  -- desta policy — a tabela de atendimentos ainda não existe nesta fatia.
  alter table public.odontologia_procedimentos enable row level security;
  drop policy if exists tenant_isolation_odontologia_procedimentos_all on public.odontologia_procedimentos;

  drop policy if exists odontologia_procedimentos_select on public.odontologia_procedimentos;
  -- Cada `create policy` deste corpo ocupa DUAS linhas de propósito (#1906). O
  -- `update.sh` de v1.39.0 a v1.63.0 lê as regras do TEXTO deste arquivo (nome
  -- da regra e tabela na MESMA linha do create), até dentro de corpo de função,
  -- e cobraria estas 4 numa instalação sem o módulo. Esse script antigo fica no
  -- disco durante a atualização, então o conserto dele não alcança quem
  -- atualiza: a forma do texto sim. Vigiado por
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

  -- RLS já ligada por nós, então esta rotina não mexe mais nela (D5) — só
  -- aplica as travas de suporte, que dependem de RLS já estar de pé.
  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

-- D4: as DUAS origens de EXECUTE (CLAUDE.md, migrations item 9) — o grant a PUBLIC que o
-- Postgres dá ao criar a função, e o `alter default privileges ... to anon` do baseline.
revoke execute on function public.fn_odontologia_provisionar() from public, anon, authenticated;
grant execute on function public.fn_odontologia_provisionar() to service_role;
