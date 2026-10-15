# Agenda Josi

Agenda web com um painel privado para a profissional e uma página pública de reservas. Os dois fluxos usam o mesmo projeto Supabase e a mesma tabela `appointments`.

## Rotas

- `./login/` — login da equipe.
- `./site-josi/` — painel privado. A página exige uma sessão Supabase válida e os dados continuam protegidos por RLS.
- `./agendar/` — agendamento público da Josi; não exige cadastro nem login.
- `./agendar/?profissional=slug` — caminho para selecionar outra profissional quando ela receber um `public_slug` próprio.
- `./site-gi-yasmin/` — agenda existente da Gi, preservada no mesmo projeto.

Em GitHub Pages de um repositório, os endereços ficam sob o caminho do repositório, por exemplo `https://usuario.github.io/repositorio/agendar/`.

## Configurar o Supabase

1. No painel Supabase, use o projeto que já contém as contas e os dados atuais. Não crie outro banco.
2. Para uma instalação nova, execute `supabase/schema.sql` no SQL Editor. Em um banco já em uso, não reaplique o schema completo: aplique somente as migrações que ainda faltam.
3. Confira se a migração de faturamento `supabase/migrations/20261008_josi_billing.sql` já foi executada. Se ainda não, execute-a antes da migração pública.
4. Execute `supabase/migrations/20261008_public_booking.sql` no SQL Editor. Ela adiciona o expediente, bloqueios, duração dos atendimentos e RPCs de agendamento. É incremental e não apaga agendamentos.
5. Execute também `supabase/migrations/20261008_whatsapp_confirmation.sql` para habilitar a confirmação pelo WhatsApp.
6. Execute `supabase/migrations/20261008_whatsapp_josi_phone.sql` para gravar o número de WhatsApp informado para a Josi. Ela pode alterá-lo depois no painel privado.
7. Execute `supabase/migrations/20261015_josi_hours_services.sql` para atualizar somente a Josi: expediente das 08:00 às 18:00, intervalo e duração dos procedimentos de 150 minutos e os cinco procedimentos/valores solicitados. Mantém dias ativos, pausas, folgas e agendamentos anteriores. Pode ser executada novamente sem inserir novos registros dos mesmos procedimentos.
8. Em **Project Settings → API**, copie a URL do projeto e a chave pública `anon`/publishable. Nunca use `service_role` no navegador, nos arquivos do site ou neste README.

As RPCs públicas retornam somente nome/identidade pública, o WhatsApp escolhido para reservas, procedimentos ativos e horários livres. A cliente não recebe acesso direto às tabelas de clientes, agendamentos, faturamento ou assinaturas. O painel da Josi continua fazendo operações autenticadas sob RLS. A reserva anônima reutiliza o registro de cliente correspondente ao telefone, quando existe, sem sobrescrever os dados de contato já cadastrados.

## Configuração local

O arquivo `js/config.json` é local e ignorado pelo Git. Crie-o a partir de `config.example.json` e preencha:

```json
{
  "url": "https://SEU-PROJETO.supabase.co",
  "anonKey": "SUA_CHAVE_PUBLICA_ANON"
}
```

Sirva a pasta por um servidor local (por exemplo, `python -m http.server 8000`) e abra `http://localhost:8000/login/`. O arquivo não funciona de forma confiável ao abrir `index.html` diretamente com `file://`.

A chave `anon`/publishable é enviada ao navegador e deve ser tratada como pública; RLS e as permissões das RPCs protegem os dados. Não coloque senha de usuário ou `service_role` neste arquivo.

## Usuária e profissional

Crie ou mantenha a conta da Josi em **Authentication → Users**, vinculada à linha de `public.professionals.user_id`. O gatilho de autenticação cria o profile. O cadastro/vínculo da profissional e a atribuição de papel administrador devem ser feitos no SQL Editor por uma pessoa administradora, nunca pelo formulário público.

Para publicar a agenda, a migração configura o slug `josi` quando identifica uma única profissional Josi. Confira no SQL Editor:

```sql
select id, nome, public_slug, timezone_name, status
from public.professionals
order by nome;
```

O status da profissional e a assinatura mais recente precisam estar ativos para aceitar reservas públicas. Ajuste `timezone_name` no banco se a profissional trabalhar em outro fuso.

## Procedimentos, horários e folgas

- Cadastre/edite procedimentos na área administrativa existente; somente procedimentos ativos com preço e duração válidos aparecem para a cliente.
- No painel da Josi, abra **Disponibilidade → Configurar expediente semanal**. Para cada dia, marque se atende e configure abertura, fechamento, intervalo entre inícios de atendimento e, opcionalmente, uma pausa.
- Após a migração de 15/10/2026, o expediente da Josi é das 08:00 às 18:00, em blocos de 2h30: 08:00, 10:30, 13:00 e 15:30. Os dias atendidos e as pausas existentes são mantidos; dias sem configuração começam com segunda a sábado ativos e domingo inativo. Reservas, pausas e folgas podem reduzir os horários disponíveis.
- O catálogo acrescenta ou atualiza Banho de gel (R$ 120), Blindagem (R$ 80), Pé e mão (R$ 60), Só mão (R$ 35) e Só pé (R$ 40). Os procedimentos ativos passam a ter duração de 150 minutos para novas reservas, mantendo os valores dos demais serviços e o histórico dos atendimentos.
- Em **Datas bloqueadas**, registre folgas ou dias sem atendimento. É possível remover um bloqueio pelo próprio painel.
- Em **Confirmação pelo WhatsApp**, salve o número público da Josi. Quando uma reserva for criada, a cliente será encaminhada ao WhatsApp com nome, telefone, procedimento, preço, data, horário e observações preenchidos; ela ainda precisa tocar em **Enviar**.
- A disponibilidade respeita a duração do procedimento, o expediente, a pausa, as reservas já existentes e os bloqueios. O banco serializa as tentativas e rejeita sobreposição mesmo se duas clientes confirmarem quase ao mesmo tempo.

## Publicar no GitHub Pages

1. Envie este repositório para o GitHub.
2. Em **Settings → Secrets and variables → Actions**, crie os secrets `SUPABASE_URL` e `SUPABASE_ANON_KEY` com a URL do projeto e a chave pública.
3. Em **Settings → Pages**, selecione **GitHub Actions** como origem.
4. Envie uma alteração para `main` ou `master`, ou execute o workflow **Publicar agenda no GitHub Pages** em **Actions**.
5. Após a publicação, teste primeiro `.../login/`, depois entre no painel e abra `.../agendar/` em uma janela privada.

O workflow publica somente os arquivos do site e gera `js/config.json` durante o build. Não publica o `config.json` local nem arquivos `.env`.

## Verificações locais

Com Node.js instalado, execute:

```sh
node --test tests/billing-logic.test.mjs tests/public-booking.test.mjs
node --check site-josi/app.js
node --check agendar/app.js
node --check js/booking-logic.js
```

Depois da migração, faça uma verificação manual no Supabase: abra a página pública sem login, reserve um horário de teste e confirme que ele aparece no painel autenticado. Teste também um segundo envio para o mesmo horário; deve ser recusado com uma mensagem amigável. Não use dados reais de clientes para testes públicos.

## Limites desta publicação

O GitHub Pages hospeda arquivos estáticos; não armazena segredos de servidor nem executa código backend próprio. A chave pública do Supabase aparece no navegador por definição. Operações privilegiadas ficam no banco, dentro das RPCs `SECURITY DEFINER` com permissões explícitas e validações.
