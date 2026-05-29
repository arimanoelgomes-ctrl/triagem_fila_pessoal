# Scripts auxiliares

## `post_comentarios.js`

Workaround para postar os comentários da triagem como **Nota Interna** no Jira da Betha enquanto o bug no MCP `@betha/jira-mcp` (documentado em [`docs/incidente_mcp_add_comment.md`](../docs/incidente_mcp_add_comment.md)) não é corrigido.

O script chama diretamente a API REST do Jira (`POST /rest/api/2/issue/{key}/comment`) com o payload correto:

```json
{
    "body": "...",
    "properties": [
        { "key": "sd.public.comment", "value": { "internal": true } }
    ]
}
```

### Requisitos

- **Node.js 18 ou superior** (usa `fetch` nativo — sem dependências externas).
- Credenciais do Jira (mesmas usadas pelo MCP, ou suas pessoais).

Verifique a versão do Node:

```cmd
node --version
```

Se for inferior a 18, atualize antes de continuar.

### Setup (primeira vez)

1. Entre no diretório:

   ```cmd
   cd C:\Scripts\ias\projetos_de_ia\triagem_fila_pessoal\scripts
   ```

2. Crie o `.env` a partir do template:

   ```cmd
   copy .env.example .env
   ```

3. Abra `scripts\.env` num editor e preencha:

   ```
   JIRA_BASE_URL=https://atendimento.betha.com.br
   JIRA_USERNAME=seu_usuario
   JIRA_PASSWORD=sua_senha_ou_token
   ```

   > **Importante:** `scripts/.env` está no `.gitignore` do projeto — nunca será commitado.

### Uso

#### Listar arquivos de comentários disponíveis

```cmd
node post_comentarios.js --list
```

Mostra os `outputs/*_comentarios_para_postar.md` existentes.

#### Dry-run (não posta — apenas mostra o que seria postado)

```cmd
node post_comentarios.js --dry-run
```

Por padrão pega o arquivo mais recente em `outputs/`. Para apontar para um arquivo específico:

```cmd
node post_comentarios.js --dry-run --file ../outputs/2026-05-29_comentarios_para_postar.md
```

#### Postar de verdade

```cmd
node post_comentarios.js
```

O script vai:

1. Listar os comentários candidatos.
2. **Pedir confirmação interativa** (`s/N`).
3. Para cada comentário:
   - Verificar idempotência (se já existe comentário com `[#IA-TRIAGEM-AUTOMATICA#]` no chamado, **ignora**).
   - Verificar status (se estiver em `Fechado`, `Encerrado`, etc., **ignora**).
   - Postar como **Nota Interna**.
4. Mostrar resumo final com totais (postados / ignorados / erros).

Para pular a confirmação interativa (uso em scripts):

```cmd
node post_comentarios.js --yes
```

### Saída esperada

```
📄 Arquivo:  C:\...\outputs\2026-05-29_comentarios_para_postar.md
🌐 Jira:     https://atendimento.betha.com.br
🧪 Modo:     POSTAGEM REAL

Encontrados 3 comentário(s) candidato(s):
  1. BTHSC-XXXXX  →  [#IA-TRIAGEM-AUTOMATICA#] | **Triagem Automática de Soluções**...
  2. BTHSC-YYYYY  →  ...
  3. BTHSC-ZZZZZ  →  ...

Confirma postagem dos 3 comentários como NOTA INTERNA? [s/N]: s
• BTHSC-XXXXX: OK — comentário 14237750 postado como INTERNO.
• BTHSC-YYYYY: OK — comentário 14237751 postado como INTERNO.
• BTHSC-ZZZZZ: OK — comentário 14237752 postado como INTERNO.

─────────────────────────────────────────────
Postados: 3   Ignorados: 0   Erros: 0
─────────────────────────────────────────────
```

### Validação pós-postagem

**Sempre** confirme visualmente no Jira que pelo menos um dos comentários ficou com o destaque amarelado de Nota Interna (classe CSS `js-sd-internal-comment active`). Se algo der errado, os comentários podem ser removidos via API ou interface.

### Quando descartar este script

Após o fix oficial do MCP `@betha/jira-mcp` ser entregue e validado (ver critério de aceitação em [`docs/incidente_mcp_add_comment.md`](../docs/incidente_mcp_add_comment.md)), este script pode ser arquivado ou removido — a triagem automatizada voltará a postar diretamente via MCP.

---

## `registrar_uso_tokens.js`

Consulta a **Admin Usage API** da Anthropic e grava o consumo de tokens do dia em `logs/YYYY-MM-DD-usage.json`, além de injetar um bloco `## Consumo de tokens (Admin API)` no fim do `logs/YYYY-MM-DD.md` correspondente. Fecha o ciclo de auditoria diária da triagem com o custo medido pela fonte oficial — sem depender da IA reportar tokens em runtime (a Cowork não expõe esse contador).

### Requisitos

- Node.js 18+ (mesma stack do `post_comentarios.js`).
- **Admin Key** da organização Anthropic — chave do tipo `sk-ant-admin01-...`, gerada em `console.anthropic.com → Settings → Admin Keys` por um Owner. Chaves de API normais (`sk-ant-api03-...`) **NÃO** servem; a Usage API só aceita Admin Key.
- Variável `ANTHROPIC_ADMIN_API_KEY` no `scripts/.env`.

Sem a Admin Key, o script grava um **placeholder JSON** com instruções e sai com código 0 — útil para registrar que a execução tentou, e permitir preenchimento manual posterior pelo painel da Console.

### Uso

```cmd
node registrar_uso_tokens.js                    :: hoje (BRT)
node registrar_uso_tokens.js --date 2026-05-27  :: dia específico
node registrar_uso_tokens.js --no-inject        :: só grava JSON, não toca no .md
node registrar_uso_tokens.js --workspace-id ws_XXX  :: filtra por workspace (se houver)
```

A janela consultada é sempre **00:00 a 24:00 BRT** (UTC-3). O script converte para UTC internamente antes de chamar a API.

### Saída

- `logs/YYYY-MM-DD-usage.json` — contém `total`, `por_modelo` e `payload_bruto` (para auditoria caso a estrutura da API mude). Versionado no Git.
- `logs/YYYY-MM-DD.md` — recebe ao final um bloco `## Consumo de tokens (Admin API)` com tabela markdown. Idempotente: ao reexecutar, o bloco existente é **substituído** (não duplica).

### Quando executar

Depois de `post_comentarios.js`, idealmente no mesmo agendamento diário. O dia BRT precisa ter terminado para que a Admin API retorne o total final — agendar para algo entre **02:00 e 04:00 BRT do dia seguinte** dá margem segura.

Cron exemplo (Linux/macOS):
```cron
45 7  * * 1-5  cd /caminho/triagem_fila_pessoal && claude run triagem-fila-pessoal-diaria
30 3  * * 2-6  cd /caminho/triagem_fila_pessoal/scripts && node registrar_uso_tokens.js --date $(date -d "yesterday" +%Y-%m-%d)
```

### Tabela de preços

A estimativa de custo USD é calculada localmente pela tabela `PRECOS_USD_POR_MTK` no topo do script (Opus, Sonnet, Haiku). Quando a Anthropic ajustar a tabela oficial, atualize as constantes. Para o custo definitivo, consulte o **Cost Report** da Console (endpoint distinto da Usage API, requer agregação diferente).
