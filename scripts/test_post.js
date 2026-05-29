#!/usr/bin/env node
/**
 * test_post.js
 *
 * Script de diagnóstico — envia variações progressivas de comentário ao Jira
 * para isolar a causa do HTTP 500.
 *
 * Uso:
 *   node test_post.js --issue BTHSC-318167 --case 1
 *
 * Casos disponíveis:
 *   1 = body simples (sem properties) → testa se postagem básica funciona
 *   2 = body simples + properties     → testa se properties causa o 500
 *   3 = body com asteriscos markdown   → testa se ** quebra o parser
 *   4 = body com emoji                 → testa se 🤖 quebra o parser
 *   5 = body com backticks            → testa se ` quebra o parser
 *   6 = body com tag IA + texto curto + properties → caso mais próximo do real
 *
 * Cada teste posta UM comentário e RETORNA O ID. Você precisa apagar manualmente
 * no Jira após cada teste (ou usar delete via API).
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name) => {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};

const issueKey = getArg('--issue');
const caseNum = parseInt(getArg('--case') || '1', 10);

if (!issueKey) {
    console.error('Uso: node test_post.js --issue BTHSC-XXXXX --case <1-6>');
    process.exit(1);
}

// ─── Carregamento do .env ───────────────────────────────────────────────────
function loadEnv(envPath) {
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) return;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    });
}
loadEnv(path.join(__dirname, '.env'));

const JIRA_BASE_URL = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
const JIRA_USERNAME = process.env.JIRA_USERNAME || '';
const JIRA_PASSWORD = process.env.JIRA_PASSWORD || '';

if (!JIRA_BASE_URL || !JIRA_USERNAME || !JIRA_PASSWORD) {
    console.error('❌ Configure scripts/.env (JIRA_BASE_URL, JIRA_USERNAME, JIRA_PASSWORD).');
    process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString('base64');

// ─── Casos de teste ─────────────────────────────────────────────────────────
const CASES = {
    1: {
        descricao: 'body simples (sem properties)',
        payload: {
            body: 'teste 1 — body simples sem properties (pode apagar)',
        },
    },
    2: {
        descricao: 'body simples + properties (nota interna)',
        payload: {
            body: 'teste 2 — body simples com properties (pode apagar)',
            properties: [{ key: 'sd.public.comment', value: { internal: true } }],
        },
    },
    3: {
        descricao: 'body com asteriscos markdown + properties',
        payload: {
            body: 'teste 3 — **negrito** e *italico* (pode apagar)',
            properties: [{ key: 'sd.public.comment', value: { internal: true } }],
        },
    },
    4: {
        descricao: 'body com emoji + properties',
        payload: {
            body: 'teste 4 — emoji 🤖 (pode apagar)',
            properties: [{ key: 'sd.public.comment', value: { internal: true } }],
        },
    },
    5: {
        descricao: 'body com backticks + properties',
        payload: {
            body: 'teste 5 — codigo `inline` e bloco (pode apagar)',
            properties: [{ key: 'sd.public.comment', value: { internal: true } }],
        },
    },
    6: {
        descricao: 'body com tag IA + texto curto + properties',
        payload: {
            body: '[#IA-TRIAGEM-AUTOMATICA#]\nTeste 6 — caso mais próximo do real (pode apagar).',
            properties: [{ key: 'sd.public.comment', value: { internal: true } }],
        },
    },
};

const caso = CASES[caseNum];
if (!caso) {
    console.error(`Caso inválido: ${caseNum}. Disponíveis: ${Object.keys(CASES).join(', ')}`);
    process.exit(1);
}

// ─── Postagem ───────────────────────────────────────────────────────────────
(async () => {
    const url = `${JIRA_BASE_URL}/rest/api/2/issue/${issueKey}/comment`;
    console.log(`🧪 Caso ${caseNum}: ${caso.descricao}`);
    console.log(`📤 POST ${url}`);
    console.log(`📦 Payload:`);
    console.log(JSON.stringify(caso.payload, null, 2));
    console.log('');

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': auth,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(caso.payload),
        });
        const text = await res.text();
        console.log(`📥 HTTP ${res.status} ${res.statusText}`);
        console.log(`📋 Response body:`);
        console.log(text);
        if (res.ok) {
            try {
                const data = JSON.parse(text);
                console.log('');
                console.log(`✅ Sucesso. Comentário ID ${data.id} criado.`);
                console.log(`🔗 ${JIRA_BASE_URL}/browse/${issueKey}?focusedId=${data.id}`);
                console.log('⚠️  Apague o comentário manualmente após confirmar o resultado visual.');
            } catch {}
        } else {
            console.log('');
            console.log(`❌ Falhou.`);
        }
    } catch (err) {
        console.error(`❌ Erro de rede: ${err.message}`);
    }
})();
