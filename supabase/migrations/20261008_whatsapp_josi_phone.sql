-- Configura o número de WhatsApp fornecido para a agenda pública da Josi.
-- Execute depois de 20261008_public_booking.sql; o painel permite alterá-lo depois.

begin;

do $$
declare
  v_josi_count integer;
begin
  select count(*) into v_josi_count
  from public.professionals
  where public_slug = 'josi';

  if v_josi_count <> 1 then
    raise exception 'Esperava encontrar uma profissional com public_slug = josi; confira a migração public_booking antes de configurar o WhatsApp.';
  end if;

  update public.professionals
  set telefone = '12 98884-8361'
  where public_slug = 'josi';
end;
$$;

commit;

select nome,
       case when regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') = '12988848361'
         then 'WhatsApp de confirmação configurado'
         else 'Confira o número de WhatsApp no painel'
       end as resultado
from public.professionals
where public_slug = 'josi';
