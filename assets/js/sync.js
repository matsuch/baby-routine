/**
 * Sincronização entre celulares via "código de família".
 *
 * Local-first: o localStorage continua sendo a verdade no aparelho; o sync
 * concilia com o servidor (Vercel + Neon) por polling. Se não houver código
 * configurado (ou o servidor não existir), o app funciona igual, offline.
 *
 * Eventos: cada um carrega `updatedAt` e `_dirty`; exclusão é tombstone
 * (`deleted`). Empurramos os `_dirty`, puxamos o que mudou desde o cursor, e
 * mesclamos por id — nada é sobrescrito quando os dois registram ao mesmo tempo.
 */
import { state, save } from './store.js';

const BK_KEY = 'rotina-bebe:sync';
const ENDPOINT = './api/sync';

let bk = carregarBk();       // { enabled, familyCode, since, profileHash }
let sincronizando = false;
let aplicando = false;       // evita que o save() do próprio sync agende outro sync
let ultimoStatus = { estado: 'off', em: 0, pendentes: 0, erro: '' };
const ouvintes = new Set();

export function onStatus(fn) { ouvintes.add(fn); }
function emitir() { ouvintes.forEach((fn) => fn(ultimoStatus)); }

function carregarBk() {
  try {
    return { enabled: false, familyCode: '', since: 0, profileHash: '', ...JSON.parse(localStorage.getItem(BK_KEY) || '{}') };
  } catch {
    return { enabled: false, familyCode: '', since: 0, profileHash: '' };
  }
}
function salvarBk() {
  try { localStorage.setItem(BK_KEY, JSON.stringify(bk)); } catch { /* ignora */ }
}

/* ------------------------------------------------------------------ helpers puros */

export function hashObj(obj) {
  const s = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/** O "perfil" que sincroniza por última-edição-vence. */
export function profileData(st = state) {
  return { baby: st.baby, settings: st.settings, meds: st.meds };
}

/** Eventos alterados localmente e ainda não enviados. */
export function collectDirty(st = state) {
  return st.events.filter((e) => e._dirty).map((e) => {
    const { _dirty, ...limpo } = e;
    return limpo;
  });
}

/**
 * Mescla eventos vindos do servidor no array local (em lugar).
 * Regra: sem conflito de clock — o local sujo (pendente) sempre vence e será
 * reenviado; caso contrário o servidor é a fonte da verdade para aquele id.
 * Retorna quantos foram aplicados.
 */
export function mergeIncoming(localEvents, incoming) {
  const porId = new Map(localEvents.map((e) => [e.id, e]));
  let aplicados = 0;
  for (const inc of incoming) {
    const local = porId.get(inc.id);
    const merged = { ...inc.data, id: inc.id, deleted: !!inc.deleted, updatedAt: inc.updatedMs, _dirty: false };
    if (!local) {
      localEvents.push(merged);
      porId.set(inc.id, merged);
      aplicados += 1;
    } else if (!local._dirty) {
      Object.keys(local).forEach((k) => delete local[k]);
      Object.assign(local, merged);
      aplicados += 1;
    } // local._dirty => mantém o local (vai reenviar)
  }
  if (aplicados) localEvents.sort((a, b) => a.at - b.at);
  return aplicados;
}

/* ------------------------------------------------------------------ ciclo de sync */

function setStatus(estado, extra = {}) {
  ultimoStatus = { ...ultimoStatus, estado, em: Date.now(), ...extra };
  emitir();
}

export function isEnabled() { return !!bk.enabled && !!bk.familyCode; }
export function getCode() { return bk.familyCode; }
export function status() { return ultimoStatus; }

export function sugerirCodigo() {
  const parte = () => Math.random().toString(36).slice(2, 6);
  return `${parte()}-${parte()}-${parte()}`;
}

/** Liga o sync com um código; marca tudo como pendente para o 1º envio. */
export function enable(codigo) {
  bk.enabled = true;
  bk.familyCode = String(codigo || '').trim();
  bk.since = 0;
  bk.profileHash = '';
  state.events.forEach((e) => { e._dirty = true; });
  salvarBk();
  save();
  return syncOnce();
}

export function disable() {
  bk.enabled = false;
  salvarBk();
  setStatus('off');
}

function pendentes() {
  return state.events.filter((e) => e._dirty).length;
}

export async function syncOnce() {
  if (!isEnabled() || sincronizando) return;
  sincronizando = true;
  setStatus('sync');
  const codigoNoInicio = bk.familyCode; // se mudar no meio do voo, descartamos a resposta
  const cursorNoInicio = bk.since;
  const dirty = collectDirty();
  const perfilMudou = hashObj(profileData()) !== bk.profileHash;
  const payload = {
    familyCode: bk.familyCode,
    since: bk.since,
    events: dirty,
    profile: perfilMudou ? { data: profileData() } : null,
  };
  const idsEnviados = new Map(dirty.map((e) => [e.id, e.updatedAt]));

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // O código de família (ou o cursor) mudou enquanto esta requisição corria
    // (ex.: usuário trocou o código). Descarta a resposta; outro sync assume.
    if (bk.familyCode !== codigoNoInicio || bk.since !== cursorNoInicio) {
      setStatus('sync');
      triggerSoon(200);
      return;
    }

    // Confirma o envio: limpa _dirty dos que não mudaram no meio-tempo.
    state.events.forEach((e) => {
      if (idsEnviados.has(e.id) && e.updatedAt === idsEnviados.get(e.id)) e._dirty = false;
    });

    if (Array.isArray(data.events) && data.events.length) mergeIncoming(state.events, data.events);

    // Perfil: aplica se o servidor tem algo diferente e não há edição local pendente.
    if (data.profile && data.profile.data) {
      const localHash = hashObj(profileData());
      const localPendente = localHash !== bk.profileHash;
      if (!localPendente && hashObj(data.profile.data) !== localHash) {
        Object.assign(state, {
          baby: data.profile.data.baby ?? state.baby,
          settings: data.profile.data.settings ?? state.settings,
          meds: data.profile.data.meds ?? state.meds,
        });
      }
    }

    bk.since = Number(data.now) || bk.since;
    bk.profileHash = hashObj(profileData());
    salvarBk();
    aplicando = true;
    save();            // persiste + re-renderiza, sem reagendar outro sync
    aplicando = false;
    setStatus('ok', { pendentes: pendentes(), erro: '' });
  } catch (err) {
    setStatus('erro', { pendentes: pendentes(), erro: err.message });
  } finally {
    sincronizando = false;
  }
}

let debounce = null;
export function triggerSoon(ms = 1500) {
  if (!isEnabled() || aplicando) return; // não reagenda a partir do save() do próprio sync
  clearTimeout(debounce);
  debounce = setTimeout(syncOnce, ms);
}

/** Liga o loop: intervalo + ao focar o app. Chamado uma vez no boot. */
export function start(intervaloMs = 12000) {
  if (isEnabled()) { setStatus('sync'); syncOnce(); }
  setInterval(() => { if (isEnabled()) syncOnce(); }, intervaloMs);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncOnce(); });
}
