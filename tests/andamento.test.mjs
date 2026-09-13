/**
 * Testes dos registros EM ANDAMENTO: os cronômetros (mamada, sono e arroto)
 * aparecem na lista do dia e nas contagens antes de encerrar, e só o início
 * deles pode ser corrigido.
 *
 *   node tests/andamento.test.mjs
 */
import assert from 'node:assert';
import {
  state, addEvent, daySummary, ongoingEvents, setOngoingStart, cancelOngoing,
  sleepMinutesInDay, sleepSegmentsInDay, startFeed, switchSide, ONGOING_ID, MS_MIN,
} from '../assets/js/store.js';

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log(`  ok  ${nome}`); }
  catch (err) { falhas += 1; console.error(`FALHOU ${nome}\n       ${err.message}`); }
}
function limpar() {
  state.events = [];
  state.activeFeed = null;
  state.activeSleep = null;
  state.activeBurp = null;
  state.baby.birth = '';
}
const meiaNoite = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

teste('sem cronômetro rodando não existe registro em andamento', () => {
  limpar();
  assert.deepEqual(ongoingEvents(), []);
  assert.equal(daySummary().eventos.length, 0);
});

teste('mamada, sono e arroto em andamento entram na lista do dia', () => {
  limpar();
  const agora = Date.now();
  state.activeFeed = { startAt: agora - 10 * MS_MIN, side: 'D', segments: [], segStart: agora - 10 * MS_MIN };
  state.activeSleep = { startAt: agora - 30 * MS_MIN };
  state.activeBurp = { startAt: agora - 5 * MS_MIN };

  const andamento = ongoingEvents(agora);
  assert.equal(andamento.length, 3);
  assert.deepEqual(andamento.map((e) => e.ongoing), ['sleep', 'feed', 'burp'], 'ordenados por início');
  assert.ok(andamento.every((e) => e.endAt === null), 'em andamento não tem fim');
  assert.deepEqual(andamento.map((e) => e.id), [ONGOING_ID.sleep, ONGOING_ID.feed, ONGOING_ID.burp]);

  const lista = daySummary().eventos.filter((e) => e.ongoing);
  assert.equal(lista.length, 3, 'os três deveriam aparecer na lista de registros do dia');
});

teste('as contagens do dia já incluem o que está em andamento', () => {
  limpar();
  const agora = Date.now();
  addEvent({ type: 'feed', at: agora - 4 * 60 * MS_MIN, endAt: agora - 3.7 * 60 * MS_MIN, durationMin: 18 });
  addEvent({ type: 'burp', at: agora - 3.5 * 60 * MS_MIN, endAt: agora - 3.3 * 60 * MS_MIN, durationMin: 12 });
  const antes = daySummary();
  assert.equal(antes.mamadas, 1);
  assert.equal(antes.arrotos, 1);

  state.activeFeed = { startAt: agora - 12 * MS_MIN, side: 'E', segments: [], segStart: agora - 12 * MS_MIN };
  state.activeBurp = { startAt: agora - 6 * MS_MIN };
  const depois = daySummary();
  assert.equal(depois.mamadas, 2, 'a mamada em andamento precisa contar');
  assert.equal(depois.arrotos, 2, 'o arroto em andamento precisa contar');
  assert.ok(depois.minutosMamando >= antes.minutosMamando + 11,
    `os minutos mamando deveriam crescer com o cronômetro: ${depois.minutosMamando}`);
});

teste('o sono em andamento soma no total do dia até agora', () => {
  limpar();
  const agora = Date.now();
  state.activeSleep = { startAt: agora - 45 * MS_MIN };
  assert.equal(sleepMinutesInDay(new Date(), agora), 45);
  assert.equal(daySummary().minutosDormindo, 45);
  const segs = sleepSegmentsInDay(new Date(), agora);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].ongoing, 'sleep', 'o segmento vivo precisa vir marcado');
});

