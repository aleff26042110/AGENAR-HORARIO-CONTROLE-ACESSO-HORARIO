-- Agenda Josi: preço histórico por agendamento e procedimentos oficiais.
-- Execute no SQL Editor do projeto Supabase, depois de conferir a Josi vinculada.
-- Não apaga tabelas nem agendamentos existentes.

begin;

-- Agendamentos já existentes recebem 0 porque o preço histórico não foi guardado.
alter table public.appointments
  add column if not exists valor_cobrado numeric(10,2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_valor_cobrado_nonnegative'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_valor_cobrado_nonnegative
      check (valor_cobrado >= 0);
  end if;
end $$;

-- O preço é definido pelo serviço no INSERT e fica imutável no histórico.
create or replace function public.set_appointment_price_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_service_name text;
  v_service_price numeric(10,2);
  v_service_professional_id uuid;
  v_service_active boolean;
  v_is_josi boolean := false;
begin
  select lower(btrim(p.nome)) in ('josi maria', 'josi')
      and coalesce(p.identidade_visual ->> 'agenda', 'site-josi') = 'site-josi'
    into v_is_josi
  from public.professionals as p
  where p.id = new.professional_id;

  if tg_op = 'UPDATE' then
    if new.service_id is distinct from old.service_id and new.service_id is not null then
      raise exception 'O procedimento de um agendamento existente não pode ser trocado.'
        using errcode = '23514';
    end if;
    new.servico := old.servico;
    new.valor_cobrado := old.valor_cobrado;
    return new;
  end if;

  if new.service_id is null then
    if v_is_josi then
      raise exception 'Selecione um procedimento cadastrado para agendar.'
        using errcode = '23514';
    end if;
    new.valor_cobrado := 0;
    return new;
  end if;

  select s.nome, s.preco, s.professional_id, s.ativo
    into v_service_name, v_service_price, v_service_professional_id, v_service_active
  from public.services as s
  where s.id = new.service_id;

  if not found
    or v_service_professional_id is distinct from new.professional_id
    or v_service_active is distinct from true then
    raise exception 'O procedimento não pertence a esta profissional ou está inativo.'
      using errcode = '23514';
  end if;

  if v_service_price is null then
    if v_is_josi then
      raise exception 'Cadastre um preço válido para este procedimento antes de agendar.'
        using errcode = '23514';
    end if;
    new.servico := v_service_name;
    new.valor_cobrado := 0;
    return new;
  end if;

  if v_service_price < 0 then
    raise exception 'Cadastre um preço válido para este procedimento antes de agendar.'
      using errcode = '23514';
  end if;

  -- Ignora qualquer valor enviado pelo navegador: o banco é a fonte do preço.
  new.servico := v_service_name;
  new.valor_cobrado := v_service_price;
  return new;
end;
$$;

drop trigger if exists trg_appointments_price_snapshot on public.appointments;
create trigger trg_appointments_price_snapshot
before insert or update on public.appointments
for each row execute function public.set_appointment_price_snapshot();
revoke all on function public.set_appointment_price_snapshot() from public;

-- Profissionais não alteram o catálogo de preços pelo navegador; administradores
-- e o SQL Editor continuam podendo manter os valores do catálogo.
create or replace function public.guard_service_catalog_price()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    if tg_op = 'INSERT' and new.preco is not null then
      raise exception 'Somente a administração pode cadastrar o preço de um procedimento.'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.preco is distinct from old.preco then
      raise exception 'Somente a administração pode alterar o preço de um procedimento.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_services_guard_price on public.services;
create trigger trg_services_guard_price
before insert or update on public.services
for each row execute function public.guard_service_catalog_price();
revoke all on function public.guard_service_catalog_price() from public;

-- Serviços passam a ser visíveis somente à profissional proprietária e à administração.
drop policy if exists services_select_auth on public.services;
drop policy if exists services_select_own on public.services;
create policy services_select_own on public.services
  for select to authenticated
  using (
    public.is_admin()
    or professional_id in (select public.my_professional_ids())
  );

-- Identifica a agenda da Josi pelo nome. Se houver mais de uma correspondência,
-- interrompe sem alterar procedimentos para evitar atualizar a conta errada.
do $$
declare
  v_josi_ids uuid[];
  v_josi_id uuid;
  v_procedure record;
begin
  select array_agg(p.id order by p.created_at, p.id)
    into v_josi_ids
  from public.professionals as p
  where lower(btrim(p.nome)) in ('josi maria', 'josi')
    and coalesce(p.identidade_visual ->> 'agenda', 'site-josi') = 'site-josi';

  if coalesce(array_length(v_josi_ids, 1), 0) <> 1 then
    raise exception 'Esperava encontrar uma única profissional Josi na agenda site-josi. Confira professionals.nome/identidade_visual e ajuste a identificação antes de executar novamente.';
  end if;

  v_josi_id := v_josi_ids[1];

  for v_procedure in
    select * from (values
      ('Blindagem com esmaltação em gel'::text, 80.00::numeric),
      ('Blindagem com esmaltação comum', 70.00),
      ('Apenas blindagem', 60.00),
      ('Banho de gel', 120.00),
      ('Alongamento em fibra de vidro + esmaltação em gel + 2 unhas decoradas', 180.00),
      ('Manutenção 15 dias após procedimento', 90.00),
      ('Manutenção 21 dias após procedimento', 120.00),
      ('Manutenção 31 dias após procedimento', 135.00),
      ('Reconstrução de unha', 10.00),
      ('Unhas decoradas', 10.00)
    ) as procedure_list(nome, preco)
  loop
    update public.services as s
      set preco = v_procedure.preco,
          ativo = true
    where s.professional_id = v_josi_id
      and lower(btrim(s.nome)) = lower(btrim(v_procedure.nome));

    if not found then
      insert into public.services (professional_id, nome, preco, ativo)
      values (v_josi_id, v_procedure.nome, v_procedure.preco, true);
    end if;
  end loop;

  -- Preserva serviços antigos e seus vínculos, mas tira da seleção os nomes
  -- que não fazem parte da lista oficial solicitada.
  update public.services as s
    set ativo = false
  where s.professional_id = v_josi_id
    and lower(btrim(s.nome)) not in (
      lower('Blindagem com esmaltação em gel'),
      lower('Blindagem com esmaltação comum'),
      lower('Apenas blindagem'),
      lower('Banho de gel'),
      lower('Alongamento em fibra de vidro + esmaltação em gel + 2 unhas decoradas'),
      lower('Manutenção 15 dias após procedimento'),
      lower('Manutenção 21 dias após procedimento'),
      lower('Manutenção 31 dias após procedimento'),
      lower('Reconstrução de unha'),
      lower('Unhas decoradas')
    );
end $$;

commit;

-- Conferência após executar:
select p.nome as profissional, s.nome as procedimento, s.preco, s.ativo
from public.professionals as p
join public.services as s on s.professional_id = p.id
where lower(btrim(p.nome)) in ('josi maria', 'josi')
  and coalesce(p.identidade_visual ->> 'agenda', 'site-josi') = 'site-josi'
order by s.ativo desc, s.nome;
