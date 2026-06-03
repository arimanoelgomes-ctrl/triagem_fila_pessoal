/**
 * Auto-envio de rascunhos de Triagem (Arrecadação e Pessoal).
 *
 * Roda a cada 5 min via trigger e envia automaticamente qualquer rascunho
 * cujo assunto comece com "[Triagem " — padrão dos rascunhos criados pelos
 * scheduled tasks do Cowork.
 *
 * Segurança:
 * - Filtra pelo prefixo exato "[Triagem " (com colchete e espaço).
 *   Outros rascunhos pessoais não são afetados.
 * - Loga cada envio em uma planilha (opcional — ver SHEET_ID abaixo).
 * - Idempotente: GmailDraft.send() remove o draft após enviar; não há
 *   risco de envio duplicado.
 *
 * Como instalar: ver instrucoes_apps_script.md.
 */

// --------- CONFIGURAÇÃO ---------

// Prefixo que identifica os rascunhos a enviar.
// Mude apenas se você renomear o prefixo nos prompts dos scheduled tasks.
const SUBJECT_PREFIX = '[Triagem ';

// (Opcional) ID de uma planilha Google Sheets para gravar log de envios.
// Deixe vazio ('') para desativar o log em planilha (ainda fica no Logger).
// Para usar: crie uma planilha em branco, cole o ID da URL aqui.
// Ex.: 'https://docs.google.com/spreadsheets/d/AQUI_O_ID/edit' -> 'AQUI_O_ID'
const SHEET_ID = '';

// --------- FUNÇÃO PRINCIPAL ---------

function autoSendTriagemDrafts() {
  const drafts = GmailApp.getDrafts();
  let sentCount = 0;
  const sentSummaries = [];

  for (const draft of drafts) {
    const msg = draft.getMessage();
    const subject = msg.getSubject() || '';

    if (!subject.startsWith(SUBJECT_PREFIX)) {
      continue;
    }

    try {
      const sent = draft.send();
      sentCount++;
      sentSummaries.push({
        subject: subject,
        to: msg.getTo(),
        sentMessageId: sent.getId(),
        timestamp: new Date()
      });
      Logger.log('Enviado: "' + subject + '" para ' + msg.getTo());
    } catch (err) {
      Logger.log('FALHA ao enviar "' + subject + '": ' + err);
      sentSummaries.push({
        subject: subject,
        to: msg.getTo(),
        sentMessageId: 'ERRO: ' + err,
        timestamp: new Date()
      });
    }
  }

  if (sentCount > 0) {
    Logger.log('Total enviado nesta execução: ' + sentCount);
    if (SHEET_ID) {
      registrarNaPlanilha_(sentSummaries);
    }
  }
}

// --------- HELPER: log em planilha (opcional) ---------

function registrarNaPlanilha_(rows) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Assunto', 'Destinatario', 'Message ID']);
    }
    for (const r of rows) {
      sheet.appendRow([r.timestamp, r.subject, r.to, r.sentMessageId]);
    }
  } catch (err) {
    Logger.log('Falha ao gravar na planilha de log: ' + err);
  }
}

// --------- INSTALAÇÃO DO TRIGGER ---------

/**
 * Rode esta função UMA VEZ manualmente (no editor do Apps Script) para
 * criar o trigger que dispara autoSendTriagemDrafts() a cada 5 minutos.
 */
function instalarTrigger() {
  // Remove triggers antigos da mesma função, se houver.
  const existing = ScriptApp.getProjectTriggers();
  for (const t of existing) {
    if (t.getHandlerFunction() === 'autoSendTriagemDrafts') {
      ScriptApp.deleteTrigger(t);
    }
  }

  ScriptApp.newTrigger('autoSendTriagemDrafts')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('Trigger instalado. autoSendTriagemDrafts() vai rodar a cada 5 min.');
}

/**
 * Use para desativar a automacao sem deletar o projeto.
 */
function removerTrigger() {
  const existing = ScriptApp.getProjectTriggers();
  for (const t of existing) {
    if (t.getHandlerFunction() === 'autoSendTriagemDrafts') {
      ScriptApp.deleteTrigger(t);
    }
  }
  Logger.log('Trigger removido.');
}
