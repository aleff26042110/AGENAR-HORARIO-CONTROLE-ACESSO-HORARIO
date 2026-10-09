-- Configure a profissional da Gi para usar site-gi-yasmin.
-- Antes: crie a conta dela em Authentication > Users.
-- Troque o e-mail abaixo pelo e-mail exato dessa conta e execute no SQL Editor.

do $$
declare
  v_email text := lower('GI_EMAIL@example.com');
  v_user_id uuid;
  v_professional_id uuid;
  v_plan_id uuid;
  v_role text;
  v_existing_name text;
  v_existing_specialty text;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = v_email;

  if v_user_id is null then
    raise exception 'Não encontrei esse e-mail em Authentication > Users.';
  end if;

  -- O trigger cria o perfil automaticamente. Esta linha também cobre usuários antigos.
  insert into public.profiles (id, email, role)
  values (v_user_id, v_email, 'profissional')
  on conflict (id) do nothing;

  select role into v_role
  from public.profiles
  where id = v_user_id;

  if v_role = 'administrador' then
    raise exception 'Use uma conta separada para a Gi; este e-mail tem perfil de administradora.';
  end if;

  select id, nome, especialidade
  into v_professional_id, v_existing_name, v_existing_specialty
  from public.professionals
  where user_id = v_user_id
  order by created_at
  limit 1;

  if v_professional_id is not null
    and lower(coalesce(v_existing_name, '')) not like 'gi%'
    and lower(coalesce(v_existing_specialty, '')) not like '%sobrancelh%'
    and lower(coalesce(v_existing_specialty, '')) not like '%cílios%'
    and lower(coalesce(v_existing_specialty, '')) not like '%cilios%' then
    raise exception 'Esse login já está ligado a outra profissional. Crie uma conta exclusiva para a Gi.';
  end if;

  if v_professional_id is null then
    insert into public.professionals (
      user_id, nome, email, especialidade, identidade_visual, status
    ) values (
      v_user_id,
      'Gi',
      v_email,
      'Design de sobrancelhas e cílios',
      '{"marca":"Studio Nosso Espaço","tema":"studio-noir","agenda":"site-gi-yasmin"}'::jsonb,
      'Ativo'
    ) returning id into v_professional_id;
  else
    update public.professionals
    set nome = 'Gi',
        email = v_email,
        especialidade = 'Design de sobrancelhas e cílios',
        identidade_visual = coalesce(identidade_visual, '{}'::jsonb)
          || '{"marca":"Studio Nosso Espaço","tema":"studio-noir","agenda":"site-gi-yasmin"}'::jsonb
    where id = v_professional_id;
  end if;

  select id into v_plan_id
  from public.plans
  where nome = 'Mensal Essencial'
  limit 1;

  if v_plan_id is null then
    raise exception 'Plano Mensal Essencial não encontrado. Execute primeiro supabase/schema.sql.';
  end if;

  insert into public.subscriptions (professional_id, plan_id, status, inicio, vencimento)
  select v_professional_id, v_plan_id, 'Ativo', current_date, current_date + 30
  where not exists (
    select 1 from public.subscriptions where professional_id = v_professional_id
  );

  insert into public.services (professional_id, nome, duracao_min)
  select v_professional_id, s.nome, s.duracao_min
  from (values
    ('Design de sobrancelhas', 45),
    ('Brow lamination', 75),
    ('Micropigmentação', 120),
    ('Extensão de cílios', 120),
    ('Lash lifting', 90),
    ('Manutenção de cílios', 90)
  ) as s(nome, duracao_min)
  where not exists (
    select 1 from public.services existing
    where existing.professional_id = v_professional_id
      and existing.nome = s.nome
  );
end $$;

-- Conferência: deve mostrar o perfil da Gi, o id da profissional e o slug da agenda.
select p.nome, p.email, p.especialidade, p.identidade_visual ->> 'agenda' as agenda
from public.professionals p
where lower(p.email) = lower('GI_EMAIL@example.com');
