-- ============================================================
-- AGENDA JOSI — Schema Supabase
-- Rode este arquivo no SQL Editor do Supabase (na ordem).
-- Não contém credenciais. Não exponha service_role no frontend.
-- ============================================================

-- ---------- 0. Limpeza opcional (descomente se precisar recriar) ----------
-- drop table if exists public.appointments cascade;
-- drop table if exists public.clients cascade;
-- drop table if exists public.services cascade;
-- drop table if exists public.subscriptions cascade;
-- drop table if exists public.plans cascade;
-- drop table if exists public.professionals cascade;
-- drop table if exists public.profiles cascade;
-- drop function if exists public.is_admin() cascade;
-- drop function if exists public.handle_new_user() cascade;

-- ---------- 1. Tabelas base ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'profissional' check (role in ('profissional','administrador')),
  created_at timestamptz not null default now()
);

create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  nome text not null default 'Josi Maria',
  email text not null default '',
  especialidade text not null default 'alongamento/design de unhas',
  telefone text default '',
  instagram text default 'https://www.instagram.com/josimaria_naildesigner/',
  identidade_visual jsonb not null default '{"marca":"JM","tema":"rose"}'::jsonb,
  public_slug text,
  timezone_name text not null default 'America/Sao_Paulo',
  status text not null default 'Ativo' check (status in ('Ativo','Vencido','Bloqueado','Suspenso')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  preco numeric(10,2) not null default 0,
  descricao text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  status text not null default 'Ativo' check (status in ('Ativo','Vencido','Bloqueado','Suspenso')),
  inicio date not null default current_date,
  vencimento date not null default (current_date + interval '30 days')::date,
  observacoes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  nome text not null,
  duracao_min integer not null default 60,
  preco numeric(10,2) default null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  nome text not null,
  telefone text default '',
  observacoes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_clients_professional on public.clients(professional_id);
create index if not exists idx_clients_telefone on public.clients(telefone);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  cliente_nome text not null default '',
  telefone text default '',
  servico text not null default '',
  service_id uuid references public.services(id) on delete set null,
  data date not null,
  horario time not null,
  duracao_min integer not null default 60 check (duracao_min > 0),
  valor_cobrado numeric(10,2) not null default 0 check (valor_cobrado >= 0),
  observacoes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (professional_id, data, horario)
);
create index if not exists idx_appointments_prof_data on public.appointments(professional_id, data);
create unique index if not exists professionals_public_slug_uidx
  on public.professionals (lower(public_slug)) where public_slug is not null;

create table if not exists public.professional_working_hours (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  ativo boolean not null default false,
  inicio time not null default '09:00',
  fim time not null default '18:00',
  intervalo_min integer not null default 30 check (intervalo_min between 5 and 240),
  pausa_inicio time,
  pausa_fim time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (professional_id, weekday),
  check (inicio < fim),
  check (
    (pausa_inicio is null and pausa_fim is null)
    or (pausa_inicio is not null and pausa_fim is not null
      and inicio <= pausa_inicio and pausa_inicio < pausa_fim and pausa_fim <= fim)
  )
);

create table if not exists public.professional_blocked_dates (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  data date not null,
  motivo text not null default '',
  created_at timestamptz not null default now(),
  unique (professional_id, data)
);
create index if not exists idx_professional_blocked_dates_prof_date
  on public.professional_blocked_dates(professional_id, data);

-- ---------- 2. updated_at automático ----------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_professionals_touch on public.professionals;
create trigger trg_professionals_touch before update on public.professionals
for each row execute function public.touch_updated_at();

drop trigger if exists trg_subscriptions_touch on public.subscriptions;
create trigger trg_subscriptions_touch before update on public.subscriptions
for each row execute function public.touch_updated_at();

drop trigger if exists trg_clients_touch on public.clients;
create trigger trg_clients_touch before update on public.clients
for each row execute function public.touch_updated_at();

drop trigger if exists trg_appointments_touch on public.appointments;
create trigger trg_appointments_touch before update on public.appointments
for each row execute function public.touch_updated_at();

drop trigger if exists trg_professional_working_hours_touch on public.professional_working_hours;
create trigger trg_professional_working_hours_touch before update on public.professional_working_hours
for each row execute function public.touch_updated_at();

-- ---------- 3. Helpers de autorização ----------

-- Retorna true se o usuário logado é administrador.
-- Usa profiles (tabela nossa), não confia no frontend.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'administrador'
  );
$$;

-- Profissionais vinculados ao usuário logado (para políticas).
create or replace function public.my_professional_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select pr.id from public.professionals pr where pr.user_id = auth.uid();
$$;

-- Cria profile automaticamente quando um usuário se cadastra no Auth.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'profissional')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_auth_new_profile on auth.users;
create trigger trg_auth_new_profile after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- 4. RLS ----------

alter table public.profiles enable row level security;
alter table public.professionals enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.professional_working_hours enable row level security;
alter table public.professional_blocked_dates enable row level security;

