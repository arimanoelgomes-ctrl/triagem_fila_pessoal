# Incidente — MCP `jira-atendimento__add_comment` não respeita `properties`

**Data:** 2026-05-25
**Severidade:** Alta (risco de exposição de comentário interno como público)
**Status:** Aberto — aguardando ajuste no MCP

## Identificação do componente

- **Pacote NPM:** `@betha/jira-mcp`
- **Registry:** `http://nexus3.betha.com.br/repository/npm-all/`
- **Forma de execução:** `npx -y --registry http://nexus3.betha.com.br/repository/npm-all/ @betha/jira-mcp`
- **Ferramenta afetada:** `add_comment` (assume `comment`, `explicitUserRequest`, e aparentemente aceita `properties` no schema mas não o repassa)

---

## Resumo

O MCP interno `jira-atendimento__add_comment` aceita o parâmetro `properties` no schema (não retorna erro de validação), mas **não o repassa para a API REST do Jira**. Como consequência, comentários que deveriam ser marcados como **Nota Interna** (`sd.public.comment` com `internal: true`) acabam sendo gravados como **comentários públicos** — visíveis ao cliente.

Este incidente foi identificado durante a primeira execução de validação do projeto **Triagem Automática da Fila de Arrecadação** (em 2026-05-25). O mesmo bug afeta este projeto (Triagem da Fila Pessoal), pois ambos usam o mesmo MCP.

---

## Reprodução

### 1. Payload esperado pela API do Jira (capturado via DevTools)

Endpoint: `POST https://atendimento.betha.com.br/rest/api/2/issue/{issueId}/comment`

```json
{
    "body": "teste interno",
    "properties": [
        {
            "key": "sd.public.comment",
            "value": {
                "internal": true
            }
        }
    ]
}
```

Quando enviado pela interface do Jira (botão de Nota Interna ativo, com classe CSS `js-sd-internal-comment active`), o comentário é gravado como **interno**.

### 2. Chamada via MCP equivalente

```
mcp__jira-atendimento__add_comment(
  issueKey: "BTHSC-318167",
  comment: "teste interno via MCP",
  explicitUserRequest: true,
  properties: [{"key": "sd.public.comment", "value": {"internal": true}}]
)
```

**Resultado:**
- O MCP retornou sucesso (`commentId`).
- Porém, ao inspecionar visualmente no Jira, o comentário ficou **público** (sem o destaque amarelado de nota interna).

### 3. Variações já testadas (todas falharam)

| Tentativa | Parâmetros | Resultado |
|-----------|------------|-----------|
| A | `body` + `properties` | Erro 400 — schema rejeitou `body` (esperava `comment`) |
| B | `comment` + `explicitUserRequest: true` + `internal: true` + `properties` | Erro 400 |
| C | `comment` + `explicitUserRequest: true` + `properties` | Sucesso (200), mas **comentário ficou público** |

---

## Diagnóstico

O parâmetro `properties` está documentado no schema do MCP (aceito sem erro), mas o wrapper **não o serializa no body do request HTTP** enviado ao Jira. Hipóteses:

1. **Bug de propagação:** o handler do `add_comment` ignora silenciosamente o campo `properties` antes de chamar a API.
2. **Conversão indevida:** o campo é convertido para uma estrutura que o Jira não reconhece (e a API silenciosamente descarta).
3. **Flag alternativa não exposta:** o MCP pode ter uma flag interna (`internal`, `isInternal`, `commentType`, `noteType`) que ainda não foi exposta no schema público.

---

## Solicitação ao time responsável pelo MCP

Pedimos uma das duas correções (em ordem de preferência):

1. **Repassar `properties` corretamente:** se o consumidor enviar `properties: [{key, value}]`, o MCP deve serializar esse array no body do POST `/rest/api/2/issue/{id}/comment` exatamente como recebido.

2. **OU expor flag de conveniência `internal: true`:** o MCP recebe `internal: true` e monta internamente o `properties: [{key: "sd.public.comment", value: {internal: true}}]` antes de chamar a API.

A opção 1 é mais geral (cobre outras properties no futuro); a opção 2 é mais idiomática para o caso de uso comum.

---

## Impacto operacional enquanto o MCP não é corrigido

- Todos os comentários da triagem automatizada são **gerados em arquivo Markdown** (`outputs/YYYY-MM-DD_comentarios_para_postar.md`).
- A postagem efetiva é feita pelo coordenador via `node scripts/post_comentarios.js`, que chama a API REST direta com o payload correto.
- O log diário (`logs/YYYY-MM-DD.md`) registra os comentários como "preparados" e indica se já foram postados.
- A postagem automática direta pelo MCP **fica suspensa** até o ajuste ser entregue e validado.

---

## Como validar o fix

Após o ajuste, executar este teste em um chamado controlado (ex.: novo chamado de teste, ou um já fechado):

```
mcp__jira-atendimento__add_comment(
  issueKey: "<chamado-teste>",
  comment: "teste de nota interna pós-fix",
  explicitUserRequest: true,
  properties: [{"key": "sd.public.comment", "value": {"internal": true}}]
)
```

**Critério de aceitação:** o comentário aparece no Jira com a marcação visual de nota interna (fundo amarelado, `js-sd-internal-comment active`) e **não dispara notificação ao cliente** no e-mail do reporter.

---

## Observação adicional (descoberta em paralelo)

Durante os testes, descobrimos uma limitação **separada** do servidor Jira da Betha: o body do comentário não pode conter caracteres Unicode fora do Basic Multilingual Plane (emojis modernos como 🤖, 🚀, ✅) — eles causam HTTP 500 silencioso, possivelmente porque o banco está com encoding restrito (latin1 ou versão antiga). O script `scripts/post_comentarios.js` já sanitiza esses caracteres antes do envio, e o template do CLAUDE.md instrui a triagem a não emitir emojis. Esta limitação é independente do bug do MCP descrito acima.
