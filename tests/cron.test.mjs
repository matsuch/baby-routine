/**
 * Testes do robô de avisos automáticos (lib/cron-core), sem Neon nem rede.
 *   node tests/cron.test.mjs
 */
import assert from 'node:assert';
import { runCron } from '../lib/cron-core.mjs';
import { MS_MIN, MS_HOUR } from '../lib/agenda-core.mjs';

let falhas = 0;
async function teste(nome, fn) {
  try { await fn(); console.log(`  ok  ${nome}`); }
  catch (err) { falhas += 1; console.error(`FALHOU ${nome}\n       ${err.stack || err.message}`); }
}

const perfil = () => ({
  baby: { name: 'Teresa' },
  settings: {
    feedIntervalMin: 180,
    ntfy: { enabled: true, server: 'https://ntfy.sh', topic: 'segredo' },
    reminders: { diaperTimes: [], tzOffsetMin: -180 }, // sem troca fixa p/ focar na mamada
  },
  meds: [],
});

/** Banco em memória para o cron. `now` é fixo (relógio do teste). */
function fakeDb({ now, families, events = {} }) {
  const sent = new Set();
  const chave = (k, pk) => `${k}::${pk}`;
  return {
    _sent: sent,
    async now() { return now; },
    async listFamilies() { return families; },
    async getRecentEvents(key, since) {
      return (events[key] || []).filter((e) => !e.deleted && e.at > since);
    },
    async markSent(key, pk) { const id = chave(key, pk); if (sent.has(id)) return false; sent.add(id); return true; },
    async unmarkSent(key, pk) { sent.delete(chave(key, pk)); },
    async pruneSent() { /* no-op no teste */ },
  };
}

function capturador() {
  const enviados = [];
  return { enviados, publish: async (cfg, opts) => { enviados.push({ cfg, opts }); } };
}

const FAM = 'fam1';
const feedVencida = (now) => ({ [FAM]: [{ type: 'feed', at: now - 200 * MS_MIN, endAt: now - 180 * MS_MIN }] });

await teste('envia a mamada vencida uma vez', async () => {
  const now = 10 * MS_HOUR;
  const db = fakeDb({ now, families: [{ key: FAM, profile: perfil() }], events: feedVencida(now) });
  const cap = capturador();
  const r = await runCron(db, cap);
  assert.equal(r.enviados, 1, 'deveria enviar 1 push');
  assert.match(cap.enviados[0].opts.message, /mamada/i);
  assert.equal(cap.enviados[0].opts.title, 'Rotina · Teresa');
  assert.equal(cap.enviados[0].cfg.topic, 'segredo', 'usa o tópico do perfil');
});

await teste('não reenvia no tick seguinte (dedup)', async () => {
  const now = 10 * MS_HOUR;
  const db = fakeDb({ now, families: [{ key: FAM, profile: perfil() }], events: feedVencida(now) });
  const cap = capturador();
  await runCron(db, cap);              // manda
  const r2 = await runCron(db, cap);   // mesmo estado -> nada
  assert.equal(r2.enviados, 0, 'não pode repetir o mesmo lembrete');
  assert.equal(cap.enviados.length, 1);
});

await teste('antecipar a mamada: o tick seguinte NÃO manda o aviso do horário antigo', async () => {
  const now = 10 * MS_HOUR;
  const events = feedVencida(now);
  const db = fakeDb({ now, families: [{ key: FAM, profile: perfil() }], events });
  const cap = capturador();
  await runCron(db, cap); // manda a mamada (venceu agora)
  // Mãe antecipa: registra a mamada 30 min atrás. Próxima passa a ser now+150min.
  events[FAM].push({ type: 'feed', at: now - 40 * MS_MIN, endAt: now - 30 * MS_MIN });
  const r2 = await runCron(db, cap);
  assert.equal(r2.enviados, 0, 'depois de mamar, nenhum aviso de mamada deve sair');
});

await teste('família com ntfy desligado é ignorada', async () => {
  const now = 10 * MS_HOUR;
  const p = perfil(); p.settings.ntfy.enabled = false;
  const db = fakeDb({ now, families: [{ key: FAM, profile: p }], events: feedVencida(now) });
  const cap = capturador();
  const r = await runCron(db, cap);
  assert.equal(r.consideradas, 0);
  assert.equal(r.enviados, 0);
});

await teste('falha no envio desmarca o dedup (reenvia no próximo tick)', async () => {
  const now = 10 * MS_HOUR;
  const db = fakeDb({ now, families: [{ key: FAM, profile: perfil() }], events: feedVencida(now) });
  let tentativas = 0;
  const publishFalha = async () => { tentativas += 1; if (tentativas === 1) throw new Error('rede'); };
  await runCron(db, { publish: publishFalha }); // 1ª falha
  assert.equal(db._sent.size, 0, 'dedup foi desfeito após falha');
  const cap = capturador();
  const r = await runCron(db, cap); // reenvia
  assert.equal(r.enviados, 1, 'deveria reenviar depois da falha');
});

if (falhas) { console.error(`\n${falhas} teste(s) falharam.`); process.exit(1); }
console.log('\nOK — robô de avisos automáticos (cron-core) passou.');
