# Logs de Execução da Triagem Automática

Esta pasta armazena o histórico diário de execução da triagem. Cada execução gera um arquivo Markdown no formato `YYYY-MM-DD.md`.

## Finalidade

- **Auditoria** — rastrear o que foi analisado, ignorado ou comentado em cada dia.
- **Qualidade** — permitir revisão amostral pelo coordenador de portfólio.
- **Diagnóstico** — investigar comportamentos inesperados da IA (falsos negativos, comentários incorretos etc.).

## Nomenclatura

- `logs/YYYY-MM-DD.md` — log textual do dia (versionado).
- `logs/YYYY-MM-DD-usage.json` — consumo de tokens medido pela Admin API (versionado, gerado por `scripts/registrar_uso_tokens.js`).

## Formato do log

Cada arquivo deve seguir o template abaixo:

```markdown
# Triagem Automática — YYYY-MM-DD

**Início da execução:** HH:MM (BRT)
**Fim da execução:** HH:MM (BRT)
**Total de chamados retornados pela JQL:** N
**Ignorados (já analisados):** N
**Ignorados (status encerrado):** N
**Analisados nesta execução:** N
**Comentários preparados:** N
**Sem comentário (sem solução histórica e sem leis aplicáveis):** N

---

## Chamados ignorados (idempotência)

| Chave | Resumo | Motivo |
|-------|--------|--------|
| BTHSC-1234 | ... | Já possui tag [#IA-TRIAGEM-AUTOMATICA#] |

## Chamados com comentário preparado

### BTHSC-5678 — Resumo curto do chamado
- **Vertical/Sistema:** Pessoal / Folha Cloud
- **Município:** Itajaí
- **Chamados históricos utilizados:** BTHSC-1111, BTHSC-2222
- **Resumo da sugestão preparada:** ...

## Chamados analisados sem comentário

| Chave | Resumo | Motivo de não comentar |
|-------|--------|------------------------|
| BTHSC-9999 | ... | Nenhum histórico aprovado encontrado |

## Observações / incidentes

- (Erros de API, chamados problemáticos, ajustes a discutir etc.)
```

## Regras

- Os logs são **versionados no Git** para servir de trilha de auditoria.
- Nunca incluir nos logs dados sensíveis do colaborador (CPF/CNPJ completos, salário-base, endereços etc.). Quando necessário citar, anonimize.
- O log deve ser gerado **mesmo quando a fila estiver vazia** ou quando todos os chamados forem ignorados — neste caso, o arquivo registra apenas o cabeçalho com totais zerados.
- O bloco `## Consumo de tokens (Admin API)` ao final do arquivo é injetado automaticamente pelo `scripts/registrar_uso_tokens.js` no dia seguinte. Não editar manualmente — o script é idempotente e substitui o bloco quando reexecutado.
