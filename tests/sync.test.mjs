/**
 * Testes da sincronização, sem banco nem rede:
 *  - núcleo do servidor (lib/sync-core) com um "banco" em memória
 *  - helpers puros do cliente (assets/js/sync)
 *
 *   node tests/sync.test.mjs
 */
import assert from 'node:assert';
import { applySync, sanitizeEvent } from '../lib/sync-core.mjs';
import { mergeIncoming, collectDirty, hashObj } from '../assets/js/sync.js';

let falhas = 0;
async function teste(nome, fn) {
  try { await fn(); console.log(`  ok  ${nome}`); }
  catch (err) { falhas += 1; console.error(`FALHOU ${nome}\n       ${err.stack || err.message}`); }
}

/** Banco em memória com a mesma semântica do Neon (clock só avança em escrita). */
function fakeDb() {
  let clock = 0;
  const eventos = new Map();  // key -> Map(id -> {id,data,deleted,updatedMs})
  const perfis = new Map();
  return {
    async now() { return clock; },
    async upsertEvents(key, evs) {
      const m = eventos.get(key) || new Map(); eventos.set(key, m);
      for (const e of evs) { clock += 1; m.set(e.id, { id: e.id, data: e.data, deleted: e.deleted, updatedMs: clock }); }
    },
    async getEventsSince(key, since) {
      const m = eventos.get(key) || new Map();
      return [...m.values()].filter((e) => e.updatedMs > since).sort((a, b) => a.updatedMs - b.updatedMs);
    },
    async getProfile(key) { return perfis.get(key) || null; },
    async upsertProfile(key, data) { clock += 1; perfis.set(key, { data, updatedMs: clock }); },
  };
}

const FAM = 'fam1';

/* ------------------------------------------------------------------ núcleo */

await teste('celular B recebe os eventos que A empurrou', async () => {
  const db = fakeDb();
  const a = await applySync(db, { familyKey: FAM, since: 0, events: [
    { id: 'e1', type: 'feed', at: 100, _dirty: true },
    { id: 'e2', type: 'diaper', at: 200, _dirty: true },
  ] });
  assert.equal(a.events.length, 2, 'A deveria ver os 2 que empurrou');
  const b = await applySync(db, { familyKey: FAM, since: 0, events: [] });
  assert.equal(b.events.length, 2, 'B deveria puxar os 2 eventos de A');
  assert.ok(b.events.every((e) => !e.data._dirty), 'não deve vazar _dirty para o banco');
});

await teste('cursor só traz o que é novo (sem reenviar tudo)', async () => {
  const db = fakeDb();
  const a1 = await applySync(db, { familyKey: FAM, since: 0, events: [{ id: 'e1', type: 'feed', at: 1 }] });
  const b1 = await applySync(db, { familyKey: FAM, since: 0, events: [] }); // B pega e1, cursor = b1.now
  await applySync(db, { familyKey: FAM, since: a1.now, events: [{ id: 'e2', type: 'burp', at: 2 }] }); // A empurra e2
  const b2 = await applySync(db, { familyKey: FAM, since: b1.now, events: [] });
  assert.equal(b2.events.length, 1, 'B só deveria receber o evento novo (e2)');
  assert.equal(b2.events[0].id, 'e2');
});

await teste('exclusão (tombstone) sincroniza', async () => {
  const db = fakeDb();
  await applySync(db, { familyKey: FAM, since: 0, events: [{ id: 'e1', type: 'feed', at: 1 }] });
  const b1 = await applySync(db, { familyKey: FAM, since: 0, events: [] });
  await applySync(db, { familyKey: FAM, since: 0, events: [{ id: 'e1', type: 'feed', at: 1, deleted: true }] });
  const b2 = await applySync(db, { familyKey: FAM, since: b1.now, events: [] });
  assert.equal(b2.events.length, 1);
  assert.equal(b2.events[0].deleted, true, 'B deveria ver e1 como apagado');
});

await teste('perfil sincroniza por última-edição-vence', async () => {
  const db = fakeDb();
  await applySync(db, { familyKey: FAM, since: 0, events: [], profile: { data: { baby: { name: 'Teresa' } } } });
  const b = await applySync(db, { familyKey: FAM, since: 0, events: [] });
  assert.equal(b.profile.data.baby.name, 'Teresa');
});

await teste('famílias diferentes não se enxergam', async () => {
  const db = fakeDb();
  await applySync(db, { familyKey: 'famA', since: 0, events: [{ id: 'x', type: 'feed', at: 1 }] });
  const outra = await applySync(db, { familyKey: 'famB', since: 0, events: [] });
  assert.equal(outra.events.length, 0, 'famB não pode ver eventos de famA');
});

await teste('sanitizeEvent remove campos locais e exige id', () => {
  assert.equal(sanitizeEvent({ type: 'feed' }), null, 'sem id deve ser rejeitado');
  const s = sanitizeEvent({ id: 'a', type: 'feed', _dirty: true, deleted: true });
  assert.equal(s.deleted, true);
  assert.ok(!('_dirty' in s.data) && !('deleted' in s.data), 'data não pode ter _dirty/deleted');
});

/* ------------------------------------------------------------------ cliente */

await teste('mergeIncoming: adiciona novo, substitui limpo, preserva sujo', () => {
  const local = [
    { id: 'a', type: 'feed', at: 1, updatedAt: 1, _dirty: false },
    { id: 'b', type: 'diaper', at: 2, updatedAt: 5, _dirty: true },
  ];
  const incoming = [
    { id: 'a', data: { type: 'feed', at: 1, durationMin: 9 }, deleted: false, updatedMs: 10 },
    { id: 'b', data: { type: 'diaper', at: 2, kind: 'xixi' }, deleted: false, updatedMs: 9 },
    { id: 'c', data: { type: 'burp', at: 3 }, deleted: false, updatedMs: 11 },
  ];
  const n = mergeIncoming(local, incoming);
  assert.equal(n, 2, 'a substituído + c adicionado');
  const a = local.find((e) => e.id === 'a');
  assert.equal(a.durationMin, 9, 'a deveria ter sido atualizado pelo servidor');
  assert.equal(a._dirty, false);
  const b = local.find((e) => e.id === 'b');
  assert.equal(b.kind, undefined, 'b sujo deveria ter sido preservado (não sobrescrito)');
  assert.ok(local.some((e) => e.id === 'c'), 'c deveria ter sido adicionado');
  assert.deepEqual(local.map((e) => e.at), [1, 2, 3], 'deve ficar ordenado por at');
});

await teste('collectDirty pega só os pendentes e sem _dirty no payload', () => {
  const st = { events: [
    { id: 'a', type: 'feed', at: 1, _dirty: true },
    { id: 'b', type: 'diaper', at: 2, _dirty: false },
  ] };
  const d = collectDirty(st);
  assert.equal(d.length, 1);
  assert.equal(d[0].id, 'a');
  assert.ok(!('_dirty' in d[0]), 'não deve enviar _dirty');
});

await teste('hashObj muda quando o objeto muda', () => {
  assert.notEqual(hashObj({ a: 1 }), hashObj({ a: 2 }));
  assert.equal(hashObj({ a: 1 }), hashObj({ a: 1 }));
});

if (falhas) { console.error(`\n${falhas} teste(s) falharam.`); process.exit(1); }
console.log('\nOK — sincronização (núcleo + cliente) passou.');
