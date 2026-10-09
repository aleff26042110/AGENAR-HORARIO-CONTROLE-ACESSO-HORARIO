-- Agenda pública de agendamento, horários de trabalho e bloqueios.
-- Execute depois de 20261008_josi_billing.sql no SQL Editor do Supabase.
-- Esta migração é incremental; não remove nem recria dados existentes.

begin;

-- Reaplica a proteção do perfil e do catálogo no banco já existente.
alter table public.profiles enable row level security;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists services_select_auth on public.services;
drop policy if exists services_select_own on public.services;
create policy services_select_own on public.services
  for select to authenticated
  using (
    public.is_admin()
    or professional_id in (select public.my_professional_ids())
  );

alter table public.professionals
  add column if not exists public_slug text;
alter table public.professionals
  add column if not exists timezone_name text not null default 'America/Sao_Paulo';

alter table public.appointments
  add column if not exists duracao_min integer;
alter table public.appointments
  add column if not exists valor_cobrado numeric(10,2) not null default 0;

update public.appointments a
set duracao_min = coalesce(s.duracao_min, 60)
from public.services s
where a.service_id = s.id
  and a.duracao_min is null;
update public.appointments set duracao_min = 60 where duracao_min is null;
alter table public.appointments alter column duracao_min set default 60;
alter table public.appointments alter column duracao_min set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_duracao_min_positive'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_duracao_min_positive check (duracao_min > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_valor_cobrado_nonnegative'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_valor_cobrado_nonnegative check (valor_cobrado >= 0);
  end if;
end $$;

create unique index if not exists professionals_public_slug_uidx
  on public.professionals (lower(public_slug))
  where public_slug is not null;

do $$
declare
  v_josi_id uuid;
  v_josi_count integer;
begin
  select count(*), min(p.id::text)::uuid
    into v_josi_count, v_josi_id
  from public.professionals p
  where lower(btrim(p.nome)) in ('josi maria', 'josi')
    and coalesce(p.identidade_visual ->> 'agenda', 'site-josi') = 'site-josi';

  if v_josi_count = 1 then
    if exists (
      select 1 from public.professionals p
      where lower(p.public_slug) = 'josi' and p.id <> v_josi_id
    ) then
      raise exception 'O link público /agendar/ já está reservado por outra profissional. Revise professionals.public_slug.';
    end if;
    update public.professionals set public_slug = 'josi'
    where id = v_josi_id and public_slug is null;
  end if;
end $$;

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

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists trg_professional_working_hours_touch on public.professional_working_hours;
create trigger trg_professional_working_hours_touch before update on public.professional_working_hours
for each row execute function public.touch_updated_at();

create index if not exists idx_professional_blocked_dates_prof_date
  on public.professional_blocked_dates (professional_id, data);

-- Serializa a criação/remoção de uma folga com reservas da mesma profissional/data.
create or replace function public.lock_blocked_date_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_professional_id uuid;
  v_date date;
begin
  if tg_op = 'DELETE' then
    v_professional_id := old.professional_id;
    v_date := old.data;
  else
    v_professional_id := new.professional_id;
    v_date := new.data;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('appointment:' || v_professional_id::text || ':' || v_date::text, 0)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_blocked_date_change_lock on public.professional_blocked_dates;
create trigger trg_blocked_date_change_lock
before insert or update or delete on public.professional_blocked_dates
for each row execute function public.lock_blocked_date_change();
revoke all on function public.lock_blocked_date_change() from public;

-- Agenda inicial baseada nos antigos horários 09:00–18:00. A Josi pode
-- editar os dias, intervalos e pausa no painel antes de divulgar o link.
insert into public.professional_working_hours
  (professional_id, weekday, ativo, inicio, fim, intervalo_min)
select p.id, days.weekday, days.weekday between 1 and 6, '09:00', '18:00', 30
from public.professionals p
cross join (values (0::smallint),(1::smallint),(2::smallint),(3::smallint),
                   (4::smallint),(5::smallint),(6::smallint)) as days(weekday)
where p.public_slug = 'josi'
on conflict (professional_id, weekday) do nothing;

alter table public.professional_working_hours enable row level security;
alter table public.professional_blocked_dates enable row level security;

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

revoke all on public.professional_working_hours, public.professional_blocked_dates from public, anon;
grant select, insert, update, delete on public.professional_working_hours,
  public.professional_blocked_dates to authenticated;

-- O link público usa RPCs de leitura mínima; anon não recebe acesso direto às tabelas.
revoke all on public.profiles, public.professionals, public.plans,
  public.subscriptions, public.services, public.clients, public.appointments
  from public, anon;

