#!/usr/bin/env node
/**
 * post_comentarios.js
 *
 * Posta comentários da triagem automática como Nota Interna no Jira da Betha,
 * usando o payload correto (properties.sd.public.comment.internal = true).
 *
 * Este script existe como workaround enquanto o MCP `@betha/jira-mcp` não
 * é corrigido (ver docs/incidente_mcp_add_comment.md).
 *
 * Uso:
 *   1. cd scripts && cp .env.example .env
 *   2. Editar .env com suas credenciais
 *   3. Listar arquivos disponíveis:    node post_comentarios.js --list
 *   4. Dry-run (sem postar):           node post_comentarios.js --dry-run
 *   5. Postar de fato:                 node post_comentarios.js
 *   6. Opcional: passar arquivo:       node post_comentarios.js --file ../outputs/2026-05-25_comentarios_para_postar.md
 *   7. Postar APENAS um chamado:       node post_comentarios.js --issue BTHSC-319007
 *
 * Requisitos: Node.js 18+ (usa fetch nativo).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ─── Constantes ─────────────────────────────────────────────────────────────
const TAG_IA = '[#IA-TRIAGEM-AUTOMATICA#]';
const DEFAULT_OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');

// Status considerados "encerrados" — não aceitam novos comentários no Jira da Betha.
// Lista validada empiricamente; ajustar se aparecerem outros nomes em produção.
const STATUS_ENCERRADOS = new Set([
    'Fechado',
    'Encerrado',
    'Resolvido',
    'Concluído',
    'Triagem encerrada',
    'Cancelado',
    'Reprovada',
]);

// ─── Sanitização ────────────────────────────────────────────────────────────
/**
 * Remove caracteres fora do Basic Multilingual Plane do Unicode (code points > U+FFFF),
 * que são representados como pares substitutos em UTF-16. Inclui emojis modernos como 🤖
 * (U+1F916), que causam HTTP 500 no Jira da Betha (provável limitação de encoding no DB).
 *
 * Acentuação latina, símbolos comuns e wiki markup permanecem intactos.
 */
function sanitizarBody(body) {
    // Remove pares substitutos (high surrogate U+D800-U+DBFF seguido de low surrogate U+DC00-U+DFFF)
    let sanitizado = body.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
    // Remove também variation selectors órfãos (FE0F) e outros marcadores de emoji
    sanitizado = sanitizado.replace(/[︀-️]/g, '');
    return sanitizado;
}

// ─── Argumentos da linha de comando ─────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
    dryRun: args.includes('--dry-run'),
    list: args.includes('--list'),
    yes: args.includes('--yes') || args.includes('-y'),
};
const fileArg = (() => {
    const idx = args.indexOf('--file');
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
})();
const issueArg = (() => {
    const idx = args.indexOf('--issue');
    return idx !== -1 && args[idx + 1] ? args[idx + 1].toUpperCase() : null;
})();

// ─── Carregamento simples do .env ───────────────────────────────────────────
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
        // remover aspas se presente
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