teste('sono em andamento que veio de ontem conta em cada dia no lugar certo', () => {
  limpar();
  const inicio = meiaNoite() - 60 * MS_MIN; // ontem, 23:00
  state.activeSleep = { startAt: inicio };
  const ontem = new Date(inicio);
  assert.equal(sleepMinutesInDay(ontem), 60, 'ontem fica só com a parte antes da meia-noite');

  // O registro em si mora no dia em que começou; hoje só herda os minutos.
  assert.ok(daySummary(ontem).eventos.some((e) => e.ongoing === 'sleep'), 'a linha deveria estar em ontem');
  assert.ok(!daySummary().eventos.some((e) => e.ongoing === 'sleep'), 'hoje não repete a linha de ontem');
  assert.ok(daySummary().minutosDormindo >= 0);
});

teste('editar o início de um cronômetro muda a duração e as contagens', () => {
  limpar();
  const agora = Date.now();
  state.activeSleep = { startAt: agora - 10 * MS_MIN };
  const novo = agora - 90 * MS_MIN;
  assert.equal(setOngoingStart('sleep', novo), novo);
  assert.equal(state.activeSleep.startAt, novo);
  assert.ok(sleepMinutesInDay(new Date(), agora) >= 89, 'o total do dia precisa acompanhar o novo início');
});

teste('início no futuro é preso em agora', () => {
  limpar();
  state.activeBurp = { startAt: Date.now() - 5 * MS_MIN };
  const pedido = Date.now() + 2 * 60 * MS_MIN;
  const aplicado = setOngoingStart('burp', pedido);
  assert.ok(aplicado < pedido, 'não dá para começar no futuro');
  assert.ok(Math.abs(aplicado - Date.now()) < 2000, 'deveria virar "agora"');
});

teste('mamada: mudar o início mantém os minutos por lado batendo com o total', () => {
  limpar();
  startFeed('E');
  const f = state.activeFeed;
  // simula 10 min no esquerdo e 5 min no direito
  f.startAt -= 15 * MS_MIN;
  f.segments = [{ side: 'E', ms: 10 * MS_MIN }];
  f.segStart = Date.now() - 5 * MS_MIN;

  setOngoingStart('feed', f.startAt - 20 * MS_MIN); // começou 20 min mais cedo
  const ev = ongoingEvents().find((e) => e.ongoing === 'feed');
  const soma = Object.values(ev.sides).reduce((t, m) => t + m, 0);
  assert.ok(Math.abs(soma - ev.durationMin) <= 1,
    `lados (${soma}min) e duração (${ev.durationMin}min) deveriam fechar`);
  assert.ok(ev.sides.E >= 29, `o tempo a mais deveria ir para o lado daquele trecho: ${JSON.stringify(ev.sides)}`);
});

teste('mamada em andamento mostra os dois lados depois da troca', () => {
  limpar();
  startFeed('E');
  state.activeFeed.startAt -= 20 * MS_MIN;
  state.activeFeed.segStart -= 20 * MS_MIN;
  switchSide('D');
  const ev = ongoingEvents().find((e) => e.ongoing === 'feed');
  assert.equal(ev.lastSide, 'D');
  assert.ok(ev.sides.E >= 19, `esquerdo deveria ter ~20min: ${JSON.stringify(ev.sides)}`);
});

teste('cancelar um registro em andamento não deixa nada no histórico', () => {
  limpar();
  state.activeFeed = { startAt: Date.now(), side: 'E', segments: [], segStart: Date.now() };
  state.activeSleep = { startAt: Date.now() };
  state.activeBurp = { startAt: Date.now() };
  ['feed', 'sleep', 'burp'].forEach(cancelOngoing);
  assert.equal(state.activeFeed, null);
  assert.equal(state.activeSleep, null);
  assert.equal(state.activeBurp, null);
  assert.equal(state.events.length, 0, 'cancelar não registra evento');
  assert.deepEqual(ongoingEvents(), []);
});

teste('setOngoingStart não inventa cronômetro quando não há nenhum', () => {
  limpar();
  assert.equal(setOngoingStart('sleep', Date.now() - MS_MIN), null);
  assert.equal(setOngoingStart('feed', Number.NaN), null);
  assert.equal(state.activeSleep, null);
});

if (falhas) { console.error(`\n${falhas} teste(s) falharam.`); process.exit(1); }
console.log('\nOK — registros em andamento (lista, contagens e edição do início) passaram.');