-- O valor e a duração do atendimento são snapshots definidos pelo serviço no INSERT.
create or replace function public.set_appointment_price_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_service_name text;
  v_service_price numeric(10,2);
  v_service_duration integer;
  v_service_professional_id uuid;
  v_service_active boolean;
  v_is_public_agenda boolean := false;
begin
  select lower(btrim(p.nome)) in ('josi maria', 'josi')
      and coalesce(p.identidade_visual ->> 'agenda', 'site-josi') = 'site-josi'
    into v_is_public_agenda
  from public.professionals p
  where p.id = new.professional_id;

  if tg_op = 'UPDATE' then
    if new.service_id is distinct from old.service_id and new.service_id is not null then
      raise exception 'O procedimento de um agendamento existente não pode ser trocado.'
        using errcode = '23514';
    end if;
    new.servico := old.servico;
    new.valor_cobrado := old.valor_cobrado;
    new.duracao_min := old.duracao_min;
    return new;
  end if;

  if new.service_id is null then
    if v_is_public_agenda then
      raise exception 'Selecione um procedimento cadastrado para agendar.'
        using errcode = '23514';
    end if;
    -- Mantém compatibilidade com a agenda Gi e outros profissionais que ainda
    -- não usam o catálogo de procedimentos com preço.
    new.valor_cobrado := 0;
    new.duracao_min := coalesce(new.duracao_min, 60);
    return new;
  end if;

  select s.nome, s.preco, s.duracao_min, s.professional_id, s.ativo
    into v_service_name, v_service_price, v_service_duration,
         v_service_professional_id, v_service_active
  from public.services s
  where s.id = new.service_id;

  if not found or v_service_professional_id is distinct from new.professional_id
     or v_service_active is distinct from true then
    raise exception 'O procedimento não pertence a esta profissional ou está inativo.'
      using errcode = '23514';
  end if;
  if v_service_duration < 1 then
    raise exception 'Cadastre uma duração válida para este procedimento.'
      using errcode = '23514';
  end if;
  if v_service_price is null then
    -- Mantém compatibilidade com agendas existentes sem faturamento habilitado.
    new.servico := v_service_name;
    new.valor_cobrado := 0;
    new.duracao_min := v_service_duration;
    return new;
  end if;
  if v_service_price < 0 then
    raise exception 'Cadastre um preço válido para este procedimento.'
      using errcode = '23514';
  end if;

  new.servico := v_service_name;
  new.valor_cobrado := v_service_price;
  new.duracao_min := v_service_duration;
  return new;
end;
$$;

drop trigger if exists trg_appointments_price_snapshot on public.appointments;
create trigger trg_appointments_price_snapshot
before insert or update on public.appointments
for each row execute function public.set_appointment_price_snapshot();
revoke all on function public.set_appointment_price_snapshot() from public;

-- Serializa reservas do mesmo profissional/dia e rejeita qualquer sobreposição,
-- inclusive quando dois horários de início diferentes usam serviços longos.
create or replace function public.prevent_appointment_overlap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_duration integer;
  v_service_duration integer;
  v_professional_id uuid;
begin
  if tg_op = 'UPDATE' and new.service_id is not distinct from old.service_id then
    v_duration := coalesce(old.duracao_min, 60);
  elsif new.service_id is not null then
    select s.duracao_min into v_service_duration
    from public.services s
    where s.id = new.service_id
      and s.professional_id = new.professional_id
      and s.ativo = true;
    if not found then
      raise exception 'Procedimento indisponível.' using errcode = '23514';
    end if;
    v_duration := v_service_duration;
  else
    v_duration := coalesce(new.duracao_min, 60);
  end if;

  if v_duration < 1 then
    raise exception 'Duração inválida.' using errcode = '23514';
  end if;
  new.duracao_min := v_duration;
  v_professional_id := new.professional_id;

  -- O bloqueio de sobreposição vale para agendas públicas habilitadas por slug.
  -- As agendas existentes sem slug preservam o comportamento atual.
  if not exists (
    select 1 from public.professionals p
    where p.id = v_professional_id and p.public_slug is not null
  ) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('appointment:' || v_professional_id::text || ':' || new.data::text, 0)
  );

  if exists (
    select 1
    from public.appointments a
    where a.professional_id = v_professional_id
      and a.data = new.data
      and (tg_op <> 'UPDATE' or a.id <> new.id)
      and (a.data + a.horario) < (new.data + new.horario + make_interval(mins => v_duration))
      and (a.data + a.horario + make_interval(mins => coalesce(a.duracao_min, 60)))
          > (new.data + new.horario)
  ) then
    raise exception 'Esse horário acabou de ser reservado. Escolha outro horário.'
      using errcode = '23P01';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_appointments_overlap_guard on public.appointments;
