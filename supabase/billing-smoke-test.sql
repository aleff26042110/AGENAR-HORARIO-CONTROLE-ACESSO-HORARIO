-- Teste transacional do snapshot de preço da Josi.
-- Execute o arquivo inteiro no SQL Editor depois da migração.
-- BEGIN/ROLLBACK garantem que os agendamentos e a alteração de preço de teste não ficam salvos.

begin;

do $$
declare
  v_josi_id uuid;
  v_service_id uuid;
  v_original_price numeric(10,2);
  v_old_appointment_id uuid;
  v_new_appointment_id uuid;
  v_old_date date;
  v_new_date date;
  v_old_time time;
  v_new_time time;
  v_old_snapshot numeric(10,2);
  v_new_snapshot numeric(10,2);
begin
  select p.id into v_josi_id
  from public.professionals as p
  where lower(btrim(p.nome)) in ('josi maria', 'josi')
    and coalesce(p.identidade_visual ->> 'agenda', 'site-josi') = 'site-josi';

  if v_josi_id is null then
    raise exception 'Profissional Josi não encontrada.';
  end if;

  select s.id, s.preco into v_service_id, v_original_price
  from public.services as s
  where s.professional_id = v_josi_id
    and s.nome = 'Banho de gel'
    and s.ativo;

  if v_service_id is null or v_original_price is null then
    raise exception 'Procedimento Banho de gel sem preço. Execute primeiro a migração.';
  end if;

  select days.day::date, make_time(slots.hour, 0, 0)
    into v_old_date, v_old_time
  from generate_series((current_date + 1)::timestamp, (current_date + 400)::timestamp, interval '1 day') as days(day)
  cross join generate_series(9, 18) as slots(hour)
  where not exists (
    select 1 from public.appointments as a
    where a.professional_id = v_josi_id
      and a.data = days.day::date
      and a.horario = make_time(slots.hour, 0, 0)
  )
  order by days.day, slots.hour
  limit 1;

  if v_old_date is null then
    raise exception 'Não encontrei horário livre para o teste transacional.';
  end if;

  insert into public.appointments (
    professional_id, cliente_nome, servico, service_id, data, horario
  ) values (
    v_josi_id, 'TESTE BILLING ROLLBACK', 'Banho de gel', v_service_id, v_old_date, v_old_time
  ) returning id, valor_cobrado into v_old_appointment_id, v_old_snapshot;

  if v_old_snapshot <> v_original_price then
    raise exception 'Falha no snapshot inicial: esperado %, recebido %.', v_original_price, v_old_snapshot;
  end if;

  update public.services
  set preco = v_original_price + 20
  where id = v_service_id;

  select days.day::date, make_time(slots.hour, 0, 0)
    into v_new_date, v_new_time
  from generate_series((current_date + 1)::timestamp, (current_date + 400)::timestamp, interval '1 day') as days(day)
  cross join generate_series(9, 18) as slots(hour)
  where not exists (
    select 1 from public.appointments as a
    where a.professional_id = v_josi_id
      and a.data = days.day::date
      and a.horario = make_time(slots.hour, 0, 0)
  )
  order by days.day, slots.hour
  limit 1;

  insert into public.appointments (
    professional_id, cliente_nome, servico, service_id, data, horario
  ) values (
    v_josi_id, 'TESTE BILLING ROLLBACK 2', 'Banho de gel', v_service_id, v_new_date, v_new_time
  ) returning id, valor_cobrado into v_new_appointment_id, v_new_snapshot;

  select a.valor_cobrado into v_old_snapshot
  from public.appointments as a
  where a.id = v_old_appointment_id;

  if v_old_snapshot <> v_original_price then
    raise exception 'O atendimento antigo mudou de preço: esperado %, recebido %.', v_original_price, v_old_snapshot;
  end if;
  if v_new_snapshot <> v_original_price + 20 then
    raise exception 'O atendimento novo não pegou o preço atualizado: esperado %, recebido %.', v_original_price + 20, v_new_snapshot;
  end if;

  raise notice 'Teste OK: snapshot antigo = %, snapshot novo = %.', v_old_snapshot, v_new_snapshot;
end $$;

rollback;
