# ENTREGA — Agenda Josi + Supabase

## 1. Arquivos alterados / criados

**Preservados (identidade JM mantida):**
- `site-josi/index.html` — acréscimo de SDK Supabase, barra de sessão (`#sess-bar`), barra de sincronização (`#sync-bar`) e botão **Sair**. Nenhum estilo original removido.
- `site-josi/style.css` — acréscimo apenas de `.sess-bar`, `.sync-bar` e ajuste de `.topbar`. Paleta, cartões e calendário intactos.
- `site-josi/app.js` — **reescrito o armazenamento**: mesma lógica de calendário/slots/render, mas lendo e gravando em `appointments`/`clients`/`services` via Supabase. `localStorage` não é mais fonte de dados.
- `site-gi-yasmin/` — agenda mobile de sobrancelhas e cílios para Gi, compartilhando o backend Supabase com escopo pelo `professional_id`.

**Novos:**
- `supabase/schema.sql` — schema completo + RLS + seeds (rodar uma vez no SQL Editor).
- `js/config.js` — lê `SUPABASE_URL`/`SUPABASE_ANON_KEY` de `window.__SUPABASE_CONFIG__`, `js/config.json` ou `localStorage`; a tela de login não exibe os campos de configuração.
- `js/supabase-client.js` — `init()`, `loadContext()`, `accessBlocked()`, `signOutAndGoLogin()`.
- `login/index.html` — login real com `signInWithPassword`, roteamento por papel, configuração de conexão no aparelho.
- `admin/index.html` — painel completo (estatísticas, profissionais, assinaturas, usuários, planos).
- `index.html` — redireciona `/` → `/login/` (fluxo LOGIN → agenda/admin).
- `config.example.json` — modelo de configuração local.
- `.nojekyll` — deploy limpo no GitHub Pages.

## 2. Tabelas criadas

| Tabela | Papel |
|---|---|
| `profiles` | `id` (= auth.users.id), `email`, `role` (`profissional`/`administrador`) |
| `professionals` | `id`, `user_id`, `nome`, `email`, `especialidade`, `telefone`, `instagram`, `identidade_visual` (jsonb), `status` (Ativo/Vencido/Bloqueado/Suspenso) |
| `plans` | `id`, `nome`, `preco`, `descricao` |
| `subscriptions` | `id`, `professional_id` → professionals, `plan_id` → plans, `status`, `inicio`, `vencimento`, `observacoes` |
| `services` | `id`, `professional_id` → professionals, `nome`, `duracao_min`, `preco`, `ativo` |
| `clients` | `id`, `professional_id` → professionals, `nome`, `telefone`, `observacoes` |
| `appointments` | `id`, `professional_id` → professionals, `client_id` → clients, `cliente_nome`, `telefone`, `servico`, `service_id`, `data` (date), `horario` (time), `observacoes`; a migração adiciona `valor_cobrado` como snapshot e mantém a constraint de horário único |

Relacionamentos usam UUID + foreign keys. Seeds: 2 planos. Os procedimentos e o faturamento da Josi são atualizados pela migração `supabase/migrations/20261008_josi_billing.sql`.

## 3. Políticas RLS criadas

- `is_admin()` — lê `profiles` do `auth.uid()`, `security definer`.
- `my_professional_ids()` — profissionais do usuário logado.
- `handle_new_user()` + trigger em `auth.users` — cria `profiles` como `profissional` automaticamente.
- `profiles`: cada usuário lê o próprio perfil; somente admin pode atualizar perfis; clientes não podem inserir perfis diretamente (o trigger do Auth cria o perfil).
- `professionals`: admin tudo; dona lê o próprio e atualiza o próprio.
- `plans`: leitura para autenticados; escrita só admin.
- `subscriptions`: admin tudo; profissional lê a própria.
- `services`: leitura e escrita da própria profissional ou da administração após a migração de faturamento.
- `clients` / `appointments`: tudo restrito a dona ou admin.
- Autorização **no banco**, não só escondendo botão. Profissional não acessa dados de outra, não se promove, não vê painel admin.

## 4. Variáveis de ambiente necessárias

Nenhum segredo no código. Só **chave pública**:
- `SUPABASE_URL` — ex. `https://xyz.supabase.co`
- `SUPABASE_ANON_KEY` — chave `anon` pública

Como o aplicativo lê a configuração (nesta ordem de prioridade):
1. `window.__SUPABASE_CONFIG__ = { url, anonKey }` (inline, via build);
2. `js/config.json` — cópia local de `config.example.json` (**não commitar**);
3. `localStorage` existente (`agenda-josi:config`) neste aparelho.