// ─── Validação de configuração ──────────────────────────────────────────────
function assertConfig() {
    if (!JIRA_BASE_URL || !JIRA_USERNAME || !JIRA_PASSWORD) {
        console.error('❌ Configuração ausente. Copie scripts/.env.example para scripts/.env e preencha:');
        console.error('   JIRA_BASE_URL, JIRA_USERNAME, JIRA_PASSWORD');
        process.exit(1);
    }
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────
function authHeader() {
    const token = Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString('base64');
    return `Basic ${token}`;
}

async function fetchIssueComments(issueKey) {
    const url = `${JIRA_BASE_URL}/rest/api/2/issue/${issueKey}/comment`;
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': authHeader(),
            'Accept': 'application/json',
        },
    });
    if (!res.ok) {
        throw new Error(`GET ${url} → HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.comments || [];
}

async function fetchIssueStatus(issueKey) {
    const url = `${JIRA_BASE_URL}/rest/api/2/issue/${issueKey}?fields=status`;
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': authHeader(),
            'Accept': 'application/json',
        },
    });
    if (!res.ok) {
        throw new Error(`GET ${url} → HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.fields?.status?.name || 'desconhecido';
}

async function postInternalComment(issueKey, body) {
    const url = `${JIRA_BASE_URL}/rest/api/2/issue/${issueKey}/comment`;
    const payload = {
        body: sanitizarBody(body),
        properties: [
            { key: 'sd.public.comment', value: { internal: true } },
        ],
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': authHeader(),
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST ${url} → HTTP ${res.status} — ${text}`);
    }
    return await res.json();
}

// ─── Parsing do arquivo de comentários preparados ───────────────────────────
/**
 * Espera blocos do tipo:
 *   ## N. BTHSC-XXXXXX — Título qualquer
 *   ... (metadados) ...
 *   ```markdown
 *   [#IA-TRIAGEM-AUTOMATICA#]
 *   ... corpo do comentário ...
 *   ```
 *
 * Retorna lista de { issueKey, body }.
 */
function parseComentarios(content) {
    const blocks = [];
    const headerRe = /^##\s+\d+\.\s+(BTHSC-\d+|[A-Z]+-\d+)\b/gm;
    const headers = [];
    let m;
    while ((m = headerRe.exec(content)) !== null) {
        headers.push({ key: m[1], start: m.index });
    }
    for (let i = 0; i < headers.length; i++) {
        const { key, start } = headers[i];
        const end = i + 1 < headers.length ? headers[i + 1].start : content.length;
        const section = content.slice(start, end);

        // Captura primeiro fence ```markdown ... ``` dentro da seção
        const fenceRe = /```(?:markdown)?\s*\n([\s\S]*?)\n```/;
        const fm = section.match(fenceRe);
        if (!fm) continue;
        const body = fm[1].trim();
        if (!body.includes(TAG_IA)) {
            console.warn(`⚠️  Bloco ${key} sem a tag ${TAG_IA} — ignorando por segurança.`);
            continue;
        }
        blocks.push({ issueKey: key, body });
    }
    return blocks;
}

function pickFile() {
    if (fileArg) {
        const abs = path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg);
        if (!fs.existsSync(abs)) {
            console.error(`❌ Arquivo não encontrado: ${abs}`);
            process.exit(1);
        }
        return abs;
    }
    // Padrão: pega o mais recente em outputs/*_comentarios_para_postar.md
    if (!fs.existsSync(DEFAULT_OUTPUTS_DIR)) {
        console.error(`❌ Diretório de outputs não encontrado: ${DEFAULT_OUTPUTS_DIR}`);
        process.exit(1);
    }
    const candidatos = fs.readdirSync(DEFAULT_OUTPUTS_DIR)
        .filter((n) => /_comentarios_para_postar\.md$/.test(n))
        .map((n) => ({ name: n, full: path.join(DEFAULT_OUTPUTS_DIR, n) }))
        .sort((a, b) => fs.statSync(b.full).mtimeMs - fs.statSync(a.full).mtimeMs);
    if (candidatos.length === 0) {
        console.error(`❌ Nenhum arquivo *_comentarios_para_postar.md encontrado em ${DEFAULT_OUTPUTS_DIR}`);
        process.exit(1);
    }
    return candidatos[0].full;
}

// ─── Confirmação interativa ─────────────────────────────────────────────────
function askYesNo(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            resolve(/^s|sim|y|yes$/i.test(answer.trim()));
        });
    });
}

// ─── Main ───────────────────────────────────────────────────────────────────
(async function main() {
    if (flags.list) {
        if (!fs.existsSync(DEFAULT_OUTPUTS_DIR)) {
            console.log(`(nenhum arquivo — diretório ${DEFAULT_OUTPUTS_DIR} não existe)`);
            return;
        }
        const arquivos = fs.readdirSync(DEFAULT_OUTPUTS_DIR)
            .filter((n) => /_comentarios_para_postar\.md$/.test(n))
            .sort();
        if (arquivos.length === 0) console.log('(nenhum arquivo de comentários encontrado)');
        else arquivos.forEach((n) => console.log(n));
        return;
    }

    if (!flags.dryRun) assertConfig();

    const arquivo = pickFile();
    console.log(`📄 Arquivo:  ${arquivo}`);
    console.log(`🌐 Jira:     ${JIRA_BASE_URL || '(dry-run, sem URL)'}`);
    console.log(`🧪 Modo:     ${flags.dryRun ? 'DRY-RUN (não posta)' : 'POSTAGEM REAL'}`);
    console.log('');

    const content = fs.readFileSync(arquivo, 'utf8');
    let blocos = parseComentarios(content);

    if (issueArg) {
        const filtrados = blocos.filter((b) => b.issueKey === issueArg);
        if (filtrados.length === 0) {
            console.error(`❌ Nenhum bloco encontrado para ${issueArg} no arquivo. Disponíveis: ${blocos.map(b => b.issueKey).join(', ')}`);
            process.exit(1);
        }
        console.log(`🎯 Filtro --issue ${issueArg}: ${filtrados.length} bloco(s) selecionado(s) de ${blocos.length} no arquivo.`);
        console.log('');
        blocos = filtrados;
    }

    if (blocos.length === 0) {
        console.log('Nenhum bloco com a tag encontrado. Nada a postar.');
        return;
    }

    console.log(`Encontrados ${blocos.length} comentário(s) candidato(s):`);
    blocos.forEach((b, i) => {
        const preview = b.body.split('\n').slice(0, 2).join(' | ');
        console.log(`  ${i + 1}. ${b.issueKey}  →  ${preview.slice(0, 80)}...`);
    });
    console.log('');

    if (!flags.dryRun && !flags.yes) {
        const ok = await askYesNo(`Confirma postagem dos ${blocos.length} comentários como NOTA INTERNA? [s/N]: `);
        if (!ok) {
            console.log('Cancelado.');
            return;
        }
    }

    let postados = 0;
    let ignorados = 0;
    let erros = 0;

    for (const bloco of blocos) {
        process.stdout.write(`• ${bloco.issueKey}: `);
        try {
            if (flags.dryRun) {
                console.log('DRY-RUN — não chamou API.');
                continue;
            }
            // Verificação de status: chamados fechados não aceitam comentários
            const status = await fetchIssueStatus(bloco.issueKey);
            if (STATUS_ENCERRADOS.has(status)) {
                console.log(`IGNORADO (chamado em status "${status}" — não aceita novos comentários).`);
                ignorados++;
                continue;
            }
            // Idempotência: checa se já tem comentário com a tag
            const existentes = await fetchIssueComments(bloco.issueKey);
            const jaTem = existentes.some((c) => (c.body || '').includes(TAG_IA));
            if (jaTem) {
                console.log('IGNORADO (já existe comentário com a tag).');
                ignorados++;
                continue;
            }
            const r = await postInternalComment(bloco.issueKey, bloco.body);
            console.log(`OK — comentário ${r.id} postado como INTERNO.`);
            postados++;
        } catch (err) {
            console.log(`ERRO — ${err.message}`);
            erros++;
        }
    }

    console.log('');
    console.log('─────────────────────────────────────────────');
    console.log(`Postados: ${postados}   Ignorados: ${ignorados}   Erros: ${erros}`);
    console.log('─────────────────────────────────────────────');

    if (erros > 0) process.exit(2);
})();