create trigger trg_appointments_overlap_guard
before insert or update of professional_id, service_id, data, horario
on public.appointments
for each row execute function public.prevent_appointment_overlap();
revoke all on function public.prevent_appointment_overlap() from public;

-- Resolve o slug público sem retornar registros privados da profissional.
create or replace function public._resolve_public_professional(p_slug text)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  select p.id into v_id
  from public.professionals p
  where lower(p.public_slug) = lower(btrim(p_slug))
    and p.status = 'Ativo'
    and not exists (
      select 1 from (
        select s.status, s.vencimento
        from public.subscriptions s
        where s.professional_id = p.id
        order by s.created_at desc, s.id desc
        limit 1
      ) latest
      where latest.status in ('Vencido','Bloqueado','Suspenso')
         or latest.vencimento < current_date
    );
  if v_id is null then
    raise exception 'Agenda não encontrada ou indisponível.' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;
revoke all on function public._resolve_public_professional(text) from public, anon, authenticated;

create or replace function public.get_public_professional(p_slug text default 'josi')
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_result jsonb;
begin
  v_id := public._resolve_public_professional(p_slug);
  select jsonb_build_object(
    'nome', p.nome,
    'especialidade', p.especialidade,
    'instagram', p.instagram,
    'marca', coalesce(p.identidade_visual ->> 'marca', 'JM'),
    'tema', coalesce(p.identidade_visual ->> 'tema', 'rose')
  ) into v_result
  from public.professionals p where p.id = v_id;
  return v_result;
end;
$$;

create or replace function public.get_public_services(p_slug text default 'josi')
returns table(service_id uuid, nome text, preco numeric, duracao_min integer)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  v_id := public._resolve_public_professional(p_slug);
  return query
  select s.id, s.nome, s.preco, s.duracao_min
  from public.services s
  where s.professional_id = v_id and s.ativo = true and s.preco is not null
  order by s.nome;
end;
$$;

create or replace function public.get_public_available_slots(
  p_slug text,
  p_service_id uuid,
  p_data date
)
returns table(horario time)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_duration integer;
  v_today date;
  v_now timestamp without time zone;
  v_timezone text;
  v_hours public.professional_working_hours%rowtype;
begin
  v_id := public._resolve_public_professional(p_slug);
  select coalesce(s.duracao_min, 60) into v_duration
  from public.services s
  where s.id = p_service_id and s.professional_id = v_id
    and s.ativo = true and s.preco is not null;
  if not found then
    raise exception 'Procedimento indisponível.' using errcode = '22023';
  end if;

  select coalesce(p.timezone_name, 'America/Sao_Paulo') into v_timezone
  from public.professionals p where p.id = v_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_now := clock_timestamp() at time zone v_timezone;
  if p_data < v_today then return; end if;
  if exists (
    select 1 from public.professional_blocked_dates b
    where b.professional_id = v_id and b.data = p_data
  ) then return; end if;

  select h.* into v_hours
  from public.professional_working_hours h
  where h.professional_id = v_id
    and h.weekday = extract(dow from p_data)::smallint
    and h.ativo = true;
  if not found then return; end if;

  return query
  select slots.start_at::time
  from generate_series(
    p_data + v_hours.inicio,
    p_data + v_hours.fim - make_interval(mins => v_duration),
    make_interval(mins => v_hours.intervalo_min)
  ) as slots(start_at)
  where (p_data > v_today or slots.start_at > v_now)
    and not (
      v_hours.pausa_inicio is not null
      and slots.start_at < p_data + v_hours.pausa_fim
      and slots.start_at + make_interval(mins => v_duration) > p_data + v_hours.pausa_inicio
    )
    and not exists (
      select 1 from public.appointments a
      where a.professional_id = v_id and a.data = p_data
        and slots.start_at < p_data + a.horario + make_interval(mins => coalesce(a.duracao_min, 60))
        and slots.start_at + make_interval(mins => v_duration) > p_data + a.horario
    )
  order by slots.start_at;
end;
$$;

