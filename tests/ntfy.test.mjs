/**
 * Testes do publicador do ntfy (assets/js/ntfy), sem rede.
 *   node tests/ntfy.test.mjs
 *
 * O foco é o contrato do modo JSON do ntfy, que já quebrou os avisos duas
 * vezes: precisa ir na URL BASE (com `topic` no corpo) e a prioridade precisa
 * ser número — o nome ("high") faz o ntfy devolver 400 e o aviso some.
 */
import assert from 'node:assert';
import { buildRequest, tagPara, sugerirTopico } from '../assets/js/ntfy.js';

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log(`  ok  ${nome}`); }
  catch (err) { falhas += 1; console.error(`FALHOU ${nome}\n       ${err.stack || err.message}`); }
}

const cfg = { server: 'https://ntfy.sh', topic: 'segredo' };
const corpo = (opts) => JSON.parse(buildRequest(cfg, opts).body);

teste('publica na URL base, com o tópico no corpo (modo JSON)', () => {
  const req = buildRequest(cfg, { message: 'oi' });
  assert.equal(req.url, 'https://ntfy.sh', 'postar em /segredo faz o ntfy tratar o JSON como texto cru');
  assert.equal(req.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(req.body).topic, 'segredo');
});

teste('prioridade vai como número, não como nome', () => {
  assert.equal(corpo({ message: 'oi', priority: 'high' }).priority, 4);
  assert.equal(corpo({ message: 'oi', priority: 'max' }).priority, 5);
  assert.equal(corpo({ message: 'oi', priority: 'urgent' }).priority, 5);
  assert.equal(corpo({ message: 'oi', priority: 'low' }).priority, 2);
  assert.equal(corpo({ message: 'oi', priority: 5 }).priority, 5);
});

teste('prioridade desconhecida cai no padrão em vez de quebrar o envio', () => {
  assert.equal(corpo({ message: 'oi', priority: 'altíssima' }).priority, 3);
  assert.equal(corpo({ message: 'oi', priority: 99 }).priority, 3);
});

teste('sem prioridade, o campo nem aparece', () => {
  assert.equal('priority' in corpo({ message: 'oi' }), false);
});

teste('acentos e emoji sobrevivem (é corpo UTF-8, não header)', () => {
  const c = corpo({ message: '💊 Cefalexina', title: 'Rotina · Teresa' });
  assert.equal(c.title, 'Rotina · Teresa');
  assert.equal(c.message, '💊 Cefalexina');
});

teste('tags viram lista', () => {
  assert.deepEqual(corpo({ message: 'oi', tags: 'pill' }).tags, ['pill']);
  assert.deepEqual(corpo({ message: 'oi', tags: 'pill, baby_bottle' }).tags, ['pill', 'baby_bottle']);
  assert.deepEqual(corpo({ message: 'oi', tags: ['bell'] }).tags, ['bell']);
});

teste('entrega agendada vira `delay` em segundos', () => {
  const at = 1789246800000;
  assert.equal(corpo({ message: 'oi', at }).delay, String(at / 1000));
});

teste('sem tópico, falha antes de tentar a rede', () => {
  assert.throws(() => buildRequest({ server: 'https://ntfy.sh', topic: '  ' }, { message: 'oi' }), /tópico/i);
});

teste('servidor com barra no fim não vira URL dupla', () => {
  assert.equal(buildRequest({ server: 'https://ntfy.sh/', topic: 'x' }, { message: 'oi' }).url, 'https://ntfy.sh');
});

teste('tagPara escolhe o ícone pelo emoji', () => {
  assert.equal(tagPara('🍼 Hora da mamada'), 'baby_bottle');
  assert.equal(tagPara('💊 Cefalexina'), 'pill');
  assert.equal(tagPara('qualquer coisa'), 'bell');
});

teste('sugerirTopico gera tópicos distintos', () => {
  assert.notEqual(sugerirTopico(), sugerirTopico());
  assert.match(sugerirTopico(), /^rotina-bebe-[a-z0-9]+$/);
});

if (falhas) { console.error(`\n${falhas} teste(s) falharam.`); process.exit(1); }
console.log('\nOK — publicador do ntfy passou.');
