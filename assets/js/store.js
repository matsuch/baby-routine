/**
 * Estado do app: tudo mora no localStorage deste aparelho.
 * Os eventos são a fonte da verdade; "próxima mamada" e "próxima dose"
 * são sempre derivados do último registro, nunca guardados.
 */

const KEY = 'rotina-bebe:v1';
export const MS_MIN = 60000;
export const MS_HOUR = 3600000;

/**
 * Remédios que já vêm sugeridos (mesma rotina dos alarmes de pós-parto).
 * Ids fixos (não aleatórios) para que dois celulares comecem idênticos e o
 * perfil não fique em ping-pong na sincronização.
 */
const MEDS_PADRAO = [
  { id: 'med-cefalexina', name: 'Cefalexina', intervalHours: 6, dose: '', who: 'mãe' },
  { id: 'med-paracetamol', name: 'Paracetamol', intervalHours: 8, dose: '', who: 'mãe' },
  { id: 'med-profenid', name: 'Profenid', intervalHours: 12, dose: '', who: 'mãe' },
];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function estadoInicial() {
  return {
    version: 1,
    baby: { name: '', birth: '' },
    settings: {
      feedIntervalMin: 180,
      notify: false,
      // Integração com WhatsApp via API não-oficial (WAHA ou Evolution).
      wa: {
        enabled: false,
        provider: 'waha',   // 'waha' | 'evolution'
        baseUrl: '',        // ex.: https://waha.seudominio.com
        apiKey: '',         // X-Api-Key (WAHA) ou apikey (Evolution)
        session: 'default', // sessão (WAHA) ou nome da instância (Evolution)
        numbers: '',        // destinos, separados por vírgula (DDI+DDD+número)
        onReminder: true,   // manda no WhatsApp junto do aviso local
        // URL do worker 24/7 (server/) que recebe a agenda e dispara na madrugada
        workerUrl: '',
        workerToken: '', // segredo compartilhado com o worker (header x-worker-token)
      },
      // Notificações push simples via ntfy.sh (sem servidor próprio).
      ntfy: {
        enabled: false,
        server: 'https://ntfy.sh',
        topic: '',          // tópico secreto; qualquer um que souber recebe os avisos
        onReminder: true,   // manda um push quando o aviso dispara (app aberto)
      },
    },
    meds: MEDS_PADRAO.map((m) => ({ active: true, ...m })),
    events: [],
    activeFeed: null,   // { startAt, side, segments: [{side, min}] }
    activeSleep: null,  // { startAt }
    activeBurp: null,   // { startAt } — cronômetro de arroto
  };
}

function migrar(dados) {
  const base = estadoInicial();
  const s = { ...base, ...dados };
  s.baby = { ...base.baby, ...(dados.baby || {}) };
  s.settings = { ...base.settings, ...(dados.settings || {}) };
  s.settings.wa = { ...base.settings.wa, ...((dados.settings || {}).wa || {}) };
  s.settings.ntfy = { ...base.settings.ntfy, ...((dados.settings || {}).ntfy || {}) };
  s.meds = Array.isArray(dados.meds) ? dados.meds : base.meds;
  s.events = Array.isArray(dados.events) ? dados.events : [];
  return s;
}

export let state = carregar();

function carregar() {
  if (typeof localStorage === 'undefined') return estadoInicial(); // Node/SSR
  try {
    const bruto = localStorage.getItem(KEY);
    return bruto ? migrar(JSON.parse(bruto)) : estadoInicial();
  } catch (err) {
    console.warn('Não consegui ler os dados salvos:', err);
    return estadoInicial();
  }
}

const ouvintes = new Set();
export function onChange(fn) { ouvintes.add(fn); }

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Não consegui salvar:', err);
  }
  ouvintes.forEach((fn) => fn());
}

