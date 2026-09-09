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
page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
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

  // remédios
  await page.click('.tab[data-view="remedios"]');
  const doses = page.locator('.med .btn-primary');
  const totalMeds = await doses.count();
  checar(totalMeds === 3, `esperava 3 remédios sugeridos, achei ${totalMeds}`);
  for (let i = 0; i < totalMeds; i += 1) await doses.nth(i).click();
  checar((await page.locator('.med-when').allTextContents()).every((t) => t.includes('Próxima')),
    'remédio sem próxima dose depois de registrar');
  await page.click('#btnAddMed');
  await page.fill('#sheetBody input[name="name"]', 'Vitamina D');
  await page.fill('#sheetBody input[name="intervalHours"]', '24');
  await page.click('#sheetBody button[type="submit"]');
  checar(await page.locator('.med').count() === 4, 'remédio novo não foi salvo');
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
