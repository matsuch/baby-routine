/**
 * Testes da lógica de sono estilo Napper (idade -> janela, próxima soneca,
 * recomendação por 24h). Sem navegador nem rede.
 *
 *   node tests/sleep.test.mjs
 */
import assert from 'node:assert';
import {
  state, ageDays, wakeWindow, recommendedSleepH, nextNap, addEvent,
  sleepMinutesInDay, sleepSegmentsInDay,
} from '../assets/js/store.js';

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log(`  ok  ${nome}`); }
  catch (err) { falhas += 1; console.error(`FALHOU ${nome}\n       ${err.message}`); }
}
const dias = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

teste('ageDays: null sem data, número com data', () => {
  state.baby.birth = '';
  assert.equal(ageDays(), null);
  state.baby.birth = dias(10);
  assert.equal(ageDays(), 10);
});

teste('wakeWindow: recém-nascido tem janela curta; bebê maior tem janela longa', () => {
  state.baby.birth = dias(10); // ~10 dias
  const rn = wakeWindow();
  assert.deepEqual([rn.min, rn.max], [40, 60]);
  state.baby.birth = dias(150); // ~5 meses
  const maior = wakeWindow();
  assert.ok(maior.min >= 120 && maior.max >= 150, `janela de 5 meses deveria ser longa: ${JSON.stringify(maior)}`);
});

teste('wakeWindow sem data assume recém-nascido (não quebra)', () => {
  state.baby.birth = '';
  const w = wakeWindow();
  assert.ok(w && w.min > 0, 'deveria devolver uma janela padrão');
});

teste('recommendedSleepH: recém-nascido 14–17h', () => {
  state.baby.birth = dias(10);
  const r = recommendedSleepH();
  assert.deepEqual([r.min, r.max], [14, 17]);
});

teste('nextNap: sem sono registrado -> null', () => {
  state.baby.birth = dias(10);
  state.events = [];
  state.activeSleep = null;
  assert.equal(nextNap(), null);
});

teste('nextNap: calcula janela a partir do último acordar', () => {
  state.baby.birth = dias(10);
  state.events = [];
  state.activeSleep = null;
  const acordou = Date.now() - 30 * 60000; // acordou há 30 min
  addEvent({ type: 'sleep', at: acordou - 60 * 60000, endAt: acordou });
  const nap = nextNap();
  assert.ok(nap, 'deveria haver próxima soneca');
  assert.equal(nap.wake, acordou);
  // janela recém-nascido 40–60 min após acordar
  assert.equal(Math.round((nap.start - acordou) / 60000), 40);
  assert.equal(Math.round((nap.end - acordou) / 60000), 60);
});

teste('nextNap: null enquanto está dormindo', () => {
  state.baby.birth = dias(10);
  state.activeSleep = { startAt: Date.now() };
  assert.equal(nextNap(), null);
  state.activeSleep = null;
});

teste('sono que cruza a meia-noite divide os minutos entre os dois dias', () => {
  const d15 = new Date(2026, 0, 15, 0, 0, 0, 0);         // meia-noite local do dia 15
  const inicioSono = new Date(2026, 0, 15, 23, 0, 0, 0);  // 23:00 do dia 15
  const fimSono = new Date(2026, 0, 16, 1, 0, 0, 0);      // 01:00 do dia 16
  state.events = [{ type: 'sleep', at: inicioSono.getTime(), endAt: fimSono.getTime() }];
  // Dia 15 fica só com 1h (23:00–00:00); dia 16 com 1h (00:00–01:00).
  assert.equal(sleepMinutesInDay(d15), 60, 'dia 15 deveria contar só a parte antes da meia-noite');
  assert.equal(sleepMinutesInDay(new Date(2026, 0, 16, 12, 0, 0)), 60, 'dia 16 deveria contar a parte depois da meia-noite');
  // e cada dia enxerga o segmento recortado (não o sono inteiro)
  const seg15 = sleepSegmentsInDay(d15);
  assert.equal(seg15.length, 1);
  assert.equal(seg15[0].endAt, d15.getTime() + 24 * 3600000, 'o segmento do dia 15 termina na meia-noite');
  state.events = [];
});

if (falhas) { console.error(`\n${falhas} teste(s) falharam.`); process.exit(1); }
console.log('\nOK — lógica de sono (janelas + soneca) passou.');
