#!/usr/bin/env node
/**
 * registrar_uso_tokens.js
 *
 * Consulta a Admin Usage API da Anthropic e grava o consumo do dia em
 * `logs/YYYY-MM-DD-usage.json`. Também injeta um bloco "## Consumo de tokens"
 * no fim do `logs/YYYY-MM-DD.md` correspondente, se ainda não existir.
 *
 * Por que existe:
 *   A IA da triagem (Cowork) não tem como expor o contador de tokens em runtime.
 *   A Admin API da Anthropic é a fonte oficial — agregada por dia, por modelo
 *   e (opcionalmente) por chave de API. Esse script fecha o ciclo de auditoria
 *   diária do projeto.
 *
 * Requisitos:
 *   - Node.js 18+ (usa fetch nativo).
 *   - ANTHROPIC_ADMIN_API_KEY no scripts/.env (chave do tipo `sk-ant-admin01-...`,
 *     gerada por um Owner/Admin da organização em console.anthropic.com →
 *     Settings → Admin Keys). Chaves de API comuns (sk-ant-api03-...) NÃO
 *     funcionam — a Usage API só aceita Admin Key.
 *
 * Uso:
 *   node registrar_uso_tokens.js                       # registra o dia de hoje (BRT)
 *   node registrar_uso_tokens.js --date 2026-05-27     # registra dia específico (BRT)
 *   node registrar_uso_tokens.js --no-inject           # só grava JSON, não toca no log .md
 *   node registrar_uso_tokens.js --workspace-id ws_X   # filtra por workspace
 *
 * Saída:
 *   logs/YYYY-MM-DD-usage.json   — JSON com totais e por-modelo (versionável)
 *   logs/YYYY-MM-DD.md           — recebe bloco "## Consumo de tokens (Admin API)"
 *                                  no final, idempotente (não duplica).
 *
 * Falha controlada:
 *   - Sem ANTHROPIC_ADMIN_API_KEY: grava JSON placeholder com instruções e sai 0.
 *   - HTTP error da Admin API: grava JSON com `error` e sai 1, sem mexer no .md.
 */

const fs = require('fs');
const path = require('path');

// ─── Constantes ─────────────────────────────────────────────────────────────
const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/v1/organizations/usage_report/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const LOGS_DIR = path.join(__dirname, '..', 'logs');
const BLOCO_HEADER = '## Consumo de tokens (Admin API)';

// Preços de referência por 1M tokens (USD) — atualizar quando a Anthropic mexer na tabela.
// Estes valores são uma estimativa local: a verdade oficial vem do Cost Report (endpoint distinto).
const PRECOS_USD_POR_MTK = {
    'claude-opus-4-7': { input: 15.0, cache_read: 1.5, cache_write_5m: 18.75, output: 75.0 },
    'claude-opus-4-6': { input: 15.0, cache_read: 1.5, cache_write_5m: 18.75, output: 75.0 },
    'claude-sonnet-4-6': { input: 3.0, cache_read: 0.3, cache_write_5m: 3.75, output: 15.0 },
    'claude-haiku-4-5': { input: 1.0, cache_read: 0.1, cache_write_5m: 1.25, output: 5.0 },
    'default': { input: 3.0, cache_read: 0.3, cache_write_5m: 3.75, output: 15.0 },
};

