# Auto-envio de rascunhos de Triagem — Apps Script

Este script envia automaticamente os rascunhos criados pelos scheduled tasks da triagem (assuntos que começam com `[Triagem `). Roda a cada 5 minutos.

## Como funciona

- A cada 5 min, o trigger executa `autoSendTriagemDrafts()`.
- A função varre todos os seus rascunhos e envia aqueles cujo assunto começa com `[Triagem ` (com colchete e espaço).
- Rascunhos enviados são automaticamente removidos da pasta Drafts pelo Gmail.
- Outros rascunhos seus (sem o prefixo) não são tocados.

## Instalação (10 minutos)

### 1. Abrir o Apps Script

1. Acesse https://script.google.com (logado com sua conta `@betha.com.br`).
2. Clique em **Novo projeto** (New project).
3. Renomeie o projeto (canto superior esquerdo) para `Auto-envio Triagem Drafts`.

### 2. Colar o código

1. No editor que aparece com `function myFunction() { ... }`, **apague tudo**.
2. Cole o conteúdo do arquivo [`auto_send_triagem_drafts.gs`](./auto_send_triagem_drafts.gs).
3. Clique no ícone de disquete para salvar (Ctrl+S).

### 3. Autorizar acesso ao Gmail

1. No topo do editor, no dropdown ao lado do botão Executar, selecione a função `autoSendTriagemDrafts`.
2. Clique em **Executar** (Run).
3. O Google vai pedir autorização — clique em **Revisar permissões**.
4. Escolha sua conta `@betha.com.br`.
5. Se aparecer "Google não verificou este app", clique em **Avançado** → **Acessar 'Auto-envio Triagem Drafts' (não seguro)** (é seu próprio script, é seguro).
6. Conceda as permissões solicitadas (Gmail send + Drive opcional).
7. A execução vai rodar — pode não enviar nada na primeira vez se não houver rascunho na fila, isso é esperado.

### 4. Instalar o trigger automático

1. No dropdown da função no topo, selecione `instalarTrigger`.
2. Clique em **Executar**.
3. Confira no menu lateral em **Acionadores** (Triggers, ícone de relógio) que aparece um trigger:
   - Função: `autoSendTriagemDrafts`
   - Origem do evento: Driven by time
   - Tipo: Minutos timer
   - Intervalo: A cada 5 minutos

Pronto. A partir de agora, qualquer rascunho com assunto `[Triagem ...` é enviado em até 5 min.

## (Opcional) Log de envios em planilha

Se quiser uma trilha de auditoria do que foi enviado:

1. Crie uma planilha em branco no Google Sheets (chamada `Log Auto-envio Triagem` por exemplo).
2. Copie o ID da URL: `https://docs.google.com/spreadsheets/d/AQUI_O_ID/edit` → cole no script na constante `SHEET_ID`.
3. Salve.
4. Cada envio fica logado com timestamp, assunto, destinatário e Message ID.

## Como testar agora

1. Crie um rascunho qualquer no Gmail com assunto começando com `[Triagem TESTE]` e qualquer corpo.
2. No editor do Apps Script, execute manualmente `autoSendTriagemDrafts` uma vez.
3. Confira em Enviados (Sent) que o rascunho foi enviado.

Se quiser não esperar 5 minutos quando os scheduled tasks da triagem rodarem, basta abrir o editor do Apps Script e clicar Executar em `autoSendTriagemDrafts` — envia na hora.

## Como desativar temporariamente

Execute a função `removerTrigger` uma vez. O trigger é deletado mas o código fica preservado — basta rodar `instalarTrigger` de novo para reativar.

## Compartilhamento entre projetos

O mesmo Apps Script atende as **4 tarefas** (Arrecadação manhã/tarde + Pessoal manhã/tarde) porque o filtro é por prefixo `[Triagem `. Não precisa instalar uma cópia para cada projeto — uma única instalação cobre tudo.

## Segurança

- O script só envia rascunhos cujo assunto começa com `[Triagem ` (literal, com colchete e espaço). Outros rascunhos pessoais ou de trabalho não são tocados.
- Se você quiser ser mais restritivo (ex.: só os do projeto Arrecadação), mude `SUBJECT_PREFIX` para `[Triagem Arrecadacao `.
- O script não lê o corpo dos emails — apenas o assunto e os metadados (de, para).
- Roda na sua conta Google com suas próprias permissões — nada sai do escopo do Gmail.

## Troubleshooting

**"O trigger não foi instalado"** → verifique em Triggers (relógio na barra lateral) se aparece `autoSendTriagemDrafts`. Se não, execute `instalarTrigger` novamente.

**"O script roda mas não envia"** → execute manualmente `autoSendTriagemDrafts` e veja os logs em **Execuções** (ícone de lista na barra lateral). Provavelmente o assunto do rascunho não casa com o prefixo `[Triagem `.

**"Quero pausar tudo"** → execute `removerTrigger` uma vez.

**"O Apps Script atingiu cota"** → contas pessoais têm limite de 100 envios/dia via Apps Script. Como a triagem gera no máximo 4 emails/dia (2 manhã + 2 tarde), você está bem longe do limite.
