/**
 * Teste de integração: dois "celulares" sincronizando pelo /api/sync real
 * (núcleo lib/sync-core + banco em memória), servido no mesmo host do app.
 * Prova o round-trip cliente<->servidor que não dá para testar contra o
 * Neon/Vercel de fora. É tolerante a timing (o sync é assíncrono): repete o
 * "sincronizar agora" nos dois lados até o dado aparecer.
 *
 *   node tests/sync-e2e.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySync } from '../lib/sync-core.mjs';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORTA = 8793;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function fakeDb() {
  let clock = 0; const ev = new Map(); const pf = new Map();
  return {
    async now() { return clock; },
    async upsertEvents(k, evs) { const m = ev.get(k) || new Map(); ev.set(k, m); for (const e of evs) { clock += 1; m.set(e.id, { ...e, updatedMs: clock }); } },
    async getEventsSince(k, s) { const m = ev.get(k) || new Map(); return [...m.values()].filter((e) => e.updatedMs > s).sort((a, b) => a.updatedMs - b.updatedMs); },
    async getProfile(k) { return pf.get(k) || null; },
    async upsertProfile(k, d) { clock += 1; pf.set(k, { data: d, updatedMs: clock }); },
  };
}
const db = fakeDb();

const servidor = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/sync') {
    let body = ''; for await (const c of req) body += c;
    try {
      const b = JSON.parse(body || '{}');
      const out = await applySync(db, { familyKey: `k:${b.familyCode}`, since: b.since, events: b.events, profile: b.profile });
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
    } catch (e) { res.writeHead(500).end(JSON.stringify({ error: e.message })); }
    return;
  }
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const arq = path.join(RAIZ, rel);
  if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404).end('404'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(arq)] || 'application/octet-stream' }); res.end(fs.readFileSync(arq));
});

const falhas = [];
const CODE = 'familia-teste-123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ligarSync(page) {
  await page.click('#btnAjustes');
  await page.check('#syncEnabled');
  await page.fill('#syncCode', CODE);
  await page.dispatchEvent('#syncCode', 'change');
  await sleep(400);
}
async function syncAgora(page) {
  await page.click('#btnAjustes');
  await page.click('#syncNow');
  await sleep(350);
}
/** Repete o sync dos dois lados até `cond(receptor)` ficar true (ou desistir). */
async function propagar(remetente, receptor, cond, rotulo) {
  for (let i = 0; i < 8; i += 1) {
    await syncAgora(remetente);
    await syncAgora(receptor);
    if (await cond()) return true;
  }
  falhas.push(rotulo);
  return false;
}
const contarTipo = (page, tipo) => page.evaluate((t) => JSON.parse(localStorage.getItem('rotina-bebe:v1')).events.filter((e) => e.type === t && !e.deleted).length, tipo);

await new Promise((r) => servidor.listen(PORTA, r));
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
try {
  const A = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const B = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await A.goto(`http://localhost:${PORTA}/index.html`, { waitUntil: 'networkidle' });
  await B.goto(`http://localhost:${PORTA}/index.html`, { waitUntil: 'networkidle' });
  await ligarSync(A);
  await ligarSync(B);

  // A registra um xixi -> B recebe
  await A.click('.tab[data-view="agora"]');
  await A.click('.quick[data-quick="xixi"]');
  await propagar(A, B, async () => (await contarTipo(B, 'diaper')) >= 1, 'B não recebeu o xixi de A');

  // B registra um cocô -> A fica com as duas fraldas
  await B.click('.tab[data-view="agora"]');
  await B.click('.quick[data-quick="cocô"]');
  await propagar(B, A, async () => (await contarTipo(A, 'diaper')) >= 2, 'A não recebeu o cocô de B');

  // Nome do bebê definido em A sincroniza para B (perfil)
  await A.click('#btnAjustes');
  await A.fill('#setName', 'Teresa');
  await A.dispatchEvent('#setName', 'input');
  await propagar(A, B, async () => (await B.evaluate(() => JSON.parse(localStorage.getItem('rotina-bebe:v1')).baby.name)) === 'Teresa',
    'nome do bebê não sincronizou para B');
} finally {
  await browser.close();
  servidor.close();
}

if (falhas.length) { console.error('FALHOU:\n- ' + falhas.join('\n- ')); process.exit(1); }
console.log('OK — dois celulares sincronizaram (eventos + perfil) ponta a ponta.');
