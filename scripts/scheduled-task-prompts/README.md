# Prompts canônicos das tarefas agendadas

Este diretório guarda os prompts versionados das duas tarefas agendadas no Cowork (Claude Desktop) para a triagem de Pessoal/eSocial:

- [`manha.md`](./manha.md) — prompt da execução da manhã (07:45 BRT, seg–sex)
- [`tarde.md`](./tarde.md) — prompt da execução da tarde (15:10 BRT, seg–sex)

## Por que versionar os prompts aqui?

Os prompts ficam armazenados pelo Cowork em `C:\Users\<usuario>\Documents\Claude\Scheduled\<task-id>\SKILL.md`. Esse local **não é versionado no Git** do projeto e fica sujeito a edições acidentais via UI do Cowork. Manter uma cópia canônica aqui resolve isso:

- **Onboarding:** novo gestor clona o repo e pede ao Cowork para criar os agendamentos lendo desses arquivos.
- **Auditoria:** se alguém alterar o prompt no Cowork e algo quebrar, dá pra comparar com a versão deste diretório.
- **Histórico:** mudanças no prompt ficam rastreáveis no `git log`.

## Como criar os agendamentos a partir destes prompts

Em uma conversa no Cowork:

```
Crie dois agendamentos diários (dias úteis) para a triagem da fila de Pessoal.

Agendamento 1 — Manhã:
- taskId: triagem-fila-pessoal-diaria
- cronExpression: 45 7 * * 1-5
- description: Triagem diaria da fila de Pessoal/eSocial (07:45 BRT) - publica comentarios internos automaticamente via MCP.
- prompt: usar o conteúdo de scripts/scheduled-task-prompts/manha.md (ler e usar literal)

Agendamento 2 — Tarde:
- taskId: triagem-fila-pessoal-tarde
- cronExpression: 10 15 * * 1-5
- description: Triagem da tarde da fila de Pessoal/eSocial (15:10 BRT) - publica comentarios internos e envia rascunho de resumo por email.
- prompt: usar o conteúdo de scripts/scheduled-task-prompts/tarde.md (ler e usar literal)
```

O Cowork vai chamar `mcp__scheduled-tasks__create_scheduled_task` para cada um, com `notifyOnCompletion: false`.

## Por que 07:45 e 15:10 (e não 07:30/15:00)?

Para não conflitar com a triagem de Arrecadação (que roda 07:30 e 15:00). Os MCPs do Jira respondem mais rápido quando não há execução paralela. 15 minutos de defasagem é margem segura para a triagem de Arrecadação terminar antes da de Pessoal começar.

## Como atualizar o prompt depois

Se você alterar um prompt aqui no repo e quiser sincronizar com o Cowork, peça em uma conversa:

```
Atualize o prompt do scheduled task triagem-fila-pessoal-diaria com o conteúdo atualizado de scripts/scheduled-task-prompts/manha.md.
```

O Cowork vai chamar `mcp__scheduled-tasks__update_scheduled_task` com o novo prompt.

## Quando sincronizar inversamente (do Cowork para o repo)

Se você alterar o prompt direto na UI do Cowork (não recomendado, mas pode acontecer), atualize o arquivo aqui correspondente para manter as duas cópias em sincronia. A fonte da verdade ideal é este diretório versionado.