create or replace function public.create_public_booking(
  p_slug text,
  p_service_id uuid,
  p_data date,
  p_horario time,
  p_nome text,
  p_telefone text,
  p_observacoes text default ''
)
returns table(
  appointment_id uuid,
  professional_name text,
  service_name text,
  service_price numeric,
  appointment_date date,
  appointment_time time,
  client_name text,
  client_phone text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_professional_id uuid;
  v_professional_name text;
  v_service_name text;
  v_service_price numeric(10,2);
  v_service_duration integer;
  v_client_id uuid;
  v_appointment_id uuid;
  v_phone_digits text;
  v_name text := btrim(coalesce(p_nome, ''));
  v_phone text := btrim(coalesce(p_telefone, ''));
  v_notes text := btrim(coalesce(p_observacoes, ''));
begin
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Informe seu nome (de 2 a 80 caracteres).' using errcode = '22023';
  end if;
  v_phone_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
  if length(v_phone_digits) not between 10 and 15 then
    raise exception 'Informe um telefone válido.' using errcode = '22023';
  end if;
  if length(v_phone) > 30 then
    raise exception 'O telefone deve ter no máximo 30 caracteres.' using errcode = '22023';
  end if;
  if length(v_notes) > 400 then
    raise exception 'As observações devem ter no máximo 400 caracteres.' using errcode = '22023';
  end if;

  v_professional_id := public._resolve_public_professional(p_slug);
  select p.nome into v_professional_name from public.professionals p where p.id = v_professional_id;
  select s.nome, s.preco, s.duracao_min
    into v_service_name, v_service_price, v_service_duration
  from public.services s
  where s.id = p_service_id and s.professional_id = v_professional_id
    and s.ativo = true and s.preco is not null;
  if not found then
    raise exception 'Esse procedimento não está disponível. Atualize a página e escolha outro.'
      using errcode = '22023';
  end if;

  -- Mesmo bloqueio usado pelo trigger. A validação e o INSERT ficam serializados por dia.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('appointment:' || v_professional_id::text || ':' || p_data::text, 0)
  );
  if not exists (
    select 1 from public.get_public_available_slots(p_slug, p_service_id, p_data) slots
    where slots.horario = p_horario
  ) then
    raise exception 'Esse horário acabou de ser reservado ou não está mais disponível.'
      using errcode = '23P01';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('client:' || v_professional_id::text || ':' || v_phone_digits, 0)
  );
  select c.id into v_client_id
  from public.clients c
  where c.professional_id = v_professional_id
    and regexp_replace(coalesce(c.telefone, ''), '[^0-9]', '', 'g') = v_phone_digits
  order by c.created_at, c.id
  limit 1
  for update;

  if v_client_id is null then
    insert into public.clients (professional_id, nome, telefone)
    values (v_professional_id, v_name, v_phone)
    returning id into v_client_id;
  end if;
  -- Se já existia um telefone correspondente, somente reutilizamos seu ID.
  -- Uma reserva anônima não pode sobrescrever os dados daquele cadastro.

  insert into public.appointments (
    professional_id, client_id, cliente_nome, telefone, servico, service_id,
    data, horario, observacoes, duracao_min
  ) values (
    v_professional_id, v_client_id, v_name, v_phone, v_service_name, p_service_id,
    p_data, p_horario, v_notes, v_service_duration
  ) returning id into v_appointment_id;

  return query select v_appointment_id, v_professional_name, v_service_name,
    v_service_price, p_data, p_horario, v_name, v_phone;
exception
  when unique_violation or exclusion_violation then
    raise exception 'Esse horário acabou de ser reservado. Escolha outro horário.'
      using errcode = '23P01';
end;
$$;

revoke all on function public.get_public_professional(text) from public, anon, authenticated;
revoke all on function public.get_public_services(text) from public, anon, authenticated;
revoke all on function public.get_public_available_slots(text, uuid, date) from public, anon, authenticated;
revoke all on function public.create_public_booking(text, uuid, date, time, text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_public_professional(text) to anon, authenticated;
grant execute on function public.get_public_services(text) to anon, authenticated;
grant execute on function public.get_public_available_slots(text, uuid, date) to anon, authenticated;
grant execute on function public.create_public_booking(text, uuid, date, time, text, text, text)
  to anon, authenticated;

commit;

-- Conferência administrativa: não expõe dados de clientes.
select p.nome, p.public_slug, h.weekday, h.ativo, h.inicio, h.fim,
       h.intervalo_min, h.pausa_inicio, h.pausa_fim
from public.professionals p
join public.professional_working_hours h on h.professional_id = p.id
where p.public_slug = 'josi'
order by h.weekday;
