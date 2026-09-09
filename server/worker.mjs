/**
 * Worker 24/7 do Rotina do Bebê.
 *
 * Recebe a agenda (mamadas + doses) que o app empurra e dispara os lembretes
 * no WhatsApp na hora certa — mesmo com o celular bloqueado. É isto que cobre
 * a madrugada, que o navegador sozinho não cobre.
 *
 * Rotas:
 *   GET  /health           -> status e contadores
 *   POST /routine          -> app envia { provider, baseUrl, apiKey, session,
 *                              numbers[], agenda[{at, text}] } (ver wa.js pushAgenda)
 *   POST /send  { text }    -> dispara um texto agora para os números salvos (teste)
 *
 * Segurança: se WORKER_TOKEN estiver setado, /routine e /send exigem o header
 * x-worker-token igual. Rode sempre atrás de HTTPS (reverse proxy) numa VPS.
 *
 * Sem dependências: só a lib padrão do Node (18+). O envio reaproveita
 * ../assets/js/wa.js, a mesma lógica usada no app (uma fonte da verdade).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendText, normalizeNumber } from '../assets/js/wa.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(DIR, 'data', 'routine.json');
const TOKEN = process.env.WORKER_TOKEN || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const WINDOW_MS = Number(process.env.WINDOW_MIN || 8) * 60000; // janela para considerar "na hora"
const CHECK_MS = 30000;

/* ------------------------------------------------------------------ estado */

let store = { config: null, agenda: [], sent: [], updatedAt: 0 };

function load() {
  try {
    store = { ...store, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
    console.log(`[worker] estado carregado: ${store.agenda.length} itens na agenda`);
  } catch {
    console.log('[worker] começando com estado vazio');
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store));
  } catch (err) {
    console.warn('[worker] não consegui salvar:', err.message);
  }
}

/* ------------------------------------------------------------------ agenda */

const chaveItem = (item) => `${item.at}|${item.text}`;

/** Dispara os itens cuja hora chegou e ainda não foram enviados. */
async function processarAgenda() {
  const { config, agenda } = store;
  if (!config || !config.numbers?.length || !agenda.length) return;
  const agora = Date.now();
  const enviados = new Set(store.sent);

  for (const item of agenda) {
    if (item.at > agora) continue;                 // ainda não chegou
    if (agora - item.at > WINDOW_MS) continue;      // atrasado demais, deixa passar
    const chave = chaveItem(item);
    if (enviados.has(chave)) continue;

    for (const numero of config.numbers) {
      try {
        await sendText(config, numero, `⏰ ${item.text}`);
      } catch (err) {
        console.warn(`[worker] falha ao enviar para ${numero}:`, err.message);
      }
    }
    enviados.add(chave);
    console.log(`[worker] lembrete enviado: ${item.text}`);
  }

  // Limpa a agenda vencida e as chaves antigas, para o arquivo não crescer.
  store.agenda = agenda.filter((i) => i.at > agora - 2 * 60 * 60000);
  store.sent = [...enviados].filter((k) => Number(k.split('|')[0]) > agora - 6 * 60 * 60000);
  persist();
}

/* ------------------------------------------------------------------ http */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-worker-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function json(res, code, body) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function autorizado(req) {
  if (!TOKEN) return true;
  return req.headers['x-worker-token'] === TOKEN;
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (c) => {
      dados += c;
      if (dados.length > 1e6) reject(new Error('corpo grande demais'));
    });
    req.on('end', () => {
      try { resolve(dados ? JSON.parse(dados) : {}); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

/** Aceita a config vinda do app e normaliza os números. */
function guardarConfig(body) {
  const numbers = (Array.isArray(body.numbers) ? body.numbers : [])
    .map(normalizeNumber)
    .filter((n) => n.length >= 10);
  store.config = {
    provider: body.provider === 'evolution' ? 'evolution' : 'waha',
    baseUrl: String(body.baseUrl || ''),
    apiKey: String(body.apiKey || ''),
    session: String(body.session || 'default'),
    numbers,
  };
  if (Array.isArray(body.agenda)) {
    store.agenda = body.agenda
      .filter((i) => i && Number.isFinite(i.at) && typeof i.text === 'string')
      .map((i) => ({ at: i.at, text: i.text }));
  }
  store.updatedAt = Date.now();
  persist();
  return { ok: true, numbers: numbers.length, agenda: store.agenda.length };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      hasConfig: !!store.config,
      numbers: store.config?.numbers?.length || 0,
      agenda: store.agenda.length,
      updatedAt: store.updatedAt,
    });
  }

  if (req.method === 'POST' && url.pathname === '/routine') {
    if (!autorizado(req)) return json(res, 401, { error: 'token inválido' });
    try {
      return json(res, 200, guardarConfig(await lerCorpo(req)));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/send') {
    if (!autorizado(req)) return json(res, 401, { error: 'token inválido' });
    try {
      const body = await lerCorpo(req);
      const texto = String(body.text || '').trim();
      if (!store.config?.numbers?.length) return json(res, 400, { error: 'sem config/números' });
      if (!texto) return json(res, 400, { error: 'texto vazio' });
      let enviados = 0;
      for (const numero of store.config.numbers) {
        try { await sendText(store.config, numero, texto); enviados += 1; }
        catch (err) { console.warn('[worker] /send falhou:', err.message); }
      }
      return json(res, 200, { enviados, total: store.config.numbers.length });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  json(res, 404, { error: 'rota não encontrada' });
});

/** Sobe o servidor e o agendador. Só roda quando executado direto (não no import). */
export function start() {
  load();
  setInterval(() => { processarAgenda().catch((e) => console.warn('[worker]', e.message)); }, CHECK_MS);
  server.listen(PORT, () => console.log(`[worker] ouvindo na porta ${PORT} (janela ${WINDOW_MS / 60000}min)`));
}

const executadoDireto = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (executadoDireto) start();

export { guardarConfig, processarAgenda, store, server }; // para os testes