/* ------------------------------------------------------------------ eventos */
/** Tipos: feed | diaper | sleep | med | note */
export function addEvent(ev) {
  const completo = { id: uid(), at: Date.now(), ...ev, updatedAt: Date.now(), _dirty: true };
  state.events.push(completo);
  state.events.sort((a, b) => a.at - b.at);
  save();
  return completo;
}

/** Exclusão é "tombstone": marca deleted para a exclusão sincronizar. */
export function removeEvent(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  ev.deleted = true;
  ev.updatedAt = Date.now();
  ev._dirty = true;
  save();
}

export function updateEvent(id, patch) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return null;
  Object.assign(ev, patch, { updatedAt: Date.now(), _dirty: true });
  state.events.sort((a, b) => a.at - b.at);
  save();
  return ev;
}

/** Último evento de um tipo (mais recente primeiro), ignorando apagados. */
export function lastEvent(type, filtro = () => true) {
  for (let i = state.events.length - 1; i >= 0; i -= 1) {
    const ev = state.events[i];
    if (ev.type === type && !ev.deleted && filtro(ev)) return ev;
  }
  return null;
}

export function eventsBetween(inicio, fim) {
  return state.events.filter((e) => !e.deleted && e.at >= inicio && e.at < fim);
}

/* ------------------------------------------------------------------ mamadas */
export function nextFeedAt() {
  const ultima = lastEvent('feed');
  if (!ultima) return null;
  return (ultima.endAt || ultima.at) + state.settings.feedIntervalMin * MS_MIN;
}

/** Sugere o lado a oferecer: o contrário do último que mamou mais tempo. */
export function nextSide() {
  const ultima = lastEvent('feed', (e) => e.lastSide === 'E' || e.lastSide === 'D');
  if (!ultima) return null;
  return ultima.lastSide === 'E' ? 'D' : 'E';
}

export function startFeed(side) {
  state.activeFeed = { startAt: Date.now(), side, segments: [], segStart: Date.now() };
  save();
}

export function switchSide(side) {
  const f = state.activeFeed;
  if (!f || f.side === side) return;
  const agora = Date.now();
  f.segments.push({ side: f.side, ms: agora - f.segStart });
  f.side = side;
  f.segStart = agora;
  save();
}

export function finishFeed() {
  const f = state.activeFeed;
  if (!f) return null;
  const agora = Date.now();
  const segmentos = [...f.segments, { side: f.side, ms: agora - f.segStart }];
  const porLado = segmentos.reduce((acc, s) => {
    acc[s.side] = (acc[s.side] || 0) + s.ms;
    return acc;
  }, {});
  state.activeFeed = null;
  return addEvent({
    type: 'feed',
    at: f.startAt,
    endAt: agora,
    durationMin: Math.max(1, Math.round((agora - f.startAt) / MS_MIN)),
    sides: Object.fromEntries(Object.entries(porLado).map(([k, ms]) => [k, Math.round(ms / MS_MIN)])),
    lastSide: f.side,
  });
}

export function cancelFeed() {
  state.activeFeed = null;
  save();
}

/* ------------------------------------------------------------------ sono */
export function toggleSleep() {
  if (state.activeSleep) {
    const inicio = state.activeSleep.startAt;
    state.activeSleep = null;
    return addEvent({ type: 'sleep', at: inicio, endAt: Date.now() });
  }
  state.activeSleep = { startAt: Date.now() };
  save();
  return null;
}

/* ------------------------------------------------------------------ arroto */
export function startBurp() {
  if (state.activeBurp) return;
  state.activeBurp = { startAt: Date.now() };
  save();
}

export function finishBurp() {
  const b = state.activeBurp;
  if (!b) return null;
  const agora = Date.now();
  state.activeBurp = null;
  return addEvent({
    type: 'burp',
    at: b.startAt,
    endAt: agora,
    durationMin: Math.max(1, Math.round((agora - b.startAt) / MS_MIN)),
    ok: true,
  });
}

export function cancelBurp() {
  state.activeBurp = null;
  save();
}

