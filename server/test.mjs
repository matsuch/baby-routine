/**
 * Testes do worker e do adaptador de WhatsApp, sem tocar a rede.
 * Substitui o fetch global por um mock e verifica payloads e agendamento.
 *
 *   node server/test.mjs   (ou: npm test dentro de server/)
 */
import assert from 'node:assert';
import { buildRequest, parseNumbers, normalizeNumber } from '../assets/js/wa.js';
import { guardarConfig, processarAgenda, store } from './worker.mjs';

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log(`  ok  ${nome}`); }
  catch (err) { falhas += 1; console.error(`FALHOU ${nome}\n       ${err.message}`); }
}
async function testeAsync(nome, fn) {
  try { await fn(); console.log(`  ok  ${nome}`); }
  catch (err) { falhas += 1; console.error(`FALHOU ${nome}\n       ${err.message}`); }
}

/* ------------------------------------------------------------------ wa.js */

teste('normalizeNumber tira tudo que não é dígito', () => {
  assert.equal(normalizeNumber('+55 (11) 99999-8888'), '5511999998888');
});

teste('parseNumbers separa por vírgula e descarta curtos', () => {
  assert.deepEqual(parseNumbers('5511999998888, 5521 98888-7777, 123'),
    ['5511999998888', '5521988887777']);
});

teste('buildRequest monta o payload do WAHA', () => {
  const req = buildRequest(
    { provider: 'waha', baseUrl: 'https://waha.x.com/', apiKey: 'K', session: 's1' },
    '55 11 99999-8888', 'oi');
  assert.equal(req.url, 'https://waha.x.com/api/sendText');
  assert.equal(req.headers['X-Api-Key'], 'K');
  assert.deepEqual(req.body, { session: 's1', chatId: '5511999998888@c.us', text: 'oi' });
});

teste('buildRequest monta o payload da Evolution', () => {
  const req = buildRequest(
    { provider: 'evolution', baseUrl: 'https://evo.x.com', apiKey: 'K', session: 'inst' },
    '5511999998888', 'oi');
  assert.equal(req.url, 'https://evo.x.com/message/sendText/inst');
  assert.equal(req.headers.apikey, 'K');
  assert.deepEqual(req.body, { number: '5511999998888', text: 'oi' });
});

teste('buildRequest exige URL e número', () => {
  assert.throws(() => buildRequest({ provider: 'waha' }, '5511999998888', 'x'));
  assert.throws(() => buildRequest({ provider: 'waha', baseUrl: 'https://x' }, '', 'x'));
});

/* ------------------------------------------------------------------ worker */

teste('guardarConfig normaliza números e guarda a agenda', () => {
  const r = guardarConfig({
    provider: 'waha', baseUrl: 'https://waha.x.com', apiKey: 'K', session: 'default',
    numbers: ['+55 11 99999-8888', '123'],
    agenda: [{ at: Date.now() + 1000, text: '🍼 Mamada' }, { at: 'nao', text: 'x' }],
  });
  assert.equal(r.numbers, 1, 'devia sobrar 1 número válido');
  assert.equal(store.agenda.length, 1, 'devia guardar só o item de agenda válido');
});

await testeAsync('processarAgenda envia item vencido uma vez só', async () => {
  const chamadas = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    chamadas.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({}) };
  };
  try {
    guardarConfig({
      provider: 'waha', baseUrl: 'https://waha.x.com', apiKey: 'K', session: 'default',
      numbers: ['5511999998888'],
      agenda: [{ at: Date.now() - 60000, text: '💊 Paracetamol' }],
    });
    await processarAgenda();
    await processarAgenda(); // segunda passada não deve reenviar
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.equal(chamadas.length, 1, `esperava 1 envio, houve ${chamadas.length}`);
  assert.match(chamadas[0].body.text, /Paracetamol/);
});

await testeAsync('processarAgenda ignora item futuro', async () => {
  let enviou = false;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => { enviou = true; return { ok: true, json: async () => ({}) }; };
  try {
    guardarConfig({
      provider: 'waha', baseUrl: 'https://waha.x.com', apiKey: 'K', session: 'default',
      numbers: ['5511999998888'],
      agenda: [{ at: Date.now() + 3600000, text: '🍼 Mamada' }],
    });
    await processarAgenda();
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.equal(enviou, false, 'não devia enviar item que ainda não chegou');
});

if (falhas) { console.error(`\n${falhas} teste(s) falharam.`); process.exit(1); }
console.log('\nOK — worker e adaptador de WhatsApp passaram.');
