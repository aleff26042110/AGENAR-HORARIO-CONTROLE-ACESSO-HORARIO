-- Expõe somente o número de WhatsApp escolhido pela profissional para reservas.
-- Execute depois de 20261008_public_booking.sql. Reexecutável e sem alterações de dados.

begin;

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
    'whatsapp', case
      when length(regexp_replace(coalesce(p.telefone, ''), '[^0-9]', '', 'g')) between 10 and 15
        then regexp_replace(coalesce(p.telefone, ''), '[^0-9]', '', 'g')
      else null
    end,
    'marca', coalesce(p.identidade_visual ->> 'marca', 'JM'),
    'tema', coalesce(p.identidade_visual ->> 'tema', 'rose')
  ) into v_result
  from public.professionals p
  where p.id = v_id;
  return v_result;
end;
$$;

revoke all on function public.get_public_professional(text) from public, anon, authenticated;
grant execute on function public.get_public_professional(text) to anon, authenticated;

commit;
