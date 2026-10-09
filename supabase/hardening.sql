-- Reforce as políticas de profiles no projeto Supabase já configurado.
-- Execute uma vez no SQL Editor depois de publicar a atualização do app.
-- Não remove dados nem usuários.

drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Clientes anônimas usam apenas as RPCs públicas da migração de agendamento.
-- A chave anon não recebe leitura direta de dados pessoais ou financeiros.
revoke all on public.profiles, public.professionals, public.plans,
  public.subscriptions, public.services, public.clients, public.appointments
  from public, anon;
