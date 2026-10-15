-- Agenda Josi: expediente 08:00–18:00 e atendimentos de 2h30.
-- Execute no SQL Editor depois de 20261008_public_booking.sql.
-- Mantém dias ativos, pausas, folgas e o histórico dos agendamentos.

begin;

do $$
declare
  v_josi_id uuid;
  v_josi_count integer;
  v_procedure record;
begin
  select count(*), min(p.id::text)::uuid
    into v_josi_count, v_josi_id
  from public.professionals p
  where lower(p.public_slug) = 'josi';

  if v_josi_count <> 1 then
    raise exception 'Esperava encontrar uma única profissional com public_slug = josi. Confira a migração public_booking antes de continuar.';
  end if;

  insert into public.professional_working_hours
    (professional_id, weekday, ativo, inicio, fim, intervalo_min)
  select v_josi_id, days.weekday, days.weekday between 1 and 6,
         time '08:00', time '18:00', 150
  from generate_series(0, 6) as days(weekday)
  on conflict (professional_id, weekday) do update
    set inicio = excluded.inicio,
        fim = excluded.fim,
        intervalo_min = excluded.intervalo_min;

  -- Atualiza a duração do catálogo para os próximos atendimentos.
  -- Os agendamentos existentes mantêm suas durações e valores históricos.
  update public.services
    set duracao_min = 150
  where professional_id = v_josi_id and ativo = true;

  for v_procedure in
    select * from (values
      ('Banho de gel'::text, 120.00::numeric),
      ('Blindagem', 80.00),
      ('Pé e mão', 60.00),
      ('Só mão', 35.00),
      ('Só pé', 40.00)
    ) as procedures(nome, preco)
  loop
    -- Reconhece também grafias sem acento para não duplicar o cadastro.
    update public.services s
      set nome = v_procedure.nome,
          preco = v_procedure.preco,
          duracao_min = 150,
          ativo = true
    where s.professional_id = v_josi_id
      and translate(lower(btrim(s.nome)), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc')
        = translate(lower(v_procedure.nome), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc');

    if not found then
      insert into public.services (professional_id, nome, preco, duracao_min, ativo)
      values (v_josi_id, v_procedure.nome, v_procedure.preco, 150, true);
    end if;
  end loop;
end;
$$;

commit;

-- Conferência: não retorna dados de clientes.
select h.weekday, h.ativo, h.inicio, h.fim, h.intervalo_min,
       h.pausa_inicio, h.pausa_fim
from public.professional_working_hours h
join public.professionals p on p.id = h.professional_id
where lower(p.public_slug) = 'josi'
order by h.weekday;

select s.nome, s.preco, s.duracao_min, s.ativo
from public.services s
join public.professionals p on p.id = s.professional_id
where lower(p.public_slug) = 'josi' and s.ativo = true
order by s.nome;