-- profiles: cada um lê o próprio; admin lê todos; ninguém vira admin sozinho.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- Perfis são criados pelo trigger de auth.users; somente admins podem alterá-los.
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- professionals: dono lê/escreve o próprio; admin tudo.
drop policy if exists professionals_all_admin on public.professionals;
create policy professionals_all_admin on public.professionals
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists professionals_select_own on public.professionals;
create policy professionals_select_own on public.professionals
  for select using (user_id = auth.uid());

drop policy if exists professionals_update_own on public.professionals;
create policy professionals_update_own on public.professionals
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- plans: leitura para logados; escrita só admin.
drop policy if exists plans_select_auth on public.plans;
create policy plans_select_auth on public.plans
  for select using (auth.role() = 'authenticated');

drop policy if exists plans_write_admin on public.plans;
create policy plans_write_admin on public.plans
  for all using (public.is_admin()) with check (public.is_admin());

-- subscriptions: profissional vê a própria; admin tudo.
drop policy if exists subscriptions_all_admin on public.subscriptions;
create policy subscriptions_all_admin on public.subscriptions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select using (professional_id in (select public.my_professional_ids()));

-- services: leitura e escrita restritas à própria profissional e ao admin.
drop policy if exists services_select_auth on public.services;
create policy services_select_auth on public.services
  for select using (
    public.is_admin() or professional_id in (select public.my_professional_ids())
  );

drop policy if exists services_write_own on public.services;
create policy services_write_own on public.services
  for all using (
    public.is_admin() or professional_id in (select public.my_professional_ids())
  ) with check (
    public.is_admin() or professional_id in (select public.my_professional_ids())
  );

-- clients: dono gerencia; admin tudo.
drop policy if exists clients_all_owner on public.clients;
create policy clients_all_owner on public.clients
  for all using (
    public.is_admin() or professional_id in (select public.my_professional_ids())
  ) with check (
    public.is_admin() or professional_id in (select public.my_professional_ids())
  );

-- appointments: dono gerencia; admin tudo.
drop policy if exists appointments_all_owner on public.appointments;
create policy appointments_all_owner on public.appointments
  for all using (
    public.is_admin() or professional_id in (select public.my_professional_ids())
  ) with check (
    public.is_admin() or professional_id in (select public.my_professional_ids())
  );

drop policy if exists professional_hours_owner_admin on public.professional_working_hours;
create policy professional_hours_owner_admin on public.professional_working_hours
  for all to authenticated
  using (public.is_admin() or professional_id in (select public.my_professional_ids()))
  with check (public.is_admin() or professional_id in (select public.my_professional_ids()));

drop policy if exists professional_blocked_dates_owner_admin on public.professional_blocked_dates;
create policy professional_blocked_dates_owner_admin on public.professional_blocked_dates
  for all to authenticated
  using (public.is_admin() or professional_id in (select public.my_professional_ids()))
  with check (public.is_admin() or professional_id in (select public.my_professional_ids()));

-- Clientes anônimas usam somente as RPCs públicas da migração de agendamento.
revoke all on public.profiles, public.professionals, public.plans,
  public.subscriptions, public.services, public.clients, public.appointments,
  public.professional_working_hours, public.professional_blocked_dates
  from public, anon;
grant select, insert, update, delete on public.professional_working_hours,
  public.professional_blocked_dates to authenticated;

-- ---------- 5. Seeds iniciais ----------

insert into public.plans (nome, preco, descricao) values
  ('Mensal Essencial', 39.90, 'Agenda + clientes + 1 profissional'),
  ('Mensal Profissional', 59.90, 'Tudo do Essencial + estatísticas + suporte')
on conflict (nome) do nothing;

-- ============================================================
-- PÓS-DEPLOY (fazer no painel Supabase, não no código):
-- 1. Authentication > Providers > Email ligado.
-- 2. Criar usuário da Josi em Authentication > Users.
-- 3. No SQL Editor, descobrir o id e promover/criar:
--
--    select id, email from auth.users;
--
--    -- tornar alguém administrador (rode como postgres/service_role no SQL Editor):
--    insert into public.profiles (id, email, role)
--    values ('<UID-DO-ADMIN>', 'admin@exemplo.com', 'administrador')
--    on conflict (id) do update set role = 'administrador';
--
--    -- cadastrar a Josi como profissional vinculada ao login dela:
--    insert into public.professionals (user_id, nome, email, especialidade, status)
--    values ('<UID-DA-JOSI>', 'Josi Maria', 'josi@exemplo.com', 'alongamento/design de unhas', 'Ativo');
--
--    -- assinatura manual de 30 dias:
--    insert into public.subscriptions (professional_id, plan_id, status, inicio, vencimento)
--    select pr.id, pl.id, 'Ativo', current_date, current_date + 30
--    from public.professionals pr, public.plans pl
--    where pr.email = 'josi@exemplo.com' and pl.nome = 'Mensal Essencial' limit 1;
--
--    -- Para cadastrar os procedimentos reais e os preços da Josi, execute
--    -- supabase/migrations/20261008_josi_billing.sql após identificar o perfil.
-- ============================================================