// ─── Argumentos ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
    noInject: args.includes('--no-inject'),
};
function readArg(name) {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
const dateArg = readArg('--date');
const workspaceArg = readArg('--workspace-id');

// ─── Carregamento simples do .env (mesma rotina do post_comentarios.js) ────
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

const ADMIN_KEY = process.env.ANTHROPIC_ADMIN_API_KEY || '';

// ─── Data (BRT) ─────────────────────────────────────────────────────────────
/**
 * Retorna {dateStr, startUtc, endUtc} para o dia BRT solicitado.
 * BRT = UTC-3 (Brasil não pratica horário de verão desde 2019).
 * dateStr é YYYY-MM-DD; startUtc/endUtc são ISO 8601 com Z marcando 00:00–24:00 BRT.
 */
function resolverDia(dateStr) {
    let alvo;
    if (dateStr) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            console.error(`Formato invalido para --date: ${dateStr}. Use YYYY-MM-DD.`);
            process.exit(1);
        }
        alvo = dateStr;
    } else {
        // Hoje em BRT (UTC-3): converter o "agora" UTC para BRT antes de extrair o dia.
        const agora = new Date();
        const brt = new Date(agora.getTime() - 3 * 3600 * 1000);
        alvo = brt.toISOString().slice(0, 10);
    }
    // 00:00 BRT do dia alvo = 03:00 UTC; 24:00 BRT = 03:00 UTC do dia seguinte.
    const start = new Date(`${alvo}T03:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    return {
        dateStr: alvo,
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
    };
}

// ─── Chamada à Admin Usage API ──────────────────────────────────────────────
async function consultarUsageAPI({ startUtc, endUtc, workspaceId }) {
    const url = new URL(ANTHROPIC_USAGE_URL);
    url.searchParams.set('starting_at', startUtc);
    url.searchParams.set('ending_at', endUtc);
    url.searchParams.set('bucket_width', '1d');
    // Quebrar por modelo para ter o detalhe que costuma interessar ao coordenador.
    url.searchParams.append('group_by[]', 'model');
    if (workspaceId) {
        url.searchParams.set('workspace_ids[]', workspaceId);
    }

    const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
            'x-api-key': ADMIN_KEY,
            'anthropic-version': ANTHROPIC_VERSION,
            'Accept': 'application/json',
        },
    });
    const texto = await res.text();
    if (!res.ok) {
        throw new Error(`Admin Usage API HTTP ${res.status} - ${texto.slice(0, 500)}`);
    }
    try {
        return JSON.parse(texto);
    } catch (e) {
        throw new Error(`Resposta nao-JSON da Admin Usage API: ${texto.slice(0, 200)}`);
    }
}

// ─── Agregação ──────────────────────────────────────────────────────────────
/**
 * Recebe o payload `data` da Admin API e produz:
 *   {
 *     total: { input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens, custo_estimado_usd },
 *     por_modelo: { 'claude-opus-4-7': { ... }, ... }
 *   }
 */
function agregarUso(payload) {
    const por_modelo = {};
    const total = {
        input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
        custo_estimado_usd: 0,
    };

    const buckets = Array.isArray(payload?.data) ? payload.data : [];
    for (const bucket of buckets) {
        const results = Array.isArray(bucket?.results) ? bucket.results : [];
        for (const r of results) {
            const modelo = r.model || r.group_by?.model || 'desconhecido';
            const it = Number(r.uncached_input_tokens || r.input_tokens || 0);
            const ic = Number(r.cache_read_input_tokens || 0);
            const iw = Number(r.cache_creation_input_tokens || r.cache_creation?.ephemeral_5m_input_tokens || 0);
            const ot = Number(r.output_tokens || 0);

            const tabela = PRECOS_USD_POR_MTK[modelo] || PRECOS_USD_POR_MTK.default;
            const custo =
                (it * tabela.input) / 1e6 +
                (ic * tabela.cache_read) / 1e6 +
                (iw * tabela.cache_write_5m) / 1e6 +
                (ot * tabela.output) / 1e6;

            if (!por_modelo[modelo]) {
                por_modelo[modelo] = {
                    input_tokens: 0,
                    cache_read_input_tokens: 0,
                    cache_creation_input_tokens: 0,
                    output_tokens: 0,
                    custo_estimado_usd: 0,
                };
            }
            por_modelo[modelo].input_tokens += it;
            por_modelo[modelo].cache_read_input_tokens += ic;
            por_modelo[modelo].cache_creation_input_tokens += iw;
            por_modelo[modelo].output_tokens += ot;
            por_modelo[modelo].custo_estimado_usd += custo;

            total.input_tokens += it;
            total.cache_read_input_tokens += ic;
            total.cache_creation_input_tokens += iw;
            total.output_tokens += ot;
            total.custo_estimado_usd += custo;
        }
    }
    // Arredondar custo para 4 casas — evita strings infinitas no JSON.
    total.custo_estimado_usd = +total.custo_estimado_usd.toFixed(4);
    for (const m of Object.keys(por_modelo)) {
        por_modelo[m].custo_estimado_usd = +por_modelo[m].custo_estimado_usd.toFixed(4);
    }
    return { total, por_modelo };
}

// ─── Persistência ───────────────────────────────────────────────────────────
function gravarJson(filePath, obj) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function formatarBlocoMd({ dateStr, agregado, janela }) {
    const t = agregado.total;
    const linhas = [];
    linhas.push('');
    linhas.push('---');
    linhas.push('');
    linhas.push(BLOCO_HEADER);
    linhas.push('');
    linhas.push(`Fonte: Anthropic Admin Usage API (\`/v1/organizations/usage_report/messages\`)`);
    linhas.push(`Janela consultada: ${janela.startUtc} -> ${janela.endUtc} (00:00 a 24:00 BRT do dia ${dateStr})`);
    linhas.push('');
    linhas.push('| Metrica | Valor |');
    linhas.push('|---------|-------|');
    linhas.push(`| Input tokens (uncached) | ${t.input_tokens.toLocaleString('en-US')} |`);
    linhas.push(`| Cache read input tokens | ${t.cache_read_input_tokens.toLocaleString('en-US')} |`);
    linhas.push(`| Cache creation input tokens | ${t.cache_creation_input_tokens.toLocaleString('en-US')} |`);
    linhas.push(`| Output tokens | ${t.output_tokens.toLocaleString('en-US')} |`);
    linhas.push(`| Custo estimado (USD) | $${t.custo_estimado_usd.toFixed(4)} |`);
    linhas.push('');
    const modelos = Object.keys(agregado.por_modelo);
    if (modelos.length > 0) {
        linhas.push('### Detalhamento por modelo');
        linhas.push('');
        linhas.push('| Modelo | Input | Cache read | Cache write | Output | Custo (USD) |');
        linhas.push('|--------|-------|-----------|-------------|--------|-------------|');
        for (const m of modelos) {
            const r = agregado.por_modelo[m];
            linhas.push(`| ${m} | ${r.input_tokens.toLocaleString('en-US')} | ${r.cache_read_input_tokens.toLocaleString('en-US')} | ${r.cache_creation_input_tokens.toLocaleString('en-US')} | ${r.output_tokens.toLocaleString('en-US')} | $${r.custo_estimado_usd.toFixed(4)} |`);
        }
        linhas.push('');
    }
    linhas.push('> Os precos sao estimativas locais (tabela versionada em `scripts/registrar_uso_tokens.js`). Para custo oficial use o Cost Report da Anthropic Console.');
    linhas.push('');
    return linhas.join('\n');
}