/* ------------------------------------------------------------------ remédios */
export function lastDose(medId) {
  return lastEvent('med', (e) => e.medId === medId);
}

export function nextDoseAt(med) {
  const dose = lastDose(med.id);
  if (!dose) return null;
  return dose.at + med.intervalHours * MS_HOUR;
}

export function takeMed(med, at = Date.now()) {
  return addEvent({ type: 'med', at, medId: med.id, name: med.name, dose: med.dose || '' });
}

export function saveMed(dados) {
  if (dados.id) {
    const med = state.meds.find((m) => m.id === dados.id);
    if (med) Object.assign(med, dados);
  } else {
    state.meds.push({ id: uid(), active: true, ...dados });
  }
  save();
}

export function removeMed(id) {
  state.meds = state.meds.filter((m) => m.id !== id);
  // Apaga as doses desse remédio como tombstone, para a exclusão sincronizar.
  state.events.forEach((e) => {
    if (e.type === 'med' && e.medId === id && !e.deleted) {
      e.deleted = true;
      e.updatedAt = Date.now();
      e._dirty = true;
    }
  });
  save();
}

/* ------------------------------------------------------------------ resumo */
export function dayBounds(ref = new Date()) {
  const inicio = new Date(ref);
  inicio.setHours(0, 0, 0, 0);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 1);
  return [inicio.getTime(), fim.getTime()];
}

export function daySummary(ref = new Date()) {
  const [inicio, fim] = dayBounds(ref);
  const eventos = eventsBetween(inicio, fim);
  const feeds = eventos.filter((e) => e.type === 'feed');
  const sonos = eventos.filter((e) => e.type === 'sleep' && e.endAt);
  const fraldas = eventos.filter((e) => e.type === 'diaper');
  return {
    inicio,
    fim,
    eventos,
    mamadas: feeds.length,
    minutosMamando: feeds.reduce((t, e) => t + (e.durationMin || 0), 0),
    xixis: fraldas.filter((e) => e.kind !== 'cocô').length,
    cocos: fraldas.filter((e) => e.kind !== 'xixi').length,
    arrotos: eventos.filter((e) => e.type === 'burp').length,
    remedios: eventos.filter((e) => e.type === 'med').length,
    minutosDormindo: sonos.reduce((t, e) => t + Math.round((e.endAt - e.at) / MS_MIN), 0),
  };
}

/** Projeta os horários de mamada e remédio das próximas `horas` horas. */
export function agenda(horas = 24) {
  const agora = Date.now();
  const limite = agora + horas * MS_HOUR;
  const linhas = [];

  let proximaMamada = nextFeedAt();
  const intervalo = state.settings.feedIntervalMin * MS_MIN;
  if (proximaMamada) {
    while (proximaMamada < agora) proximaMamada += intervalo;
    for (let t = proximaMamada; t <= limite; t += intervalo) {
      linhas.push({ at: t, emoji: '🍼', text: 'Mamada' });
    }
  }

  state.meds.filter((m) => m.active !== false).forEach((med) => {
    let prox = nextDoseAt(med);
    if (!prox) return;
    const passo = med.intervalHours * MS_HOUR;
    while (prox < agora) prox += passo;
    for (let t = prox; t <= limite; t += passo) {
      linhas.push({ at: t, emoji: '💊', text: `${med.name}${med.dose ? ` · ${med.dose}` : ''}` });
    }
  });

  return linhas.sort((a, b) => a.at - b.at);
}

/* ------------------------------------------------------------------ backup */
export function exportData() {
  return JSON.stringify(state, null, 2);
}

export function importData(texto) {
  const dados = JSON.parse(texto);
  if (!dados || typeof dados !== 'object' || !Array.isArray(dados.events)) {
    throw new Error('Arquivo não parece um backup do Rotina do Bebê.');
  }
  state = migrar(dados);
  save();
}

export function wipe() {
  state = estadoInicial();
  save();
}