Não há formulário público de configuração no login. Em novos aparelhos, a configuração deve ser distribuída pelo deploy ou pelo arquivo local apropriado.

**Nunca** usar `service_role` no frontend.

## 5. Como criar o primeiro administrador

1. Rode `supabase/schema.sql` no SQL Editor. Para um projeto que já foi configurado com a versão anterior, rode também `supabase/hardening.sql`.
2. Em **Authentication > Users > Add user**, crie `admin@exemplo.com` com senha.
3. No SQL Editor (como postgres), promova o perfil criado automaticamente pelo trigger:
```sql
update public.profiles p
set role = 'administrador'
from auth.users u
where p.id = u.id and u.email = 'admin@exemplo.com';
```
4. Entre em `/login/` com esse e-mail → cai direto em `/admin/`.

## 6. Como cadastrar a Josi

1. Crie o login dela em **Authentication > Users** (ex. `josi@exemplo.com`).
2. Vincule esse usuário a `public.professionals` e crie a assinatura dele, conforme o exemplo de `supabase/schema.sql`.
3. Execute `supabase/migrations/20261008_josi_billing.sql` no SQL Editor. A migração cadastra e atualiza os dez procedimentos reais, aplica a política RLS por profissional e registra o preço histórico de novos agendamentos.
4. Agendamentos já existentes recebem `valor_cobrado = 0`, pois o banco não tinha o preço histórico e não deve estimá-lo pelo preço atual.
5. Login como Josi em `/login/` → abre `/site-josi/` com nome, serviços, agenda e faturamento sincronizados.

## 7. Como cadastrar uma segunda profissional

Opção A (pelo painel): entre como admin → **Cadastrar profissional** (ex. nome + `sobrancelhas`) → cria profissional + assinatura de 30 dias + 3 serviços padrão. Depois crie o login dela em **Authentication > Users** e vincule em **Usuários e permissões** (botão Salvar com a profissional selecionada).

Opção B (SQL): para uma profissional que use a mesma agenda da Josi, vincule seu login ao registro em `professionals`. Para a agenda separada da Gi, siga a seção abaixo e use `supabase/gi-setup.sql`.

## Agenda separada da Gi

- A página mobile da Gi fica em `site-gi-yasmin/` e usa as mesmas tabelas `professionals`, `services`, `clients` e `appointments`.
- Crie o usuário em **Authentication > Users** e depois execute `supabase/gi-setup.sql` com o e-mail dela. O script vincula o profissional à agenda `site-gi-yasmin` e cria serviços iniciais de sobrancelhas e cílios.
- O login consulta `professionals.identidade_visual.agenda` para encaminhar cada profissional à página certa. Josi continua em `site-josi/` como rota padrão.

## 8. Como publicar no GitHub Pages

Projeto 100% estático, sem build:
1. Suba a pasta no repositório (branch `main`).
2. **Settings > Pages > Deploy from a branch** → `main` / `/ (root)`.
3. Aguarde o deploy e acesse `https://<usuario>.github.io/<repo>/login/`.
4. Em cada aparelho, abra `/login/` uma vez e salve a conexão (ou sirva `js/config.json` via secret de build).
5. Frontend continua estático; Supabase é o backend (Auth + banco). Nada de backend no Pages.

## 9. Como testar em dois celulares

1. Nos dois, abra `/login/`, configure a conexão e entre como **Josi**.
2. Celular A: **Agendar cliente** → preencha e salve (ex. 14:00).
3. Celular B: o horário aparece ocupado **na hora** (Realtime) ou ao trocar de mês/dia (recarrega do banco).
4. Teste de bloqueio: no admin, mude a Josi para **Vencido** e salve → a agenda dela entra em modo leitura nos dois aparelhos com a mensagem de renovação. Volte para **Ativo** para liberar.
5. Checklist final: login ✓ · logout ✓ · profissional ✓ · admin negado para profissional ✓ · criar cliente ✓ · criar agendamento ✓ · leitura no 2º aparelho ✓ · bloqueio de vencida ✓ · mobile sem rolagem horizontal ✓ (layout original preservado, botões ≥44px).

## Backup

Antes da migração, o original foi preservado: os arquivos `index.html`/`style.css`/`app.js` da agenda vieram do deploy `https://aleff26042110.github.io/1-primera-cliente-josi-2026/`. Para reverter a agenda ao `localStorage`, basta restaurar o `app.js` anterior (chave `josi-maria-agenda-v1`). Nenhuma funcionalidade foi apagada sem substituto: calendário,Slots 09:00–18:00, limpar mês, remover e mensagens estão todos mantidos, agora contra o banco.
