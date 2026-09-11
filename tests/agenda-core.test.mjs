/**
 * Testes do núcleo da agenda (o que decide o que está vencendo AGORA).
 *   node tests/agenda-core.test.mjs
 */
import assert from 'node:assert';
import {
  nextFeedAt, nextDoseAt, dueReminders, localTimeToday, MS_MIN, MS_HOUR,
} from '../lib/agenda-core.mjs';

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log(`  ok  ${nome}`); }
  catch (err) { falhas += 1; console.error(`FALHOU ${nome}\n       ${err.stack || err.message}`); }
}

const perfilBase = () => ({
  baby: { name: 'Teresa' },
  settings: { feedIntervalMin: 180, ntfy: { enabled: true, topic: 't' } },
  meds: [{ id: 'med-x', name: 'Paracetamol', intervalHours: 8, active: true }],
});

teste('nextFeedAt = fim da última mamada + intervalo', () => {
  const now = 10 * MS_HOUR;
  const evs = [{ type: 'feed', at: now - 200 * MS_MIN, endAt: now - 180 * MS_MIN }];
  assert.equal(nextFeedAt(perfilBase(), evs), now); // -180min + 180min = now
});

teste('nextDoseAt = última dose + intervalo do remédio', () => {
  const now = 10 * MS_HOUR;
  const med = { id: 'med-x', intervalHours: 8 };
  const evs = [{ type: 'med', medId: 'med-x', at: now - 8 * MS_HOUR }];
  assert.equal(nextDoseAt(med, evs), now);
});

teste('localTimeToday: 14:00 no fuso -180 (Brasil) = 17:00 UTC', () => {
  const now = Date.UTC(2026, 0, 15, 17, 0, 0); // 14:00 BRT
  assert.equal(localTimeToday(now, -180, '14:00'), now);
});

teste('dueReminders: mamada vencida entra', () => {
  const now = 10 * MS_HOUR;
  const evs = [{ type: 'feed', at: now - 200 * MS_MIN, endAt: now - 180 * MS_MIN }];
  const r = dueReminders(perfilBase(), evs, { now });
  assert.ok(r.some((x) => x.kind === 'feed'), 'deveria ter lembrete de mamada');
});

teste('dueReminders: antecipar a mamada 30 min CANCELA o aviso do horário antigo', () => {
  const now = 10 * MS_HOUR;
  // Sem a antecipação, a mamada venceria exatamente agora.
  const antes = dueReminders(perfilBase(), [
    { type: 'feed', at: now - 200 * MS_MIN, endAt: now - 180 * MS_MIN },
  ], { now });
  assert.ok(antes.some((x) => x.kind === 'feed'));

  // Registra uma mamada 30 min atrás (antecipada): próxima passa a ser now+150min.
  const depois = dueReminders(perfilBase(), [
    { type: 'feed', at: now - 200 * MS_MIN, endAt: now - 180 * MS_MIN },
    { type: 'feed', at: now - 40 * MS_MIN, endAt: now - 30 * MS_MIN },
  ], { now });
  assert.ok(!depois.some((x) => x.kind === 'feed'), 'não pode mais avisar mamada: já mamou');
});

teste('dueReminders: remédio vencido entra com a mensagem certa', () => {
  const now = 10 * MS_HOUR;
  const evs = [{ type: 'med', medId: 'med-x', at: now - 8 * MS_HOUR }];
  const r = dueReminders(perfilBase(), evs, { now });
  const med = r.find((x) => x.kind === 'med');
  assert.ok(med, 'deveria ter lembrete de remédio');
  assert.match(med.message, /Paracetamol/);
});

teste('dueReminders: troca em horário fixo entra no horário certo', () => {
  const now = Date.UTC(2026, 0, 15, 17, 0, 0); // 14:00 BRT — está na lista padrão
  const r = dueReminders(perfilBase(), [], { now });
  const troca = r.find((x) => x.kind === 'diaper');
  assert.ok(troca, 'deveria lembrar da troca às 14:00');
  assert.match(troca.key, /^diaper:2026-01-15:14:00$/);
});

teste('dueReminders: nada vencido = lista vazia (fora de horário)', () => {
  const now = Date.UTC(2026, 0, 15, 15, 30, 0); // 12:30 BRT, sem troca fixa, sem mamada/dose
  const r = dueReminders(perfilBase(), [], { now });
  assert.equal(r.length, 0);
});

teste('dueReminders: janela maxLate ignora avisos muito antigos', () => {
  const now = 10 * MS_HOUR;
  // Mamada venceu 2h atrás (> maxLate padrão de 90 min): não deve disparar.
  const evs = [{ type: 'feed', at: now - 6 * MS_HOUR, endAt: now - 5 * MS_HOUR }];
  const r = dueReminders(perfilBase(), evs, { now });
  assert.ok(!r.some((x) => x.kind === 'feed'), 'aviso velho demais não deve entrar');
});

teste('dueReminders: sem diaperTimes não lembra de troca', () => {
  const now = Date.UTC(2026, 0, 15, 17, 0, 0);
  const perfil = perfilBase();
  perfil.settings.reminders = { diaperTimes: [], tzOffsetMin: -180 };
  const r = dueReminders(perfil, [], { now });
  assert.ok(!r.some((x) => x.kind === 'diaper'));
});

if (falhas) { console.error(`\n${falhas} teste(s) falharam.`); process.exit(1); }
console.log('\nOK — núcleo da agenda (lembretes vencendo) passou.');
