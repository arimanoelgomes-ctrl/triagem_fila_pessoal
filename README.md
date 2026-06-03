# Triagem Automática da Fila de Pessoal

Projeto de automação para triagem avançada de chamados de suporte Nível 2/3 da vertical **Pessoal** (Departamento de Pessoal, RH, eSocial e Ponto) da Betha Sistemas.

A automação roda **duas vezes por dia útil** (07:45 e 15:10 BRT) usando um agente de IA (Claude) que:

1. Coleta a fila atual do Jira via JQL.
2. Filtra chamados já analisados (idempotência) e chamados em status encerrado.
3. Busca soluções aprovadas em chamados históricos.
4. Posta um comentário **interno** (visível só para suporte/implantação) com a sugestão técnica, citando os chamados históricos usados como base.
5. Envia um rascunho de email para o coordenador com o resumo da execução.

## Sumário

- [Produtos abrangidos](#produtos-abrangidos)
- [Regras críticas](#regras-críticas)
- [Pré-requisitos](#pré-requisitos)
- [Setup — passo a passo para um novo gestor](#setup--passo-a-passo-para-um-novo-gestor)
  - [1. Clonar o repositório](#1-clonar-o-repositório)
  - [2. Configurar Node.js e o `.env` dos scripts](#2-configurar-nodejs-e-o-env-dos-scripts)
  - [3. Instalar e logar no Cowork (Claude Desktop)](#3-instalar-e-logar-no-cowork-claude-desktop)
  - [4. Conectar os MCPs ao Cowork](#4-conectar-os-mcps-ao-cowork)
  - [5. Conectar a pasta do projeto no Cowork](#5-conectar-a-pasta-do-projeto-no-cowork)
  - [6. Customizar a JQL para sua carteira](#6-customizar-a-jql-para-sua-carteira)
  - [7. Criar os 2 agendamentos no Cowork](#7-criar-os-2-agendamentos-no-cowork)
  - [8. Configurar o auto-envio de email (Apps Script)](#8-configurar-o-auto-envio-de-email-apps-script)
  - [9. Primeira execução supervisionada](#9-primeira-execução-supervisionada)
- [Operação diária](#operação-diária)
- [Troubleshooting](#troubleshooting)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Repositório](#repositório)

## Produtos abrangidos

- **Folha Cloud** — processamento da folha de pagamento (rubricas, eventos, cálculo, fechamento, holerite, rescisões).
- **eSocial** — envios EFD-Reinf/eSocial (S-1000, S-1010, S-1020, S-1200, S-1210, S-2200, S-2206, S-2299, S-2300, S-2399, S-2400, S-3000, S-5001, S-5002, S-5003, S-5011, S-5012, S-5013, SST etc.), retornos do governo, fechamento mensal.
- **Minha Folha** — portal do colaborador.
- **Ponto (Cloud)** — marcação e apuração de jornada.
- **Pontual (Cloud)** — alternativa/sucessor do Ponto.
- **Recursos Humanos (Cloud)** — cadastro funcional, histórico, lotações, vínculos, afastamentos.

Vocabulário relevante: rubricas, eventos, lotação, vínculo, matrícula, eventos S-2200/S-2230/S-2299, fechamento, totalização, DCTFWeb, MIT, CAEPF, FAP, RAT, INSS, FGTS, IRRF, salário-base, salário-família, salário-maternidade, banco de horas, jornada, escala, RH protocolada, PPP, GFIP/SEFIP (legado).

## Regras críticas

- **Nunca** envia mensagens públicas ao cliente — apenas comentários internos (badge "Interno" no Jira).
- **Nunca** inventa soluções — todas devem vir de chamados históricos `Fechado/Resolvido` com solução **aprovada pelo cliente**.
- Leis, instruções normativas e regras específicas do eSocial podem ser buscadas externamente (CLT, INSS, IRRF, FGTS, leis municipais de servidores, IN do eSocial), mas sempre identificadas como tal na seção "Análise Complementar" do comentário.
- **Sem emojis** fora do BMP no corpo dos comentários (limitação de encoding do Jira da Betha — emojis modernos quebram a API com HTTP 500).
- **Idempotência reforçada:** chamados com a tag `[#IA-TRIAGEM-AUTOMATICA#]` são pulados; antes de cada postagem, a IA re-verifica via `get_issue` (proteção contra race condition entre execuções).
- **Detecção de execução duplicada:** se outra sessão da mesma tarefa estiver em andamento, a execução é abortada.

Detalhamento completo das regras de negócio: [`CLAUDE.md`](./CLAUDE.md).

## Pré-requisitos

Antes de começar, garanta que você tem:

- **Windows 10/11** (este guia usa caminhos Windows; Linux/macOS funcionam com ajustes mínimos).
- **Git** instalado — https://git-scm.com/download/win.
- **Node.js 18 ou superior** — https://nodejs.org. Verifique com `node --version`.
- **Cowork** (Claude Desktop com modo agente) instalado — https://claude.ai/download.
- **Conta Google corporativa** com Gmail (`@betha.com.br`) — para receber os rascunhos de resumo.
- **Acesso ao Jira da Betha** (`https://atendimento.betha.com.br`) com credenciais válidas.
- **Acesso aos MCPs internos da Betha** (`jira-atendimento` e `jira-desenv`) — peça ao time de plataforma se ainda não tiver.
- **(Opcional) Admin Key da organização Anthropic** (`sk-ant-admin01-...`) — só necessária se você quiser registrar o consumo de tokens diário. Sem ela, o script de auditoria de custo grava um placeholder sem quebrar nada.

## Setup — passo a passo para um novo gestor

### 1. Clonar o repositório

Abra o Prompt de Comando (`cmd`) e clone o projeto na pasta que preferir:

```cmd
mkdir C:\Scripts\ias\projetos_de_ia
cd C:\Scripts\ias\projetos_de_ia
git clone https://github.com/arimanoelgomes-ctrl/triagem_fila_pessoal.git
cd triagem_fila_pessoal
```

> **Alternativa:** se preferir manter sua própria cópia versionada, faça **fork** do repositório no GitHub primeiro e clone do seu fork. Assim você pode customizar a JQL (Passo 6) e commitar sem afetar o repo original.

### 2. Configurar Node.js e o `.env` dos scripts

Os scripts em `scripts/` são auxiliares: `post_comentarios.js` (fallback para postagem em lote) e `registrar_uso_tokens.js` (auditoria de custo).

```cmd
cd scripts
copy .env.example .env
notepad .env
```

Edite o `.env` com suas credenciais:

```
JIRA_BASE_URL=https://atendimento.betha.com.br
JIRA_USERNAME=seu.usuario.betha
JIRA_PASSWORD=sua_senha_ou_token

# Opcional — só se você for Owner da org Anthropic:
ANTHROPIC_ADMIN_API_KEY=sk-ant-admin01-...
```

> O `.env` está no `.gitignore`. Não commite credenciais.

Teste se o Node está OK:

```cmd
node --version
```

Tem que mostrar `v18.x.x` ou superior.

Detalhes adicionais sobre cada script: [`scripts/README.md`](./scripts/README.md).

### 3. Instalar e logar no Cowork (Claude Desktop)

1. Baixe e instale o Cowork (Claude Desktop) em https://claude.ai/download.
2. Faça login com sua conta `seu.usuario@betha.com.br` (ou a conta que terá os agendamentos).
3. Confirme que o plano da conta suporta agentes em background (Pro/Max ou superior). Se a opção "Scheduled" não aparece na barra lateral, verifique seu plano.

### 4. Conectar os MCPs ao Cowork

A IA precisa de dois MCPs para funcionar:

| MCP | Função |
|---|---|
| `jira-atendimento` | Listar fila, buscar histórico, postar comentários |
| `jira-desenv` | Buscar chamados de manutenção/desenvolvimento (precedentes técnicos) |

Estes são MCPs **internos da Betha** (pacote `@betha/jira-mcp`). Para configurá-los:

1. No Cowork, abra **Settings → Connectors → Add custom connector**.
2. Configure `jira-atendimento`:
   - **Name:** `jira-atendimento`
   - **Type:** stdio
   - **Command:** `npx`
   - **Args:** `-y --registry http://nexus3.betha.com.br/repository/npm-all/ @betha/jira-mcp`
   - **Env vars:** `JIRA_BASE_URL=https://atendimento.betha.com.br`, `JIRA_USERNAME=...`, `JIRA_PASSWORD=...`
3. Repita para `jira-desenv` apontando para `https://desenv.betha.com.br` (mesmas credenciais).
4. Conecte também o **Gmail** (já é um conector nativo do Cowork — `Settings → Connectors → Gmail`).
5. **(Opcional)** Conecte o **session_info** (também nativo) — usado pela detecção de execução duplicada.

> Se os comandos exatos estiverem desatualizados, peça ao time de plataforma da Betha a configuração corrente dos MCPs. O importante é que ao terminar o setup, em uma conversa com o Cowork, você consiga rodar `mcp__jira-atendimento__list_projects` e ver os projetos do Jira.

### 5. Conectar a pasta do projeto no Cowork

Os scheduled tasks precisam ler/escrever arquivos do projeto:

1. Abra uma conversa no Cowork.
2. Peça: `Conecta a pasta C:\Scripts\ias\projetos_de_ia\triagem_fila_pessoal para mim`.
3. O Cowork vai abrir um diálogo nativo do Windows; aprove o acesso à pasta.
4. Confirme que o agente consegue ler arquivos da pasta: `Lista os arquivos do CLAUDE.md`.

### 6. Customizar a JQL para sua carteira

A JQL em [`CLAUDE.md`](./CLAUDE.md) (Passo 1) filtra os municípios da carteira **original** do projeto. Se você atende outros municípios, edite a JQL substituindo a lista de `Município in (...)`.

Edite `CLAUDE.md`, encontre a seção **Passo 1: Coletar os chamados da Triagem** e ajuste:

- A lista de municípios.
- Se necessário, exclua/inclua filtros específicos da vertical Pessoal.

> **Importante:** mantenha o filtro `Vertical in (Pessoal)`, `issuetype = Dúvida` e `resolution = Unresolved`. A automação só faz sentido em chamados em aberto do tipo Dúvida da vertical Pessoal.

Comite a mudança no seu fork:

```cmd
git add CLAUDE.md
git commit -m "Customiza JQL para minha carteira de municípios"
git push
```

### 7. Criar os 2 agendamentos no Cowork

Em uma conversa com o Cowork, peça:

```
Crie dois agendamentos diários (dias úteis) para a triagem da fila de Pessoal.

Agendamento 1 — Manhã:
- Nome: triagem-fila-pessoal-diaria
- Cron: 45 7 * * 1-5  (07:45 BRT)
- Prompt: usar exatamente o conteúdo de scripts/scheduled-task-prompts/manha.md deste projeto

Agendamento 2 — Tarde:
- Nome: triagem-fila-pessoal-tarde
- Cron: 10 15 * * 1-5  (15:10 BRT)
- Prompt: usar exatamente o conteúdo de scripts/scheduled-task-prompts/tarde.md deste projeto
```

> **Por que 07:45 e 15:10?** Para não conflitar com a triagem de Arrecadação (07:30 e 15:00). Os MCPs do Jira respondem mais rápido quando não há execução paralela.

> **Atenção:** os prompts são longos e específicos. Se o Cowork pedir aprovação de tools durante a primeira execução, clique **Run now** manualmente em cada um para pré-aprovar `mcp__jira-atendimento__*`, `mcp__jira-desenv__*`, Gmail `create_draft` e `session_info__list_sessions`. Sem isso, as execuções automáticas vão pausar pedindo permissão.

Os prompts canônicos das duas tarefas estão versionados em [`scripts/scheduled-task-prompts/`](./scripts/scheduled-task-prompts/) — você pode pedir ao agente para criar os agendamentos lendo desses arquivos.

### 8. Configurar o auto-envio de email (Apps Script)

Por padrão, os agendamentos criam **rascunhos** no seu Gmail (limitação do conector). Para que sejam enviados automaticamente, instale o Apps Script de auto-envio:

1. Acesse https://script.google.com com sua conta Google.
2. **New project** → renomeie para `Auto-envio Triagem Drafts`.
3. Cole o conteúdo de [`scripts/auto-envio-gmail/auto_send_triagem_drafts.gs`](./scripts/auto-envio-gmail/auto_send_triagem_drafts.gs).
4. Execute manualmente `instalarTrigger` uma vez para criar o disparador (cada 5 min).
5. Pronto. Rascunhos cujo assunto começa com `[Triagem ` são enviados automaticamente.

Instruções detalhadas: [`scripts/auto-envio-gmail/instrucoes_apps_script.md`](./scripts/auto-envio-gmail/instrucoes_apps_script.md).

> **Apps Script compartilhado entre os dois projetos:** o mesmo Apps Script atende as 4 tarefas (Arrecadação manhã/tarde + Pessoal manhã/tarde) porque o filtro é por prefixo `[Triagem `. Se você já configurou para o projeto Arrecadação, não precisa configurar de novo aqui — apenas garanta que o prefixo `SUBJECT_PREFIX` esteja como `[Triagem ` (não específico de uma vertical).

> Se preferir revisar manualmente os emails antes de enviar, **não instale o Apps Script**. Você abre os rascunhos no Gmail Drafts e clica "Enviar".

### 9. Primeira execução supervisionada

Antes da primeira execução automática:

1. No Cowork, abra a aba **Scheduled** e clique em **Run now** na tarefa `triagem-fila-pessoal-diaria`.
2. Acompanhe a execução em tempo real. Ela vai:
   - Buscar a fila do dia.
   - Ler logs anteriores (se existirem).
   - Postar comentários internos via MCP.
   - Gerar `outputs/<DATA>_comentarios_para_postar.md` e `logs/<DATA>.md`.
   - Criar um rascunho de email para você.
3. Abra o Jira e confirme visualmente que **pelo menos um** comentário postado tem o badge **Interno** no canto direito.
4. Abra seu Gmail (Drafts) e confirme que o rascunho do resumo foi criado.

Se algo falhar, veja [Troubleshooting](#troubleshooting).

## Operação diária

Depois do setup, a operação é praticamente passiva:

- **07:45 BRT (seg–sex):** execução da manhã. Você recebe um email com o resumo (assunto: `[Triagem Pessoal - MANHA] ...`).
- **15:10 BRT (seg–sex):** execução da tarde. Você recebe outro email com o consolidado do dia (assunto: `[Triagem Pessoal - DIA] ...`).
- **Logs no repo:** `logs/<DATA>.md` é versionado no Git e serve como trilha de auditoria. Faça `git pull` periodicamente para sincronizar.
- **Outputs no repo:** `outputs/<DATA>_comentarios_para_postar.md` mostra exatamente o que foi postado. Se algum comentário falhou na postagem direta, este arquivo é a fonte para o reprocessamento via `node scripts/post_comentarios.js`.

### O que fazer quando bater algum email

1. Abrir o email do resumo.
2. Olhar a seção **Postados na tarde (commentId)** — esses são os chamados em que a IA já deixou orientação.
3. Acompanhar os analistas: eles podem usar o comentário interno como guia, ajustar para o cenário específico (regras locais do servidor, particularidades do eSocial do município, etc.) e responder o cliente.
4. Se algum comentário tiver **falha de postagem**, rodar:
   ```cmd
   cd C:\Scripts\ias\projetos_de_ia\triagem_fila_pessoal\scripts
   node post_comentarios.js
   ```
   O script é idempotente — não reposta o que já foi postado.

## Troubleshooting

### O scheduled task não rodou no horário previsto

- Verifique se o Cowork (Claude Desktop) está aberto e logado. Tarefas agendadas só disparam quando o app está aberto. Se ele estava fechado, a tarefa roda quando você reabrir.
- Se rodar pela primeira vez e pausar pedindo aprovação de tool, é normal. Aprove e na próxima execução vai rodar autônomo.

### Os comentários ficaram públicos (sem badge "Interno")

- Pare imediatamente. Use o MCP `mcp__jira-atendimento__delete_comment` (via Cowork) para remover os comentários.
- Confirme que o prompt do scheduled task chama `add_comment` com `internal: true` (essa é a regra crítica).
- Veja [`docs/incidente_mcp_add_comment.md`](./docs/incidente_mcp_add_comment.md) para o histórico do bug original (resolvido em 2026-06-01).

### "Não tem permissão para comentar esta pendência" (HTTP 400)

- O chamado foi **fechado/encerrado** entre a coleta e a postagem. Normal — o log registra como "Não postado (chamado encerrado)". Nada a fazer.

### Erro HTTP 500 ao postar

- Provavelmente um caractere Unicode fora do BMP (emoji moderno) no corpo. A IA é instruída a não usar, mas se acontecer: sanitize o body em `outputs/<DATA>_comentarios_para_postar.md` removendo o caractere e rode `node scripts/post_comentarios.js` manualmente.

### Email de resumo não chegou

- Os rascunhos são criados no Gmail Drafts. Confira lá primeiro.
- Se o Apps Script de auto-envio estiver configurado, verifique em https://script.google.com → seu projeto → **Execuções** se o trigger rodou.
- Se o trigger rodou e não enviou nada, o assunto do rascunho não casa com o prefixo `[Triagem `. Confira o prompt do scheduled task.

### A fila está vazia mas o email foi enviado mesmo assim

- Comportamento esperado. Auditoria precisa do registro diário, então o log e o email são gerados mesmo com fila zerada.

### Dois comentários idênticos no mesmo chamado

- Provável race condition entre a sessão da manhã e da tarde (ou entre duas instâncias simultâneas). A idempotência just-in-time foi desenhada para evitar — se mesmo assim acontecer, consulte o histórico do incidente análogo no projeto Arrecadação em `triagem_fila_arrecadacao/logs/2026-06-01.md`.

### O chamado é sobre eSocial mas a IA não trouxe precedente

- Verifique no log `logs/<DATA>.md` o motivo registrado em "Sem comentário". Casos comuns: descrição vaga, sem histórico aprovado pelo cliente, ou tema muito específico (regra local de servidor, IN nova do eSocial).
- Lembre-se que a IA é instruída a **não inventar soluções**. Se não tem precedente fechado/aprovado, ela passa.
- Considere enriquecer o histórico: quando o analista resolver um chamado complexo do eSocial e o cliente aprovar, o próximo caso similar terá precedente.

## Estrutura do projeto

```
triagem_fila_pessoal/
├── README.md                              # Este arquivo
├── CLAUDE.md                              # Instruções operacionais da IA (JQL, regras de negócio)
├── .gitignore
├── docs/                                  # Documentação complementar
│   ├── README.md
│   └── incidente_mcp_add_comment.md       # Histórico do bug do MCP (resolvido 01/06/2026)
├── logs/                                  # Logs diários (auditoria) — YYYY-MM-DD.md
│   └── README.md
├── outputs/                               # Comentários preparados — YYYY-MM-DD_comentarios_para_postar.md
└── scripts/
    ├── README.md
    ├── post_comentarios.js                # Fallback para postagem em lote via API REST
    ├── registrar_uso_tokens.js            # Auditoria de custo (Admin Usage API da Anthropic)
    ├── test_post.js                       # Smoke test
    ├── .env.example
    ├── scheduled-task-prompts/            # Prompts canônicos das tarefas agendadas
    │   ├── manha.md
    │   └── tarde.md
    └── auto-envio-gmail/                  # Apps Script para auto-envio dos rascunhos
        ├── auto_send_triagem_drafts.gs
        └── instrucoes_apps_script.md
```

## Repositório

https://github.com/arimanoelgomes-ctrl/triagem_fila_pessoal

Contribuições, correções e adaptações são bem-vindas via Pull Request. Se for fazer fork para customizar para sua carteira, considere também submeter melhorias estruturais de volta ao repo principal.
