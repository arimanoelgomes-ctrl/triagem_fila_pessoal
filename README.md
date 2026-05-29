# Triagem Automática da Fila de Pessoal

Projeto de automação para triagem avançada de chamados de suporte Nível 2/3 da vertical **Pessoal** (Departamento de Pessoal, RH, eSocial e Ponto) da Betha Sistemas.

## Objetivo

Analisar diariamente os chamados recém-abertos no Jira, buscar soluções já validadas na base de conhecimento (chamados históricos) e municiar a equipe de atendimento com sugestões de resolução através de comentários internos.

## Produtos abrangidos

- Folha Cloud
- eSocial
- Minha Folha
- Ponto (Cloud)
- Pontual (Cloud)
- Recursos Humanos (Cloud)

## Como funciona

O processo, executado diariamente, é dividido em seis passos:

1. **Coleta** — listagem dos chamados da fila de triagem via JQL.
2. **Filtros** — ignora chamados já analisados (tag `[#IA-TRIAGEM-AUTOMATICA#]`) e chamados em status encerrado.
3. **Análise e Busca** — pesquisa por soluções validadas em chamados históricos nos projetos `jira-atendimento` e `jira-desenv`. Prioriza chamados novos ou com mudança relevante de contexto.
4. **Geração** — produz `outputs/<DATA>_comentarios_para_postar.md` com os comentários candidatos.
5. **Log** — produz `logs/<DATA>.md` com a trilha de auditoria do dia.
6. **Auditoria de custo** — `scripts/registrar_uso_tokens.js` consulta a Admin Usage API da Anthropic para anexar o consumo medido ao log.

A postagem efetiva dos comentários como **Nota Interna** é feita pelo coordenador via `node scripts/post_comentarios.js` (workaround enquanto o bug do MCP `@betha/jira-mcp` não é corrigido — ver `docs/incidente_mcp_add_comment.md`).

> As regras detalhadas, a query JQL completa e o formato do comentário interno estão documentados em [`CLAUDE.md`](./CLAUDE.md).

## Regras críticas

- **Nunca** envia mensagens públicas ao cliente — apenas comentários internos.
- **Nunca** inventa soluções — todas devem vir de chamados históricos confirmados/aprovados.
- Leis, instruções normativas e regras de eSocial podem ser buscadas externamente, mas sempre identificadas como tal na seção "Análise Complementar".
- **Sem emojis** no corpo dos comentários (limitação de encoding do Jira da Betha).

## Repositório

https://github.com/arimanoelgomes-ctrl/triagem_fila_pessoal