function injetarBlocoNoLogMd(logMdPath, bloco) {
    if (!fs.existsSync(logMdPath)) {
        console.warn(`Log diario nao encontrado: ${logMdPath} (pulando injecao no .md).`);
        return false;
    }
    const original = fs.readFileSync(logMdPath, 'utf8');
    if (original.includes(BLOCO_HEADER)) {
        // Substituir bloco antigo pelo novo (idempotente — permite reexecuçao do script).
        const re = new RegExp(`\\n*---\\n*${BLOCO_HEADER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*$`, 'm');
        const novo = original.replace(re, '\n') + bloco;
        fs.writeFileSync(logMdPath, novo, 'utf8');
        return 'substituido';
    }
    fs.writeFileSync(logMdPath, original.replace(/\s*$/, '\n') + bloco, 'utf8');
    return 'adicionado';
}

function gravarPlaceholder(jsonPath, dateStr, janela, motivo) {
    const placeholder = {
        date: dateStr,
        janela_utc: janela,
        status: 'placeholder',
        motivo,
        instrucoes: [
            'Para registrar consumo automatico, defina ANTHROPIC_ADMIN_API_KEY no scripts/.env.',
            'A chave precisa ser uma Admin Key (sk-ant-admin01-...), criada por um Owner da organizacao em console.anthropic.com -> Settings -> Admin Keys.',
            'Chaves de API normais (sk-ant-api03-...) nao funcionam — a Usage API exige Admin Key.',
            'Como alternativa manual: consulte o painel em console.anthropic.com -> Usage filtrando pela janela_utc deste arquivo e preencha o campo `total` deste JSON.',
        ],
        total: {
            input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation_input_tokens: null,
            output_tokens: null,
            custo_estimado_usd: null,
        },
    };
    gravarJson(jsonPath, placeholder);
}

