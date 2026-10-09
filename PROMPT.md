# PROMPT — REESTRUTURAÇÃO DA AGENDA JOSI + SUPABASE

## Objetivo

Transformar o projeto atual da agenda da Josi em uma aplicação multi-profissional, mantendo a identidade visual e as funcionalidades existentes, mas adicionando autenticação, banco de dados compartilhado e uma área administrativa preparada para assinaturas.

O projeto publicado atualmente é:
https://aleff26042110.github.io/1-primera-cliente-josi-2026/

O site atual apresenta a identidade "JM NAIL DESIGNER / Josi Maria" e possui agenda mensal, cadastro de cliente, serviço, data, horário, telefone e observações. PRESERVE a experiência e a identidade visual já existentes.

## REGRA PRINCIPAL

Não recrie o projeto do zero.

1. Primeiro analise todo o código existente em `site-josi/` e identifique:
   - estrutura HTML/CSS/JS;
   - onde os agendamentos são salvos;
   - como clientes e horários são carregados;
   - dependências;
   - responsividade;
   - componentes e estilos existentes.
2. Preserve a interface e o funcionamento atual sempre que possível.
3. Faça mudanças incrementais.
4. Não apague funcionalidades existentes sem justificativa.
5. O resultado precisa continuar funcionando em celular.

## ARQUITETURA DESEJADA

Fluxo:

LOGIN
  ↓
Supabase Auth
  ↓
identificação do usuário e papel
  ├── profissional → agenda
  └── administrador → painel administrativo

O GitHub Pages continua sendo usado para hospedar o frontend estático.

O Supabase será responsável por:
- autenticação;
- banco de dados;
- dados compartilhados entre celulares;
- autorização/permissões;
- futura integração com assinaturas.

## LOGIN

Criar uma tela de login moderna, elegante e mobile-first.

Existe uma referência visual em `login/index.html`.
Use-a como inspiração, mas adapte o design ao estilo da agenda Josi.

O login deve futuramente usar Supabase Auth.

Campos:
- e-mail;
- senha;
- botão Entrar.

Não implementar autenticação falsa no resultado final.

Não deixar senha ou segredo administrativo no frontend.

## PROFISSIONAIS

O sistema deve suportar múltiplas profissionais.

Exemplo inicial:
- Josi Maria — alongamento/design de unhas;
- futura profissional de sobrancelhas.

Cada profissional deve poder ter:
- nome;
- e-mail/login;
- serviços;
- identidade visual/configurações;
- status da conta;
- plano;
- data de vencimento.

A interface pode mudar conforme a profissional autenticada, sem duplicar todo o projeto.

## AGENDA

Os dados precisam sair do armazenamento local do navegador e passar para o Supabase.

Agendamento deve permitir pelo menos:
- cliente;
- telefone;
- serviço;
- profissional;
- data;
- horário;
- observações;
- timestamps de criação/alteração.

A agenda deve ser sincronizada entre celulares.

Se Josi cadastrar uma cliente/agendamento em um celular, outro dispositivo autorizado deve conseguir consultar os dados.

## SEGURANÇA

Usar autenticação real do Supabase.

Implementar Row Level Security (RLS) e políticas adequadas.

Um usuário comum NÃO pode:
- acessar dados administrativos;
- alterar permissões;
- tornar-se administrador;
- visualizar dados que não deveria acessar.

A autorização não pode depender apenas de esconder botões no frontend.

## PAINEL ADMINISTRATIVO

Criar uma área administrativa separada.

O administrador deve poder visualizar/controlar:
- profissionais;
- usuários;
- planos;
- assinaturas;
- data de vencimento;
- status da conta;
- bloqueio/desbloqueio;
- quantidade de profissionais;
- quantidade de clientes;
- quantidade de agendamentos;
- estatísticas básicas.

Exemplo de status:
- Ativo;
- Vencido;
- Bloqueado;
- Suspenso.

O administrador deve conseguir alterar o vencimento e o status.

## ASSINATURAS

A primeira versão NÃO precisa ter pagamento automático.

Preparar o banco para assinatura manual:
- plano;
- status;
- início;
- vencimento;
- observações.

Quando uma assinatura estiver vencida, a aplicação deve impedir o acesso à área da agenda conforme a regra definida.

Deixar a arquitetura preparada para futura integração com gateway de pagamento.

## BANCO DE DADOS

Criar uma estrutura clara no Supabase, por exemplo:

profiles
professionals
services
clients
appointments
plans
subscriptions

Relacionamentos devem usar IDs e foreign keys.

Evitar duplicação desnecessária.

## EXPERIÊNCIA MOBILE

Prioridade máxima para celular.

Garantir:
- layout responsivo;
- botões grandes o suficiente;
- inputs confortáveis;
- agenda utilizável com uma mão;
- nenhuma rolagem horizontal;
- textos legíveis;
- navegação simples.

## IDIOMA

Toda a interface do usuário deve ficar em PORTUGUÊS DO BRASIL.

Não deixar botões como:
- Login
- Submit
- Cancel
- Save

quando houver equivalente adequado em português.

Preferir:
- Entrar;
- Salvar;
- Cancelar;
- Sair;
- Editar;
- Bloquear;
- Desbloquear.

## SUPABASE

Não invente credenciais.

Não coloque chaves privadas no código.

Usar variáveis/configuração apropriada para:
- SUPABASE_URL;
- SUPABASE_ANON_KEY.

A chave pública do frontend pode ser usada conforme a arquitetura do Supabase, mas nunca expor service_role key.

## DEPLOY

O projeto continuará preparado para GitHub Pages.

Se o projeto precisar de build, configurar corretamente o processo de build/deploy.

Não assumir que GitHub Pages executa backend.

## COMPATIBILIDADE

Antes de finalizar:
- testar login;
- testar logout;
- testar acesso de profissional;
- testar acesso de administrador;
- testar criação de cliente;
- testar criação de agendamento;
- testar leitura em outro dispositivo;
- testar bloqueio de usuário vencido;
- testar responsividade mobile.

## IMPORTANTE

Não substitua a identidade da Josi por um template genérico.

A referência atual deve continuar reconhecível.

Primeiro faça a versão da Josi funcionar corretamente com Supabase.

Depois deixe a arquitetura preparada para cadastrar a segunda profissional.

Não crie uma página HTML para cada cliente.

Cliente é registro no banco.

Profissional é registro no banco.

Agendamento é registro no banco.

O painel administrativo controla o sistema.

## ENTREGA

Ao concluir, documente:
1. arquivos alterados;
2. tabelas criadas;
3. políticas RLS criadas;
4. variáveis de ambiente necessárias;
5. como criar o primeiro administrador;
6. como cadastrar a Josi;
7. como cadastrar uma segunda profissional;
8. como publicar no GitHub Pages;
9. como testar em dois celulares.

Antes de executar mudanças destrutivas, faça backup ou preserve a versão atual.
