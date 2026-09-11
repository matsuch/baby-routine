/**
 * Teste de fumaça: sobe o app num servidor local, percorre os fluxos principais
 * num Chromium e falha se algo quebrar no console ou não persistir.
 *
 *   npm install && npm test
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = process.env.SHOTS ? path.join(RAIZ, 'tests', 'screenshots') : null;
const PORTA = 8791;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

const servidor = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const arquivo = path.join(RAIZ, rel);
  if (!arquivo.startsWith(RAIZ) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
    res.writeHead(404).end('não encontrado');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(arquivo)] || 'application/octet-stream' });
  res.end(fs.readFileSync(arquivo));
});

const falhas = [];
const checar = (cond, msg) => { if (!cond) falhas.push(msg); };

await new Promise((r) => servidor.listen(PORTA, r));
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const executavel = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']
  .find((p) => fs.existsSync(p));
const browser = await chromium.launch(executavel ? { executablePath: executavel } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR' });
const page = await ctx.newPage();
const erros = [];
// Ignora falhas de rede de recursos externos (ex.: Google Fonts bloqueado no
// sandbox de teste) — não são erros do app; a fonte tem fallback do sistema.
const externo = (t) => /Failed to load resource|net::ERR|googleapis|gstatic/i.test(t);
page.on('console', (m) => { if (m.type() === 'error' && !externo(m.text())) erros.push(m.text()); });
page.on('pageerror', (e) => erros.push(`PAGEERROR: ${e.message}`));
const shot = (nome) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, nome), fullPage: true }) : Promise.resolve());

try {
  await page.goto(`http://localhost:${PORTA}/index.html`, { waitUntil: 'networkidle' });

  // ajustes
  await page.click('.tab[data-view="ajustes"]');
  await page.fill('#setName', 'Teresa');
  await page.selectOption('#setInterval', '180');

  // mamada cronometrada com troca de lado
  await page.click('.tab[data-view="mamada"]');
  await page.click('.side-btn[data-side="E"]');
  await page.waitForTimeout(1100);
  await page.click('.side-btn[data-side="D"]');
  await page.waitForTimeout(600);
  await shot('mamada.png');
  await page.click('#btnFeedFinish');
  checar(await page.locator('#feedList .item').count() === 1, 'mamada cronometrada não entrou na lista');

  // mamada registrada à mão
  await page.click('#btnFeedManual');
  await page.fill('#sheetBody input[name="min"]', '18');
  await page.click('#sheetBody button[type="submit"]');
  checar(await page.locator('#feedList .item').count() === 2, 'mamada manual não entrou na lista');

  // registros rápidos
  await page.click('.tab[data-view="agora"]');
  await page.click('.quick[data-quick="xixi"]');
  await page.click('.quick[data-quick="cocô"]');
  await page.click('.quick[data-quick="sono"]');
  checar((await page.textContent('#quickSonoLabel')).trim() === 'Acordou', 'botão de sono não virou "Acordou"');
  await page.click('.quick[data-quick="sono"]');

  // arroto agora é um cronômetro: inicia -> mostra timer -> finaliza -> registra duração
  await page.click('.quick[data-quick="arroto"]');
  checar((await page.textContent('#quickArrotoLabel')).trim() === 'Encerrar',
    'botão de arroto não virou "Encerrar" ao iniciar o timer');
  checar(await page.locator('#view-agora .timer-card .timer').count() === 1, 'timer de arroto não apareceu');
  await page.waitForTimeout(1100);
  await page.click('#view-agora .timer-card .btn-primary'); // Finalizar arroto
  const burps = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('rotina-bebe:v1')).events.filter((e) => e.type === 'burp'));
  checar(burps.length === 1 && burps[0].durationMin >= 1 && burps[0].endAt > burps[0].at,
    `arroto não registrou duração: ${JSON.stringify(burps)}`);
  checar((await page.textContent('#quickArrotoLabel')).trim() === 'Arroto',
    'botão de arroto não voltou para "Arroto" após finalizar');
  checar((await page.locator('#todayGrid .stat').allTextContents()).some((t) => t.includes('arrotos')),
    'resumo do dia não mostra arrotos');

  // remédios
  await page.click('.tab[data-view="remedios"]');
  const doses = page.locator('.med .btn-primary');
  const totalMeds = await doses.count();
  checar(totalMeds === 3, `esperava 3 remédios sugeridos, achei ${totalMeds}`);
  for (let i = 0; i < totalMeds; i += 1) await doses.nth(i).click();
  checar((await page.locator('.med-when').allTextContents()).every((t) => t.includes('Próximo')),
    'alerta sem próximo registro depois de registrar');
  await page.click('#btnAddMed');
  await page.selectOption('#sheetBody select[name="category"]', 'consulta');
  await page.fill('#sheetBody input[name="name"]', 'Consulta pediatra');
  await page.fill('#sheetBody input[name="intervalHours"]', '720');
  await page.click('#sheetBody button[type="submit"]');
  checar(await page.locator('.med').count() === 4, 'alerta novo não foi salvo');
  checar((await page.locator('.med .chip').allTextContents()).some((t) => t.includes('🩺')),
    'categoria (emoji) não apareceu no card do alerta');
  await shot('remedios.png');

  // agenda projetada
  await page.click('.tab[data-view="diario"]');
  await page.click('#btnAgenda');
  const linhas = await page.locator('.agenda-line').count();
  checar(linhas > 8, `agenda projetou poucas linhas (${linhas})`);
  await shot('agenda.png');
  await page.click('#sheetClose');
  checar(await page.locator('#timeline .item').count() >= 6, 'linha do tempo do dia veio incompleta');
  await shot('diario.png');
  await page.click('.tab[data-view="agora"]');
  await shot('agora.png');

  // config de WhatsApp: liga, preenche e testa o "Enviar teste" (fetch stubado)
  await page.click('.tab[data-view="ajustes"]');
  await page.check('#waEnabled');
  checar(!(await page.locator('#waFields').isHidden()), 'campos de WhatsApp não apareceram ao ligar');
  await page.selectOption('#waProvider', 'waha');
  await page.fill('#waBaseUrl', 'https://waha.exemplo.com');
  await page.fill('#waApiKey', 'chave-secreta');
  await page.fill('#waSession', 'default');
  await page.fill('#waNumbers', '5511999998888');
  await page.evaluate(() => {
    window.__wa = [];
    window.fetch = async (url, opts) => {
      window.__wa.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };
  });
  await page.click('#waTest');
  await page.waitForFunction(() => window.__wa && window.__wa.length > 0, { timeout: 4000 });
  const chamada = await page.evaluate(() => window.__wa[0]);
  checar(chamada.url === 'https://waha.exemplo.com/api/sendText', `URL do WAHA errada: ${chamada.url}`);
  checar(chamada.body.chatId === '5511999998888@c.us', `chatId errado: ${chamada.body.chatId}`);
  checar(chamada.headers['X-Api-Key'] === 'chave-secreta', 'X-Api-Key não foi enviado');
  const waSalvo = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('rotina-bebe:v1')).settings.wa);
  checar(waSalvo.enabled === true && waSalvo.baseUrl === 'https://waha.exemplo.com',
    'config de WhatsApp não persistiu');

  // config de ntfy: liga (gera tópico), testa envio e programa lembretes (fetch stubado)
  await page.check('#ntfyEnabled');
  checar(!(await page.locator('#ntfyFields').isHidden()), 'campos de ntfy não apareceram ao ligar');
  const topicoGerado = await page.inputValue('#ntfyTopic');
  checar(/^rotina-bebe-/.test(topicoGerado), `tópico não foi sugerido: "${topicoGerado}"`);
  await page.evaluate(() => {
    window.__ntfy = [];
    window.fetch = async (url, opts) => {
      window.__ntfy.push({ url, body: opts.body, headers: opts.headers });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };
  });
  await page.click('#ntfyTest');
  await page.waitForFunction(() => window.__ntfy && window.__ntfy.length > 0, { timeout: 4000 });
  const push = await page.evaluate(() => window.__ntfy[0]);
  checar(push.url === `https://ntfy.sh/${topicoGerado}`, `URL do ntfy errada: ${push.url}`);
  checar(typeof push.body === 'string' && push.body.includes('Teste'), 'corpo do push errado');
  // horários fixos de troca: são lidos e normalizados no perfil (que sincroniza
  // pro servidor, onde o /api/cron os usa para lembrar de anotar as trocas).
  await page.fill('#ntfyDiaper', '8h, 14:00, 22:30');
  await page.dispatchEvent('#ntfyDiaper', 'change');
  const trocas = await page.evaluate(
    () => JSON.parse(localStorage.getItem('rotina-bebe:v1')).settings.reminders.diaperTimes,
  );
  checar(Array.isArray(trocas) && trocas.join(',') === '08:00,14:00,22:30',
    `horários de troca não foram normalizados: ${trocas}`);

  // sincronização entre celulares: liga (gera código) e empurra pro /api/sync (stubado)
  await page.evaluate(() => {
    window.__sync = [];
    window.fetch = async (url, opts) => {
      if (String(url).includes('/api/sync')) window.__sync.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({ now: 1000, events: [], profile: null }), text: async () => '' };
    };
  });
  await page.check('#syncEnabled');
  checar(!(await page.locator('#syncFields').isHidden()), 'campos de sincronização não apareceram');
  const codigo = await page.inputValue('#syncCode');
  checar(/^\w{4}-\w{4}-\w{4}$/.test(codigo), `código de família não foi gerado: "${codigo}"`);
  await page.waitForFunction(() => window.__sync && window.__sync.length > 0, { timeout: 4000 });
  const primeiraSync = await page.evaluate(() => window.__sync[0]);
  checar(primeiraSync.url.includes('/api/sync'), 'sync não chamou /api/sync');
  checar(primeiraSync.body.familyCode === codigo, 'sync não enviou o código de família');
  checar(Array.isArray(primeiraSync.body.events) && primeiraSync.body.events.length >= 1,
    'primeira sincronização deveria empurrar os eventos locais existentes');
  checar(primeiraSync.body.events.every((e) => !('_dirty' in e)), 'não deve enviar _dirty ao servidor');
  const syncBk = await page.evaluate(() => JSON.parse(localStorage.getItem('rotina-bebe:sync')));
  checar(syncBk.enabled === true && syncBk.familyCode === codigo, 'config de sync não persistiu');
  await page.uncheck('#syncEnabled'); // desliga para não interferir no teste de persistência

  // persistência e service worker
  const antes = await page.evaluate(() => JSON.parse(localStorage.getItem('rotina-bebe:v1')).events.length);
  await page.reload({ waitUntil: 'networkidle' });
  const depois = await page.evaluate(() => JSON.parse(localStorage.getItem('rotina-bebe:v1')).events.length);
  checar(antes === depois && depois > 0, `registros mudaram no reload (${antes} → ${depois})`);
  checar(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r)),
    'service worker não registrou (app não abriria offline)');
  checar(erros.length === 0, `erros no console: ${erros.join(' | ')}`);
} finally {
  await browser.close();
  servidor.close();
}

if (falhas.length) {
  console.error('FALHOU:\n- ' + falhas.join('\n- '));
  process.exit(1);
}
console.log('OK — todos os fluxos passaram.');