// ─── Main ───────────────────────────────────────────────────────────────────
(async function main() {
    const { dateStr, startUtc, endUtc } = resolverDia(dateArg);
    const jsonPath = path.join(LOGS_DIR, `${dateStr}-usage.json`);
    const logMdPath = path.join(LOGS_DIR, `${dateStr}.md`);

    console.log(`Dia alvo (BRT): ${dateStr}`);
    console.log(`Janela UTC:     ${startUtc} -> ${endUtc}`);
    console.log(`JSON destino:   ${jsonPath}`);
    console.log(`Log .md alvo:   ${logMdPath}`);
    console.log('');

    if (!ADMIN_KEY) {
        console.warn('ANTHROPIC_ADMIN_API_KEY ausente no scripts/.env — gravando placeholder.');
        gravarPlaceholder(jsonPath, dateStr, { startUtc, endUtc }, 'ANTHROPIC_ADMIN_API_KEY ausente.');
        console.log(`Placeholder gravado em ${jsonPath}.`);
        process.exit(0);
    }

    let payload;
    try {
        payload = await consultarUsageAPI({ startUtc, endUtc, workspaceId: workspaceArg });
    } catch (err) {
        console.error(`Falha na Admin Usage API: ${err.message}`);
        gravarJson(jsonPath, {
            date: dateStr,
            janela_utc: { startUtc, endUtc },
            status: 'erro',
            erro: err.message,
        });
        process.exit(1);
    }

    const agregado = agregarUso(payload);
    const saida = {
        date: dateStr,
        janela_utc: { startUtc, endUtc },
        workspace_id: workspaceArg || null,
        status: 'ok',
        consultado_em: new Date().toISOString(),
        total: agregado.total,
        por_modelo: agregado.por_modelo,
        // Guardamos o payload bruto para auditoria — útil se a estrutura da API mudar.
        payload_bruto: payload,
    };
    gravarJson(jsonPath, saida);
    console.log(`JSON gravado: ${jsonPath}`);
    console.log(`Total: ${agregado.total.input_tokens.toLocaleString('en-US')} in + ${agregado.total.cache_read_input_tokens.toLocaleString('en-US')} cache-read + ${agregado.total.output_tokens.toLocaleString('en-US')} out  ~  $${agregado.total.custo_estimado_usd.toFixed(4)} USD`);

    if (!flags.noInject) {
        const bloco = formatarBlocoMd({ dateStr, agregado, janela: { startUtc, endUtc } });
        const status = injetarBlocoNoLogMd(logMdPath, bloco);
        if (status) {
            console.log(`Bloco '${BLOCO_HEADER}' ${status} em ${logMdPath}.`);
        }
    } else {
        console.log('Flag --no-inject ativa: nao tocando no log .md.');
    }
})();
