/** Rotina do Bebê — telas, interações e avisos. */
import * as S from './store.js';
import { MS_MIN, MS_HOUR, state } from './store.js';
import {
  countdown, describeFeed, fmtAge, fmtDate, fmtDateTime, fmtGap, fmtMin, fmtTime,
  fromLocalInput, pad, SIDE_LABEL, toLocalInput,
} from './format.js';
import * as WA from './wa.js';
import * as NTFY from './ntfy.js';
import * as SYNC from './sync.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const TITULOS = {
  agora: 'Agora',
  mamada: 'Mamada',
  remedios: 'Alertas',
  diario: 'Diário',
  ajustes: 'Ajustes',
};

const BURP_TARGET_MIN = 20; // meta do cronômetro de arroto

let viewAtual = 'agora';
let diaDiario = 0; // 0 = hoje, -1 = ontem...
let burpAvisado = false; // já avisou que a meta de arroto foi atingida?

/* ================================================================ utilidades */

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2600);
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

function vibrar(ms = 12) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function openSheet(titulo, conteudo) {
  $('#sheetTitle').textContent = titulo;
  const body = $('#sheetBody');
  body.innerHTML = '';
  body.append(conteudo);
  $('#sheetBackdrop').hidden = false;
}

function closeSheet() {
  $('#sheetBackdrop').hidden = true;
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    toast('Copiado!');
  } catch {
    const ta = el('textarea');
    ta.value = texto;
    ta.className = 'field';
    openSheet('Copie o texto', ta);
    ta.select();
  }
}

/* ================================================================ navegação */

function irPara(view) {
  viewAtual = view;
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${view}`; });
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  $('#topTitle').textContent = TITULOS[view];
  window.scrollTo({ top: 0 });
  render();
}

/* ================================================================ AGORA */

function cartaoProximo({ emoji, titulo, sub, at, onClick }) {
  const card = el('button', 'next');
  const info = countdown(at);
  if (info.state !== 'ok') card.classList.add(info.state === 'late' ? 'is-late' : 'is-due');
  card.append(el('div', 'emoji', emoji));
  const corpo = el('div', 'next-body');
  corpo.append(el('div', 'next-title', titulo), el('div', 'next-sub', sub));
  card.append(corpo, el('div', 'next-when', info.label));
  card.addEventListener('click', onClick);
  return card;
}

/** Card com o cronômetro de arroto, no topo do Agora enquanto está ativo. */
function cardArroto() {
  const b = state.activeBurp;
  const decorrido = Date.now() - b.startAt;
  const min = Math.floor(decorrido / MS_MIN);
  const seg = Math.floor(decorrido / 1000) % 60;
  const atingiu = min >= BURP_TARGET_MIN;

  const card = el('div', 'card timer-card');
  if (atingiu) card.classList.add('is-done');
  card.append(el('p', 'muted', `Arroto · começou ${fmtTime(b.startAt)} · meta ${BURP_TARGET_MIN} min`));
  card.append(el('div', 'timer', `${pad(min)}:${pad(seg)}`));
  card.append(el('p', atingiu ? 'burp-meta is-done' : 'burp-meta',
    atingiu ? '✅ Meta de 20 min atingida' : `Faltam ${fmtMin(BURP_TARGET_MIN - min)}`));

  const linha = el('div', 'row-2');
  const fim = el('button', 'btn btn-primary', 'Finalizar arroto');
  fim.addEventListener('click', () => {
    const ev = S.finishBurp();
    burpAvisado = false;
    vibrar();
    if (ev) toast(`Arroto de ${fmtMin(ev.durationMin)} registrado`);
  });
  const cancelar = el('button', 'btn btn-ghost', 'Cancelar');
  cancelar.addEventListener('click', () => {
    if (confirm('Cancelar este arroto sem registrar?')) { S.cancelBurp(); burpAvisado = false; }
  });
  linha.append(fim, cancelar);
  card.append(linha);
  return card;
}

/** Duração longa como H:MM (para o sono). */
function fmtHM(ms) {
  const totalMin = Math.floor(ms / MS_MIN);
  return `${Math.floor(totalMin / 60)}:${pad(totalMin % 60)}`;
}

/** Card com o cronômetro de sono (quando o bebê está dormindo). */
function cardSonoAtivo() {
  const s = state.activeSleep;
  const card = el('div', 'card timer-card sono-card');
  card.append(el('p', 'muted', `😴 Dormindo desde ${fmtTime(s.startAt)}`));
  card.append(el('div', 'timer', fmtHM(Date.now() - s.startAt)));
  const btn = el('button', 'btn btn-primary block', 'Acordou');
  btn.addEventListener('click', () => {
    const ev = S.toggleSleep();
    vibrar();
    if (ev) toast(`Acordou · dormiu ${fmtMin((ev.endAt - ev.at) / MS_MIN)}`);
  });
  card.append(btn);
  return card;
}

/** Card de janela de sono / próxima soneca (quando acordado). Toque = iniciar sono. */
function cardJanelaSono() {
  const nap = S.nextNap();
  if (!nap) return null;
  const agora = Date.now();
  const acordado = fmtGap(agora - nap.wake);
  const w = nap.window;

  let titulo; let sub; let quando; let estado = '';
  if (agora < nap.start) {
    titulo = 'Próxima soneca';
    sub = `acordado há ${acordado} · janela ${w.min}–${w.max}min`;
    quando = `~${fmtTime(nap.start)}`;
  } else if (agora < nap.end) {
    titulo = 'Hora da soneca 🌙';
    sub = `acordado há ${acordado} · janela até ${fmtTime(nap.end)}`;
    quando = 'agora';
    estado = 'is-due';
  } else {
    titulo = 'Passou da janela';
    sub = `acordado há ${acordado} · pode estar cansado`;
    quando = `+${fmtGap(agora - nap.end)}`;
    estado = 'is-late';
  }

  const card = el('button', `next ${estado}`);
  card.append(el('div', 'emoji', '🌙'));
  const corpo = el('div', 'next-body');
  corpo.append(el('div', 'next-title', titulo), el('div', 'next-sub', sub));
  card.append(corpo, el('div', 'next-when', quando));
  card.addEventListener('click', () => {
    S.toggleSleep();
    vibrar();
    toast('Sono iniciado — toque em Acordou quando acordar');
  });
  return card;
}

/** Barra "sono do dia vs. recomendado para a idade". */
function renderSleepBar(container, ref = new Date()) {
  container.innerHTML = '';
  const min = S.daySummary(ref).minutosDormindo;
  const rec = S.recommendedSleepH();
  const alvoMin = rec.min * 60;
  const frac = Math.min(1, alvoMin ? min / alvoMin : 0);
  const atingiu = min >= alvoMin;

  const card = el('div', 'card sleepbar');
  const topo = el('div', 'sleepbar-top');
  topo.append(
    el('span', null, '😴 Sono do dia'),
    el('strong', null, `${fmtMin(min)} <span class="muted">/ ~${rec.min}–${rec.max}h</span>`),
  );
  card.append(topo);
  const trilho = el('div', 'sleepbar-track');
  const barra = el('div', `sleepbar-fill${atingiu ? ' is-done' : ''}`);
  barra.style.width = `${Math.round(frac * 100)}%`;
  trilho.append(barra);
  card.append(trilho);
  container.append(card);
}

/** Relógio do dia (24h): sono como arcos, mamadas como marcas. */
function renderRelogioDia(container, ref = new Date()) {
  container.innerHTML = '';
  const [inicio, fim] = S.dayBounds(ref);
  const eventos = S.eventsBetween(inicio, fim);
  const cx = 100;
  const cy = 100;
  const r = 74;
  const NS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('class', 'clock');

  const ang = (t) => ((t - inicio) / (24 * MS_HOUR)) * 360 - 90;
  const ponto = (raio, deg) => {
    const a = (deg * Math.PI) / 180;
    return [cx + raio * Math.cos(a), cy + raio * Math.sin(a)];
  };
  const add = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    svg.append(e);
    return e;
  };

  add('circle', { cx, cy, r, class: 'clock-track' });
  // marcas de hora (0/6/12/18)
  [0, 6, 12, 18].forEach((h) => {
    const [x1, y1] = ponto(r - 6, h * 15 - 90);
    const [x2, y2] = ponto(r + 6, h * 15 - 90);
    add('line', { x1, y1, x2, y2, class: 'clock-tick' });
    const [tx, ty] = ponto(r + 15, h * 15 - 90);
    const t = add('text', { x: tx, y: ty, class: 'clock-h' });
    t.textContent = `${h}h`;
  });

  // arcos de sono (segmentos já recortados no dia; inclui sono vindo da véspera)
  S.sleepSegmentsInDay(ref).forEach((seg) => {
    const a1 = ang(seg.at);
    const a2 = ang(seg.endAt);
    if (a2 - a1 < 0.5) return;
    const [x1, y1] = ponto(r, a1);
    const [x2, y2] = ponto(r, a2);
    const grande = a2 - a1 > 180 ? 1 : 0;
    add('path', { d: `M ${x1} ${y1} A ${r} ${r} 0 ${grande} 1 ${x2} ${y2}`, class: 'clock-sleep' });
  });

  // mamadas como pontinhos
  eventos.filter((e) => e.type === 'feed').forEach((e) => {
    const [x, y] = ponto(r, ang(e.at));
    add('circle', { cx: x, cy: y, r: 3.2, class: 'clock-feed' });
  });

  // centro: total de sono do dia
  const totalMin = S.daySummary(ref).minutosDormindo;
  const centro = add('text', { x: cx, y: cy - 4, class: 'clock-total' });
  centro.textContent = fmtMin(totalMin);
  const rot = add('text', { x: cx, y: cy + 14, class: 'clock-label' });
  rot.textContent = 'de sono';

  container.append(svg);
  const legenda = el('div', 'clock-legend');
  legenda.innerHTML = '<span><i class="dot sleep"></i>sono</span><span><i class="dot feed"></i>mamada</span>';
  container.append(legenda);
}

/** O evento em destaque no centro do herói: o próximo mais relevante. */
function heroFoco() {
  if (state.activeFeed) return { label: 'Mamando agora', big: `desde ${fmtTime(state.activeFeed.startAt)}`, tone: 'lamp' };
  if (state.activeSleep) return { label: 'Dormindo', big: fmtHM(Date.now() - state.activeSleep.startAt), tone: 'sleep', at: state.activeSleep.startAt };
  const cand = [];
  const feed = S.nextFeedAt();
  if (feed) cand.push({ at: feed, label: 'Próxima mamada', tone: 'lamp' });
  const nap = S.nextNap();
  if (nap) cand.push({ at: nap.start, label: 'Próxima soneca', tone: 'sleep' });
  if (!cand.length) return { label: 'Vamos começar', big: 'registre', tone: 'sleep' };
  cand.sort((a, b) => a.at - b.at);
  const c = cand[0];
  const info = countdown(c.at);
  const big = info.state === 'due' ? 'agora' : info.state === 'late' ? 'atrasada' : info.label;
  return { label: c.label, big, tone: c.tone, at: c.at };
}

function focusChip(emoji, tone, label, valor) {
  const c = el('div', 'fchip');
  c.append(el('div', `chip tint-${tone}`, emoji));
  const corpo = el('div', 'fchip-b');
  corpo.append(el('span', null, label), el('b', null, valor));
  c.append(corpo);
  return c;
}

/* ---------- Herói: timeline circular de 24h (SVG) ----------
 * Geometria fixa; a estrutura é montada uma vez e o tick só reposiciona o
 * marcador de "agora" e reescreve o texto central — assim as animações de
 * entrada não se repetem a cada segundo. Toda a lógica de dados/estados
 * (heroFoco, sono, mamadas, marcador de agora) é preservada. */
const HERO_NS = 'http://www.w3.org/2000/svg';
/**
 * Geometria da órbita: 24h = 360°, cada minuto vira um ângulo proporcional.
 * A trilha de fundo e os períodos usam o MESMO raio e a MESMA espessura — o
 * sono preenche o próprio traço do dia, em vez de flutuar sobre uma linha fina.
 */
const HERO = {
  vb: 280, cx: 140, cy: 140,
  R: 88,           // linha central da órbita
  faixa: 12,       // espessura da trilha das 24h (períodos acordada)
  faixaSono: 15,   // períodos de sono: preenchem a trilha e ficam mais grossos
  rMarca: 16,      // marcador principal (mamada) — ~36px em tela
  rMarcaMin: 9.5,  // marcadores secundários (acordou / arroto)
};
HERO.rLabel = HERO.R + HERO.rMarca + 8;

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(HERO_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function heroPonto(raio, deg) {
  const a = (deg * Math.PI) / 180;
  return [HERO.cx + raio * Math.cos(a), HERO.cy + raio * Math.sin(a)];
}
function heroAng(t, inicio) { return ((t - inicio) / (24 * MS_HOUR)) * 360 - 90; }

/** Path de um arco da órbita entre dois ângulos (graus). */
function heroArcoD(a1, a2, raio) {
  const [x1, y1] = heroPonto(raio, a1); const [x2, y2] = heroPonto(raio, a2);
  return `M ${x1} ${y1} A ${raio} ${raio} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/**
 * Âncora do rótulo conforme o quadrante: nas laterais o texto "sai" da órbita
 * (start/end) e no topo/base fica centrado — assim ele acompanha o círculo.
 */
function heroAnchor(deg) {
  const ux = Math.cos((deg * Math.PI) / 180);
  if (ux > 0.3) return 'start';
  if (ux < -0.3) return 'end';
  return 'middle';
}

/** Mantém só itens separados por `minGap` graus (recebe ordenado por prioridade). */
function heroSepara(itens, minGap) {
  const postos = [];
  for (const it of itens) {
    const livre = postos.every((p) => {
      const d = Math.abs(p.deg - it.deg) % 360;
      return Math.min(d, 360 - d) >= minGap;
    });
    if (livre) postos.push(it);
  }
  return postos;
}

/* ---------- ícones (caixa ~14 unidades, centrados em 0,0) ---------- */
function icMamadeira() {
  const g = svgEl('g', { class: 'hero-ic' });
  g.append(
    svgEl('rect', { x: -1.9, y: -7.6, width: 3.8, height: 2.7, rx: 1.35 }), // bico
    svgEl('rect', { x: -3.5, y: -5.3, width: 7, height: 1.9, rx: 0.95 }),   // colar
    svgEl('rect', { x: -3.9, y: -3.2, width: 7.8, height: 9.9, rx: 2.7 }),  // corpo
    svgEl('line', { x1: -1.7, y1: -0.2, x2: 1.3, y2: -0.2, class: 'hero-ic-line' }),
    svgEl('line', { x1: -1.7, y1: 2.5, x2: 1.3, y2: 2.5, class: 'hero-ic-line' }),
  );
  return g;
}
function icLua() {
  const g = svgEl('g', { class: 'hero-ic' });
  g.append(svgEl('path', { d: 'M 3.6 -4.8 A 6 6 0 1 0 3.6 4.8 A 5 5 0 1 1 3.6 -4.8 Z' }));
  return g;
}
function icAcordou() {
  const g = svgEl('g', { class: 'hero-ic' });
  g.append(svgEl('circle', { r: 2.9 }));
  for (let i = 0; i < 8; i += 1) {
    const a = (i * 45 * Math.PI) / 180;
    g.append(svgEl('line', {
      x1: Math.cos(a) * 4.7, y1: Math.sin(a) * 4.7,
      x2: Math.cos(a) * 6.5, y2: Math.sin(a) * 6.5, class: 'hero-ic-ray',
    }));
  }
  return g;
}
function icArroto() {
  const g = svgEl('g', { class: 'hero-ic' });
  g.append(
    svgEl('circle', { cx: -2.9, cy: 2.9, r: 1.8 }),
    svgEl('circle', { cx: 0.4, cy: -0.2, r: 2.4 }),
    svgEl('circle', { cx: 3.4, cy: -3.2, r: 1.4 }),
  );
  return g;
}
const HERO_ICONE = { feed: icMamadeira, sleep: icLua, wake: icAcordou, burp: icArroto };

/** Marcador composto (halo + disco + anel + ícone), centrado na linha da órbita. */
function heroMarcador({ tipo, r = HERO.rMarca, escala = 1.2, ghost = false, i = 0 }) {
  const g = svgEl('g', { class: `hero-mark hero-mark--${tipo}${ghost ? ' is-ghost' : ''}`, style: `--i:${i}` });
  g.append(svgEl('circle', { r, class: 'mk-halo' }));
  g.append(svgEl('circle', { r: r * 0.75, class: 'mk-disc' }));
  g.append(svgEl('circle', { r: r * 0.75, class: 'mk-ring' }));
  const ic = (HERO_ICONE[tipo] || icMamadeira)();
  ic.setAttribute('transform', `scale(${escala})`);
  g.append(ic);
  return g;
}

/** Monta o SVG do herói do zero (só quando os dados mudam). */
function montarHero(container, { foco, inicio, fim, feeds, segs, burps }) {
  container.innerHTML = '';
  const cor = foco.tone === 'lamp' ? 'var(--accent)' : 'var(--sleep)';
  const { cx, cy, R, faixa, rLabel, vb } = HERO;
  const svg = svgEl('svg', { viewBox: `0 0 ${vb} ${vb}`, class: 'hero-ring is-enter' });

  const defs = svgEl('defs');
  defs.innerHTML = '<linearGradient id="heroSleepGrad" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" style="stop-color:var(--sleep,#bab4ff);stop-opacity:1"/>'
    + '<stop offset="1" style="stop-color:var(--sleep,#bab4ff);stop-opacity:.9"/></linearGradient>';
  svg.append(defs);

  // trilha das 24h: faixa espessa e contínua (a timeline em si)
  svg.append(svgEl('circle', { cx, cy, r: R, class: 'hero-track' }));

  // micro-partículas de hora, logo fora da faixa
  const rDot = R + HERO.faixaSono / 2 + 4;
  for (let h = 0; h < 24; h += 1) {
    const [x, y] = heroPonto(rDot, (h / 24) * 360 - 90);
    const marco = h % 6 === 0;
    svg.append(svgEl('circle', { cx: x, cy: y, r: marco ? 1.1 : 0.7, class: marco ? 'hero-dot6' : 'hero-dot' }));
  }

  // períodos de sono: preenchem a MESMA faixa (vários intervalos coexistem)
  segs.forEach((seg, i) => {
    const a1 = heroAng(seg.at, inicio); const a2 = heroAng(seg.endAt, inicio);
    if (a2 - a1 < 0.6) return;
    svg.append(svgEl('path', { d: heroArcoD(a1, a2, R), class: 'hero-sleep', style: `--i:${i}` }));
  });

  // sono EM ANDAMENTO: mesmo lavanda, crescendo até "agora" (atualizado no tick),
  // para que "roxo = dormindo" valha também durante a soneca atual.
  const liveArc = state.activeSleep ? svgEl('path', { class: 'hero-sleep is-live', d: '' }) : null;
  if (liveArc) svg.append(liveArc);

  // eventos pontuais sobre a órbita (prioridade: próximo > mamada > acordou > arroto)
  const marcas = [];
  const focoNoDia = foco.at && foco.at >= inicio && foco.at < fim;
  if (focoNoDia) {
    marcas.push({
      deg: heroAng(foco.at, inicio), t: foco.at, prio: 0, ghost: true,
      tipo: foco.tone === 'lamp' ? 'feed' : 'sleep', r: HERO.rMarca, escala: 1.2,
    });
  }
  feeds.forEach((e) => marcas.push({ deg: heroAng(e.at, inicio), t: e.at, prio: 1, tipo: 'feed', r: HERO.rMarca, escala: 1.2 }));
  segs.forEach((s) => {
    if (s.endAt >= fim - 1000) return; // fim de dia não é "acordou"
    marcas.push({ deg: heroAng(s.endAt, inicio), t: s.endAt, prio: 2, tipo: 'wake', r: HERO.rMarcaMin, escala: 0.75 });
  });
  burps.forEach((e) => marcas.push({ deg: heroAng(e.at, inicio), t: e.at, prio: 3, tipo: 'burp', r: HERO.rMarcaMin, escala: 0.75 }));
  marcas.sort((a, b) => a.prio - b.prio);
  const postas = heroSepara(marcas, 21).sort((a, b) => a.deg - b.deg);
  postas.forEach((m, i) => {
    const [x, y] = heroPonto(R, m.deg);
    const holder = svgEl('g', { transform: `translate(${x} ${y})` });
    holder.append(heroMarcador({ ...m, i }));
    svg.append(holder);
  });

  // horários: sempre atrelados a um evento (marcador ou início de soneca)
  const cands = postas.map((m) => ({ deg: m.deg, t: m.t, prio: m.prio, foco: !!m.ghost }))
    .concat(segs.map((s) => ({ deg: heroAng(s.at, inicio), t: s.at, prio: 5, lead: true })));
  cands.sort((a, b) => a.prio - b.prio);
  heroSepara(cands, 15).forEach((L) => {
    if (L.lead) { // sem marcador: um fio curtinho liga o texto à faixa
      const [g1x, g1y] = heroPonto(R + HERO.faixaSono / 2 + 2, L.deg);
      const [g2x, g2y] = heroPonto(R + HERO.faixaSono / 2 + 8, L.deg);
      svg.append(svgEl('line', { x1: g1x, y1: g1y, x2: g2x, y2: g2y, class: 'hero-lead' }));
    }
    const [lx, ly] = heroPonto(rLabel, L.deg);
    const txt = svgEl('text', {
      x: lx, y: ly, class: `hero-tlabel${L.foco ? ' is-foco' : ''}`,
      'text-anchor': heroAnchor(L.deg), 'dominant-baseline': 'middle',
    });
    txt.textContent = fmtTime(L.t);
    svg.append(txt);
  });

  // AGORA: cabeçote cruzando a faixa (desenhado no topo e rotacionado no tick)
  const nowG = svgEl('g', { class: 'hero-now-g' });
  const [n1x, n1y] = heroPonto(R - HERO.faixaSono / 2 - 2.5, -90);
  const [n2x, n2y] = heroPonto(R + HERO.faixaSono / 2 + 2.5, -90);
  nowG.append(svgEl('circle', { cx, cy: cy - R, r: 9, class: 'hero-now-pulse' }));
  nowG.append(svgEl('line', { x1: n1x, y1: n1y, x2: n2x, y2: n2y, class: 'hero-now-tick' }));
  nowG.append(svgEl('circle', { cx, cy: cy - R, r: 3.2, class: 'hero-now-dot' }));
  svg.append(nowG);

  // centro (hierarquia: rótulo secundário · número principal · horário secundário)
  const tl = svgEl('text', { x: cx, y: cy - 15, class: 'hero-label', 'text-anchor': 'middle' });
  const tb = svgEl('text', { x: cx, y: cy + 7, class: 'hero-big', 'text-anchor': 'middle', fill: cor });
  const ts = svgEl('text', { x: cx, y: cy + 25, class: 'hero-sub', 'text-anchor': 'middle' });
  svg.append(tl, tb, ts);

  container.append(svg);
  container.__nowG = nowG; container.__tl = tl; container.__tb = tb; container.__ts = ts;
  container.__liveArc = liveArc;
}

/** Atualiza só o que muda a cada segundo (posição do "agora" + centro). */
function atualizarHero(container, { foco, inicio }) {
  if (container.__liveArc && state.activeSleep) {
    const ini = Math.max(state.activeSleep.startAt, inicio);
    const a1 = heroAng(ini, inicio);
    const a2 = Math.max(heroAng(Date.now(), inicio), a1 + 0.8); // sempre visível
    container.__liveArc.setAttribute('d', heroArcoD(a1, a2, HERO.R));
  }
  if (container.__nowG) {
    container.__nowG.setAttribute('transform', `rotate(${heroAng(Date.now(), inicio) + 90} ${HERO.cx} ${HERO.cy})`);
  }
  if (container.__tl) container.__tl.textContent = foco.label;
  if (container.__tb) container.__tb.textContent = foco.big;
  if (container.__ts) container.__ts.textContent = foco.at ? fmtTime(foco.at) : '';
}

/** Herói da Home: timeline circular do dia + chips de foco. */
function renderHero(container) {
  const foco = heroFoco();
  const [inicio, fim] = S.dayBounds();
  const doDia = S.eventsBetween(inicio, fim);
  const feeds = doDia.filter((e) => e.type === 'feed');
  const burps = doDia.filter((e) => e.type === 'burp');
  const segs = S.sleepSegmentsInDay();

  // Assinatura do que é "estático" (tudo menos o segundo atual).
  const sig = JSON.stringify({
    l: foco.label, tone: foco.tone, at: foco.at || 0, i: inicio,
    f: feeds.map((e) => e.at), b: burps.map((e) => e.at),
    s: segs.map((x) => [x.at, x.endAt]),
    sl: !!state.activeSleep, fe: !!state.activeFeed,
  });
  if (container.__sig !== sig) {
    container.__sig = sig;
    montarHero(container, { foco, inicio, fim, feeds, segs, burps });
  }
  atualizarHero(container, { foco, inicio });

  // Chips de foco (baratos) — reconstruídos sempre, sem animação.
  const antigo = container.querySelector('.focus-chips');
  if (antigo) antigo.remove();
  const chips = el('div', 'focus-chips');
  const ultima = S.lastEvent('feed');
  chips.append(focusChip('🍼', 'lamp', 'Última mamada', ultima ? fmtTime(ultima.at) : '—'));
  if (state.activeSleep) chips.append(focusChip('😴', 'sleep', 'Dormindo há', fmtGap(Date.now() - state.activeSleep.startAt)));
  else { const wake = S.lastWakeAt(); chips.append(focusChip('🌙', 'sleep', 'Acordado há', wake ? fmtGap(Date.now() - wake) : '—')); }
  container.append(chips);
}

function renderAgora() {
  renderHero($('#hero'));

  const cards = $('#nextCards');
  cards.innerHTML = '';
  if (state.activeBurp) cards.append(cardArroto());
  if (state.activeSleep) cards.append(cardSonoAtivo());
  if (state.activeFeed) {
    cards.append(cartaoProximo({
      emoji: '🍼', titulo: 'Mamando agora',
      sub: `Lado ${SIDE_LABEL[state.activeFeed.side]} · desde ${fmtTime(state.activeFeed.startAt)}`,
      at: Date.now(), onClick: () => irPara('mamada'),
    }));
  }

  // — próximos alertas (remédios, consultas…) —
  state.meds
    .map((m) => ({ med: m, at: S.nextAlertAt(m) }))
    .filter(({ at }) => at != null)
    .sort((a, b) => a.at - b.at)
    .slice(0, 3)
    .forEach(({ med, at }) => {
      cards.append(cartaoProximo({
        emoji: catInfo(med.category).emoji, titulo: med.name,
        sub: `${fmtDateTime(at)}${med.repeat ? ` · ${repeatLabel(med)}` : ''}${med.dose ? ` · ${med.dose}` : ''}`,
        at, onClick: () => irPara('remedios'),
      }));
    });

  $('#quickSonoLabel').textContent = state.activeSleep ? 'Acordou' : 'Dormiu';
  $('#quickArrotoLabel').textContent = state.activeBurp ? 'Encerrar' : 'Arroto';

  renderResumo($('#todayGrid'), S.daySummary());
  renderSleepBar($('#sleepBar'));

  const recentes = $('#recentList');
  recentes.innerHTML = '';
  const ultimos = state.events.filter((e) => !e.deleted).slice(-6).reverse();
  if (!ultimos.length) recentes.append(el('p', 'empty', 'Ainda nada registrado hoje.'));
  else ultimos.forEach((ev) => recentes.append(linhaEvento(ev)));
}

function renderResumo(grid, resumo) {
  grid.innerHTML = '';
  const stats = [
    ['🍼', resumo.mamadas, 'mamadas'],
    ['💧', resumo.xixis, 'xixis'],
    ['💩', resumo.cocos, 'cocôs'],
    ['💨', resumo.arrotos, 'arrotos'],
    ['😴', resumo.minutosDormindo ? fmtMin(resumo.minutosDormindo) : '0', 'sono'],
  ];
  stats.forEach(([emoji, valor, rotulo]) => {
    const stat = el('div', 'stat');
    stat.append(el('b', null, String(valor)), el('span', null, `${emoji} ${rotulo}`));
    grid.append(stat);
  });
}

/* ================================================================ linhas de evento */

const EVENTO_EMOJI = { feed: '🍼', diaper: '💧', sleep: '😴', med: '💊', burp: '💨', note: '📝' };

function tituloEvento(ev) {
  switch (ev.type) {
    case 'feed': return 'Mamada';
    case 'diaper': return `Fralda · ${ev.kind}`;
    case 'sleep': return 'Sono';
    case 'med': return ev.name;
    case 'burp': return 'Arroto';
    default: return 'Anotação';
  }
}

function subtituloEvento(ev) {
  switch (ev.type) {
    case 'feed': return describeFeed(ev);
    case 'sleep': return ev.endAt
      ? `${fmtMin((ev.endAt - ev.at) / MS_MIN)} · até ${fmtTime(ev.endAt)}`
      : 'em andamento';
    case 'med': return ev.dose || 'dose tomada';
    case 'burp': return ev.durationMin ? `${fmtMin(ev.durationMin)} no colo` : 'arrotou';
    case 'note': return ev.text || '';
    default: return '';
  }
}

const EVENTO_TONE = { feed: 'lamp', sleep: 'sleep', burp: 'leaf', med: 'med', diaper: 'aqua', note: '' };

/** Categorias dos alertas (picklist do cadastro). O id é o que fica salvo. */
const CATEGORIAS = [
  { id: 'remedio', label: 'Remédio', emoji: '💊', tint: 'med' },
  { id: 'vacina', label: 'Vacina', emoji: '💉', tint: 'aqua' },
  { id: 'consulta', label: 'Consulta', emoji: '🩺', tint: 'sleep' },
  { id: 'alimentacao', label: 'Alimentação', emoji: '🍼', tint: 'lamp' },
  { id: 'higiene', label: 'Higiene', emoji: '🧴', tint: 'leaf' },
  { id: 'outro', label: 'Outro', emoji: '🔔', tint: 'plain' },
];
const catInfo = (id) => CATEGORIAS.find((c) => c.id === id) || CATEGORIAS[0];

const UNIDADES = [
  { id: 'hour', label: 'horas', sing: 'hora' },
  { id: 'day', label: 'dias', sing: 'dia' },
  { id: 'week', label: 'semanas', sing: 'semana' },
  { id: 'month', label: 'meses', sing: 'mês' },
];

/** "a cada 8h" · "a cada 2 dias" · "uma vez" (sem repetição). */
function repeatLabel(med) {
  if (!med.repeat) return 'uma vez';
  const { every, unit } = med.repeat;
  if (unit === 'hour') return `a cada ${every}h`;
  const u = UNIDADES.find((x) => x.id === unit) || UNIDADES[0];
  return `a cada ${every === 1 ? '' : `${every} `}${every === 1 ? u.sing : u.label}`;
}

function linhaEvento(ev, { apagavel = true } = {}) {
  const item = el('div', 'item');
  let emoji = ev.type === 'diaper' && ev.kind !== 'xixi' ? '💩' : EVENTO_EMOJI[ev.type] || '•';
  let tint = EVENTO_TONE[ev.type] || 'plain';
  if (ev.type === 'med') { const c = catInfo(ev.category); emoji = c.emoji; tint = c.tint; }
  item.append(el('div', `emoji tint-${tint}`, emoji));
  const corpo = el('div', 'item-body');
  corpo.append(el('div', 'item-title', tituloEvento(ev)), el('div', 'item-sub', subtituloEvento(ev)));
  item.append(corpo, el('div', 'item-time', fmtTime(ev.at)));
  // Sono já concluído: toque para editar o horário (e, com isso, a duração).
  if (ev.type === 'sleep' && ev.endAt) {
    item.classList.add('editavel');
    corpo.setAttribute('role', 'button');
    corpo.setAttribute('tabindex', '0');
    corpo.addEventListener('click', () => sheetSono(ev));
    corpo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sheetSono(ev); } });
    const editar = el('button', 'item-edit', '✎');
    editar.title = 'Editar sono';
    editar.addEventListener('click', () => sheetSono(ev));
    item.append(editar);
  }
  if (apagavel) {
    const del = el('button', 'item-del', '✕');
    del.title = 'Apagar registro';
    del.addEventListener('click', () => {
      if (confirm('Apagar este registro?')) {
        S.removeEvent(ev.id);
        toast('Registro apagado');
      }
    });
    item.append(del);
  }
  return item;
}

/* ================================================================ MAMADA */

function renderMamada() {
  const ativa = state.activeFeed;
  const timer = $('#feedTimer');
  const hint = $('#feedHint');

  if (ativa) {
    const total = Date.now() - ativa.startAt;
    timer.textContent = `${pad(Math.floor(total / MS_MIN))}:${pad(Math.floor(total / 1000) % 60)}`;
    hint.textContent = `Começou às ${fmtTime(ativa.startAt)} · lado ${SIDE_LABEL[ativa.side]}`;
  } else {
    timer.textContent = '00:00';
    const proxima = S.nextFeedAt();
    const lado = S.nextSide();
    hint.textContent = proxima
      ? `Próxima ${fmtTime(proxima)} (${countdown(proxima).label})${lado ? ` · comece pelo ${SIDE_LABEL[lado]}` : ''}`
      : 'Toque em um lado para começar a contar';
  }

  const minutosPorLado = {};
  if (ativa) {
    ativa.segments.forEach((s) => { minutosPorLado[s.side] = (minutosPorLado[s.side] || 0) + s.ms; });
    minutosPorLado[ativa.side] = (minutosPorLado[ativa.side] || 0) + (Date.now() - ativa.segStart);
  }
  const sugerido = ativa ? null : S.nextSide();

  $$('.side-btn').forEach((btn) => {
    const side = btn.dataset.side;
    const ativo = ativa ? ativa.side === side : sugerido === side;
    btn.classList.toggle('is-active', ativo);
    const min = minutosPorLado[side] ? Math.round(minutosPorLado[side] / MS_MIN) : 0;
    btn.innerHTML = `${side === 'E' ? 'Esquerdo' : 'Direito'}<span class="side-min">${
      ativa ? `${min} min` : (sugerido === side ? 'sugerido' : '')}</span>`;
  });

  $('#btnFeedFinish').hidden = !ativa;
  $('#btnFeedCancel').hidden = !ativa;
  $('#btnFeedManual').hidden = !!ativa;

  const foco = $('#feedFocus');
  foco.innerHTML = '';
  const ultima = S.lastEvent('feed');
  const prox = S.nextFeedAt();
  foco.append(focusChip('🍼', 'lamp', 'Última mamada', ultima ? fmtTime(ultima.at) : '—'));
  foco.append(focusChip('⏰', 'sleep', 'Próxima', prox ? fmtTime(prox) : '—'));

  const lista = $('#feedList');
  lista.innerHTML = '';
  const feeds = S.daySummary().eventos.filter((e) => e.type === 'feed').reverse();
  if (!feeds.length) lista.append(el('p', 'empty', 'Nenhuma mamada registrada hoje.'));
  feeds.forEach((ev) => lista.append(linhaEvento(ev)));
}

function sheetMamadaManual() {
  const form = el('form');
  form.innerHTML = `
    <label class="field"><span>Começou às</span>
      <input type="datetime-local" name="at" value="${toLocalInput(Date.now() - 30 * MS_MIN)}" required></label>
    <label class="field"><span>Duração (minutos)</span>
      <input type="number" name="min" value="20" min="1" max="240" inputmode="numeric" required></label>
    <label class="field"><span>Lado</span>
      <select name="side"><option value="E">Esquerdo</option><option value="D">Direito</option>
      <option value="ambos">Os dois</option><option value="mamadeira">Mamadeira</option></select></label>
    <button class="btn btn-primary block" type="submit">Salvar mamada</button>`;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const dados = new FormData(form);
    const at = fromLocalInput(dados.get('at'));
    if (!at) return;
    const min = Math.max(1, Number(dados.get('min')) || 1);
    const side = dados.get('side');
    const sides = side === 'E' || side === 'D' ? { [side]: min } : {};
    S.addEvent({
      type: 'feed', at, endAt: at + min * MS_MIN, durationMin: min, sides,
      lastSide: side === 'E' || side === 'D' ? side : null,
    });
    closeSheet();
    toast('Mamada registrada');
  });
  openSheet('Registrar mamada passada', form);
}

/**
 * Registrar (ev = null) ou editar um sono, ajustando início/fim — a duração e
 * os totais do dia vêm daí. Sono que cruza a meia-noite é dividido entre os dias.
 */
function sheetSono(ev = null) {
  const inicioPadrao = ev ? ev.at : Date.now() - 2 * MS_HOUR;
  const fimPadrao = ev ? (ev.endAt || ev.at) : Date.now() - 30 * MS_MIN;
  const form = el('form');
  form.innerHTML = `
    <label class="field"><span>Começou a dormir</span>
      <input type="datetime-local" name="at" value="${toLocalInput(inicioPadrao)}" required></label>
    <label class="field"><span>Acordou</span>
      <input type="datetime-local" name="end" value="${toLocalInput(fimPadrao)}" required></label>
    <p class="muted small" id="sonoDur" aria-live="polite"></p>
    <button class="btn btn-primary block" type="submit">Salvar sono</button>
    ${ev ? '<button class="btn btn-ghost block" type="button" id="sonoDel">Apagar registro</button>' : ''}`;

  const aviso = form.querySelector('#sonoDur');
  const lerHoras = () => ({ at: fromLocalInput(form.at.value), end: fromLocalInput(form.end.value) });
  const recalcular = () => {
    const { at, end } = lerHoras();
    if (at && end && end > at) aviso.textContent = `Dormiu ${fmtMin((end - at) / MS_MIN)}.`;
    else aviso.textContent = 'A hora de acordar precisa ser depois da de dormir.';
  };
  form.at.addEventListener('input', recalcular);
  form.end.addEventListener('input', recalcular);
  recalcular();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { at, end } = lerHoras();
    if (!at || !end || end <= at) { toast('Confira os horários'); return; }
    if (ev) S.updateEvent(ev.id, { at, endAt: end });
    else S.addEvent({ type: 'sleep', at, endAt: end });
    closeSheet();
    toast(`${ev ? 'Sono atualizado' : 'Sono registrado'} · ${fmtMin((end - at) / MS_MIN)}`);
  });
  const del = form.querySelector('#sonoDel');
  if (del) del.addEventListener('click', () => {
    if (confirm('Apagar este sono?')) { S.removeEvent(ev.id); closeSheet(); toast('Registro apagado'); }
  });
  openSheet(ev ? 'Editar sono' : 'Registrar sono passado', form);
}

/* ================================================================ REMÉDIOS */

function renderRemedios() {
  const lista = $('#medList');
  lista.innerHTML = '';
  if (!state.meds.length) {
    lista.append(el('p', 'empty', 'Nenhum alerta cadastrado.'));
    return;
  }

  state.meds.forEach((med) => {
    const cat = catInfo(med.category);
    const card = el('div', 'card med');
    const head = el('div', 'med-head');
    head.append(el('div', `chip tint-${cat.tint}`, cat.emoji));
    const texto = el('div', 'med-head-text');
    texto.append(
      el('div', 'med-name', med.name),
      el('div', 'med-meta', `${cat.label} · ${repeatLabel(med)}${med.dose ? ` · ${med.dose}` : ''}`),
    );
    head.append(texto);
    card.append(head);

    const dose = S.lastDose(med.id);
    const prox = S.nextAlertAt(med);
    const quando = el('div', 'med-when');
    if (prox) {
      const info = countdown(prox);
      if (info.state !== 'ok') quando.classList.add(info.state === 'late' ? 'is-late' : 'is-due');
      const ultimo = dose ? ` · último ${fmtDateTime(dose.at)}` : '';
      quando.textContent = `Próximo ${fmtDateTime(prox)} (${info.label})${ultimo}`;
    } else {
      quando.textContent = dose ? `Concluído · ${fmtDateTime(dose.at)}` : 'Sem data definida';
    }
    card.append(quando);

    const acoes = el('div', 'med-actions');
    // Data marcada (sem repetição): "Concluir" registra e encerra o alerta.
    const rotulo = med.repeat ? 'Registrei agora' : 'Concluir';
    const tomar = el('button', 'btn btn-primary', rotulo);
    tomar.addEventListener('click', () => {
      S.takeMed(med);
      if (!med.repeat) S.saveMed({ id: med.id, active: false }); // one-off vira concluído
      vibrar();
      toast(`${med.name} registrado às ${fmtTime(Date.now())}`);
    });
    const ajustar = el('button', 'btn btn-ghost btn-icon', '⏱');
    ajustar.title = 'Registrar em outro horário';
    ajustar.addEventListener('click', () => sheetDoseHorario(med));
    const editar = el('button', 'btn btn-ghost btn-icon', '✎');
    editar.title = 'Editar alerta';
    editar.addEventListener('click', () => sheetMed(med));
    acoes.append(tomar, ajustar, editar);
    card.append(acoes);
    lista.append(card);
  });
}

function sheetDoseHorario(med) {
  const form = el('form');
  form.innerHTML = `
    <label class="field"><span>Horário da dose</span>
      <input type="datetime-local" name="at" value="${toLocalInput(Date.now())}" required></label>
    <button class="btn btn-primary block" type="submit">Registrar dose</button>`;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const at = fromLocalInput(new FormData(form).get('at'));
    if (!at) return;
    S.takeMed(med, at);
    closeSheet();
    toast(`${med.name} registrado às ${fmtTime(at)}`);
  });
  openSheet(med.name, form);
}

function sheetMed(med = null) {
  const categoriaAtual = med ? (med.category || 'remedio') : 'remedio';
  const catOpc = CATEGORIAS
    .map((c) => `<option value="${c.id}"${c.id === categoriaAtual ? ' selected' : ''}>${c.emoji} ${c.label}</option>`)
    .join('');
  const repetir = med ? !!med.repeat : true; // novo alerta já vem como recorrente
  const every = med && med.repeat ? med.repeat.every : 8;
  const unit = med && med.repeat ? med.repeat.unit : 'hour';
  const unitOpc = UNIDADES.map((u) => `<option value="${u.id}"${u.id === unit ? ' selected' : ''}>${u.label}</option>`).join('');
  const quando = toLocalInput(med && med.startAt ? med.startAt : Date.now());

  const form = el('form');
  form.innerHTML = `
    <label class="field"><span>Categoria</span>
      <select name="category">${catOpc}</select></label>
    <label class="field"><span>Nome</span>
      <input type="text" name="name" value="${med ? med.name : ''}" placeholder="Ex.: Cefalexina" required></label>
    <label class="field"><span>Data e hora</span>
      <input type="datetime-local" name="startAt" value="${quando}" required></label>
    <label class="switch">
      <span>Repetir</span>
      <input type="checkbox" name="repetir" ${repetir ? 'checked' : ''}></label>
    <div class="field freq-row" id="freqRow"${repetir ? '' : ' hidden'}>
      <span>A cada</span>
      <input type="number" name="every" value="${every}" min="1" max="999" inputmode="numeric" class="freq-num">
      <select name="unit">${unitOpc}</select>
    </div>
    <label class="field"><span>Descrição (opcional)</span>
      <input type="text" name="dose" value="${med ? med.dose || '' : ''}" placeholder="Ex.: 1 comprimido, jejum, Dra. Ana…"></label>
    <button class="btn btn-primary block" type="submit">Salvar</button>`;

  form.querySelector('input[name="repetir"]').addEventListener('change', (e) => {
    form.querySelector('#freqRow').hidden = !e.target.checked;
  });

  if (med) {
    const apagar = el('button', 'btn btn-danger block', 'Apagar alerta');
    apagar.type = 'button';
    apagar.addEventListener('click', () => {
      if (confirm(`Apagar ${med.name} e o histórico?`)) {
        S.removeMed(med.id);
        closeSheet();
        toast('Alerta apagado');
      }
    });
    form.append(apagar);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const startAt = fromLocalInput(d.startAt);
    if (!startAt) { toast('Confira a data e hora'); return; }
    const repeat = d.repetir
      ? { every: Math.max(1, Number(d.every) || 1), unit: d.unit }
      : null;
    S.saveMed({
      id: med ? med.id : undefined,
      category: d.category,
      name: d.name.trim(),
      startAt,
      repeat,
      dose: d.dose.trim(),
      active: true,
    });
    closeSheet();
    toast('Salvo');
  });
  openSheet(med ? 'Editar alerta' : 'Novo alerta', form);
}

/* ================================================================ DIÁRIO */

function refDia() {
  const d = new Date();
  d.setDate(d.getDate() + diaDiario);
  return d;
}

function renderDiario() {
  const ref = refDia();
  const resumo = S.daySummary(ref);
  $('#dayLabel').textContent = diaDiario === 0 ? 'Hoje'
    : diaDiario === -1 ? 'Ontem'
    : ref.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  $('#dayNext').disabled = diaDiario >= 0;
  renderResumo($('#dayGrid'), resumo);
  renderRelogioDia($('#dayClock'), ref);
  renderSleepBar($('#daySleepBar'), ref);
  renderSemana($('#weekChart'));

  const linha = $('#timeline');
  linha.innerHTML = '';
  const eventos = [...resumo.eventos].reverse();
  if (!eventos.length) linha.append(el('p', 'empty', 'Nenhum registro neste dia.'));
  eventos.forEach((ev) => linha.append(linhaEvento(ev)));
}

/** Gráfico de barras: sono (horas) nos últimos 7 dias — estilo Napper. */
function renderSemana(container) {
  container.innerHTML = '';
  const dias = [];
  for (let i = 6; i >= 0; i -= 1) { const d = new Date(); d.setDate(d.getDate() - i); dias.push(d); }
  const horas = dias.map((d) => S.daySummary(d).minutosDormindo / 60);
  const totalMin = dias.reduce((t, d) => t + S.daySummary(d).minutosDormindo, 0);
  const comDados = horas.filter((h) => h > 0).length;
  const media = comDados ? totalMin / comDados : 0;
  const max = Math.max(8, ...horas);

  const card = el('div', 'card');
  const topo = el('div', 'sleepbar-top');
  topo.append(el('span', null, '📊 Sono nos últimos 7 dias'),
    el('strong', null, `média ${media ? fmtMin(media) : '—'}`));
  card.append(topo);

  const NS = 'http://www.w3.org/2000/svg';
  const W = 320; const H = 120; const base = 96; const bw = 26; const gap = (W - bw * 7) / 8;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'weekchart');
  const add = (tag, attrs, txt) => {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (txt != null) e.textContent = txt;
    svg.append(e);
    return e;
  };
  dias.forEach((d, i) => {
    const x = gap + i * (bw + gap);
    const h = Math.round((horas[i] / max) * (base - 12));
    add('rect', { x, y: base - h, width: bw, height: Math.max(h, 2), rx: 6, class: i === 6 ? 'wc-bar is-today' : 'wc-bar' });
    add('text', { x: x + bw / 2, y: base + 14, class: 'wc-day' }, ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][d.getDay()]);
    if (horas[i] > 0) add('text', { x: x + bw / 2, y: base - h - 4, class: 'wc-val' }, Math.round(horas[i]) + 'h');
  });
  card.append(svg);
  container.append(card);
}

function textoResumo() {
  const ref = refDia();
  const resumo = S.daySummary(ref);
  const nome = state.baby.name || 'Bebê';
  const linhas = [
    `${nome} — ${ref.toLocaleDateString('pt-BR')}`,
    `Mamadas: ${resumo.mamadas} (${fmtMin(resumo.minutosMamando)} no total)`,
    `Fraldas: ${resumo.xixis} xixi · ${resumo.cocos} cocô`,
    `Sono registrado: ${fmtMin(resumo.minutosDormindo)}`,
    `Alertas: ${resumo.remedios} registros`,
    '',
  ];
  resumo.eventos.forEach((ev) => {
    linhas.push(`${fmtTime(ev.at)}  ${tituloEvento(ev)}${subtituloEvento(ev) ? ` — ${subtituloEvento(ev)}` : ''}`);
  });
  return linhas.join('\n');
}

function sheetAgenda() {
  const wrap = el('div');
  const linhas = S.agenda(24);
  if (!linhas.length) {
    wrap.append(el('p', 'empty', 'Registre uma mamada e a primeira dose de cada remédio para o app projetar os horários.'));
  } else {
    linhas.forEach((l) => {
      const linha = el('div', 'agenda-line');
      linha.append(el('b', null, fmtTime(l.at)), el('span', null, `${l.emoji} ${l.text}`));
      if (new Date(l.at).getDate() !== new Date().getDate()) {
        linha.append(el('span', 'muted small', fmtDate(l.at)));
      }
      wrap.append(linha);
    });
    const copiarBtn = el('button', 'btn btn-primary block', 'Copiar horários');
    copiarBtn.addEventListener('click', () => {
      copiar(linhas.map((l) => `${fmtTime(l.at)} ${l.text}`).join('\n'));
    });
    wrap.append(copiarBtn);
    wrap.append(el('p', 'muted small', 'Dica: use esta lista para conferir ou recriar os alarmes do celular.'));
  }
  openSheet('Próximas 24 horas', wrap);
}

/* ================================================================ AJUSTES */

// Preenche um campo sem pisar no que o usuário está digitando (evita que um
// render disparado por sync/save sobrescreva a caixa em foco).
function setVal(sel, val) {
  const elm = $(sel);
  if (elm && document.activeElement !== elm) elm.value = val;
}

function renderAjustes() {
  setVal('#setName', state.baby.name || '');
  setVal('#setBirth', state.baby.birth || '');
  $('#setInterval').value = String(state.settings.feedIntervalMin);
  $('#setNotify').checked = !!state.settings.notify && Notification.permission === 'granted';
  const totalRegistros = state.events.filter((e) => !e.deleted).length;
  $('#version').textContent = `Rotina do Bebê · ${totalRegistros} registros`;

  $('#syncEnabled').checked = SYNC.isEnabled();
  $('#syncFields').hidden = !SYNC.isEnabled();
  setVal('#syncCode', SYNC.getCode());
  renderSyncStatus();

  const wa = state.settings.wa;
  $('#waEnabled').checked = !!wa.enabled;
  $('#waFields').hidden = !wa.enabled;
  $('#waProvider').value = wa.provider;
  setVal('#waBaseUrl', wa.baseUrl);
  setVal('#waApiKey', wa.apiKey);
  setVal('#waSession', wa.session);
  setVal('#waNumbers', wa.numbers);
  $('#waOnReminder').checked = !!wa.onReminder;
  setVal('#waWorkerUrl', wa.workerUrl);
  setVal('#waWorkerToken', wa.workerToken);
  $('#waSessionLabel').textContent = wa.provider === 'evolution' ? 'Instância' : 'Sessão';

  const ntfy = state.settings.ntfy;
  $('#ntfyEnabled').checked = !!ntfy.enabled;
  $('#ntfyFields').hidden = !ntfy.enabled;
  setVal('#ntfyServer', ntfy.server);
  setVal('#ntfyTopic', ntfy.topic);
  $('#ntfyOnReminder').checked = !!ntfy.onReminder;
  setVal('#ntfyDiaper', (state.settings.reminders?.diaperTimes || []).join(', '));
}

function renderSyncStatus() {
  const el2 = $('#syncStatus');
  if (!el2) return;
  if (!SYNC.isEnabled()) { el2.textContent = 'Desligado — os dados ficam só neste aparelho.'; return; }
  const s = SYNC.status();
  const quando = s.em ? fmtTime(s.em) : '—';
  const mapa = {
    ok: s.pendentes ? `Sincronizado ${quando} · ${s.pendentes} a enviar` : `Tudo sincronizado · ${quando}`,
    sync: 'Sincronizando…',
    erro: `Sem conexão com o servidor (${s.erro || 'erro'}) — tentando de novo`,
    off: 'Desligado',
  };
  el2.textContent = mapa[s.estado] || '—';
}

function baixarBackup() {
  const blob = new Blob([S.exportData()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  const hoje = new Date();
  a.download = `rotina-bebe-${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup gerado');
}

/* ================================================================ avisos */

const NOTIF_KEY = 'rotina-bebe:avisados';
let avisados = new Set(JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]'));

function marcarAviso(chave) {
  avisados.add(chave);
  if (avisados.size > 40) avisados = new Set([...avisados].slice(-20));
  localStorage.setItem(NOTIF_KEY, JSON.stringify([...avisados]));
}

async function pedirPermissao() {
  if (!('Notification' in window)) {
    toast('Este navegador não suporta avisos');
    return false;
  }
  const permissao = await Notification.requestPermission();
  const ok = permissao === 'granted';
  state.settings.notify = ok;
  S.save();
  toast(ok ? 'Avisos ativados' : 'Avisos bloqueados nas permissões do navegador');
  return ok;
}

function avisar(titulo, corpo, tag) {
  const opcoes = { body: corpo, tag, icon: './assets/icons/icon-192.png', badge: './assets/icons/icon-192.png' };
  navigator.serviceWorker?.ready
    .then((reg) => reg.showNotification(titulo, opcoes))
    .catch(() => { new Notification(titulo, opcoes); });
  vibrar([80, 60, 80]);
}

/** Envia no WhatsApp quando um aviso dispara (best-effort, só com o app aberto). */
function avisarWhatsApp(texto) {
  const wa = state.settings.wa;
  if (!wa.enabled || !wa.onReminder) return;
  const nome = state.baby.name?.trim();
  WA.broadcast(wa, `${nome ? `${nome} · ` : ''}${texto}`).catch((err) => {
    console.warn('WhatsApp falhou:', err.message);
  });
}

/** Dispara um push imediato pelo ntfy quando o aviso toca (app aberto). */
function avisarNtfy(texto) {
  const ntfy = state.settings.ntfy;
  if (!ntfy.enabled || !ntfy.onReminder || !ntfy.topic) return;
  // Com a sincronização ligada, quem manda os pushes é o servidor (/api/cron),
  // em tempo real e mesmo com o app fechado — então aqui não duplicamos.
  if (SYNC.isEnabled()) return;
  const nome = state.baby.name?.trim();
  NTFY.publish(ntfy, {
    title: `Rotina${nome ? ` · ${nome}` : ''}`,
    message: texto,
    tags: NTFY.tagPara(texto),
    priority: 'high',
  }).catch((err) => console.warn('ntfy falhou:', err.message));
}

function checarAvisos() {
  if (!state.settings.notify || Notification.permission !== 'granted') return;
  const agora = Date.now();

  const mamada = S.nextFeedAt();
  if (mamada && agora >= mamada && agora - mamada < 30 * MS_MIN && !state.activeFeed) {
    const chave = `feed:${mamada}`;
    if (!avisados.has(chave)) {
      marcarAviso(chave);
      const lado = S.nextSide();
      const corpo = lado ? `Oferecer o lado ${SIDE_LABEL[lado]}.` : 'Toque para registrar.';
      avisar('Hora da mamada 🍼', corpo, chave);
      avisarWhatsApp(`🍼 Hora da mamada. ${corpo}`);
      avisarNtfy(`🍼 Hora da mamada. ${corpo}`);
    }
  }

  state.meds.filter((m) => m.active !== false).forEach((med) => {
    const occ = S.dueAlertAt(med); // ocorrência vencendo agora
    if (!occ || agora - occ > 30 * MS_MIN) return;
    const chave = `med:${med.id}:${occ}`;
    if (avisados.has(chave)) return;
    marcarAviso(chave);
    const emoji = catInfo(med.category).emoji;
    const corpo = med.dose || repeatLabel(med);
    avisar(`${med.name} ${emoji}`, corpo, chave);
    avisarWhatsApp(`${emoji} ${med.name}. ${corpo}`);
    avisarNtfy(`${emoji} ${med.name}. ${corpo}`);
  });
}

/** Empurra a agenda para o worker 24/7, no máximo a cada 5 min (best-effort). */
let ultimoPush = 0;
function sincronizarWorker(forcar = false) {
  const wa = state.settings.wa;
  if (!wa.enabled || !wa.workerUrl) return Promise.resolve({ skipped: true });
  const agora = Date.now();
  if (!forcar && agora - ultimoPush < 5 * MS_MIN) return Promise.resolve({ skipped: true });
  ultimoPush = agora;
  return WA.pushAgenda(wa, S.agenda(24)).catch((err) => {
    console.warn('Sync com worker falhou:', err.message);
    return { error: err.message };
  });
}

/* ================================================================ ciclo */

function render() {
  const nome = state.baby.name?.trim();
  const idade = fmtAge(state.baby.birth);
  $('#topSub').textContent = [nome, idade].filter(Boolean).join(' · ') || 'Toque em Ajustes para dar um nome 💛';
  $('#btnNotify').classList.toggle('is-on', !!state.settings.notify);

  if (viewAtual === 'agora') renderAgora();
  else if (viewAtual === 'mamada') renderMamada();
  else if (viewAtual === 'remedios') renderRemedios();
  else if (viewAtual === 'diario') renderDiario();
  else if (viewAtual === 'ajustes') renderAjustes();
}

/** Avisa (uma vez) quando o cronômetro de arroto atinge a meta de 20 min. */
function checarMetaArroto() {
  if (!state.activeBurp) { burpAvisado = false; return; }
  const min = (Date.now() - state.activeBurp.startAt) / MS_MIN;
  if (min >= BURP_TARGET_MIN && !burpAvisado) {
    burpAvisado = true;
    vibrar([120, 80, 120]);
    if (state.settings.notify && Notification.permission === 'granted') {
      avisar('Arroto: 20 min ✅', 'Meta de arroto atingida — pode encerrar quando quiser.', 'burp-meta');
    }
    avisarWhatsApp('💨 Arroto: 20 min completos.');
    avisarNtfy('💨 Arroto: 20 min completos.');
    if (viewAtual !== 'agora') toast('Arroto: 20 min atingidos ✅');
  }
}

function tick() {
  if (viewAtual === 'agora' || viewAtual === 'mamada' || viewAtual === 'remedios') render();
  checarAvisos();
  checarMetaArroto();
  sincronizarWorker();
}

/* ================================================================ WhatsApp (UI) */

/* ================================================================ sincronização (UI) */

function ligarEventosSync() {
  SYNC.onStatus(() => { if (viewAtual === 'ajustes') renderSyncStatus(); });

  $('#syncEnabled').addEventListener('change', async (e) => {
    if (e.target.checked) {
      $('#syncFields').hidden = false;
      let code = $('#syncCode').value.trim() || SYNC.getCode();
      if (!code) { code = SYNC.sugerirCodigo(); $('#syncCode').value = code; }
      toast('Sincronização ligada');
      await SYNC.enable(code);
      renderSyncStatus();
    } else {
      SYNC.disable();
      $('#syncFields').hidden = true;
    }
  });

  $('#syncGen').addEventListener('click', () => {
    $('#syncCode').value = SYNC.sugerirCodigo();
    toast('Código gerado — use o mesmo no outro celular');
  });

  $('#syncCode').addEventListener('change', async (e) => {
    const code = e.target.value.trim();
    if (code.length >= 4) { await SYNC.enable(code); renderSyncStatus(); }
  });

  $('#syncNow').addEventListener('click', async () => {
    if (!SYNC.isEnabled()) { toast('Ligue a sincronização e informe um código'); return; }
    toast('Sincronizando…');
    await SYNC.syncOnce();
    renderSyncStatus();
  });
}

/* ================================================================ ntfy (UI) */

/** "10:00, 14h, 8:5" -> ['08:05','10:00','14:00'] (válidos, únicos, ordenados). */
function parseHorarios(bruto) {
  const vistos = new Set();
  (String(bruto).match(/\d{1,2}\s*[:h]\s*\d{0,2}/g) || []).forEach((tok) => {
    const [h, m = '0'] = tok.split(/[:h]/);
    const hh = Number(h); const mm = Number(m || 0);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      vistos.add(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    }
  });
  return [...vistos].sort();
}

function lerConfigNtfy() {
  const ntfy = state.settings.ntfy;
  ntfy.server = $('#ntfyServer').value.trim() || 'https://ntfy.sh';
  ntfy.topic = $('#ntfyTopic').value.trim();
  ntfy.onReminder = $('#ntfyOnReminder').checked;
  state.settings.reminders.diaperTimes = parseHorarios($('#ntfyDiaper').value);
  S.save();
}

function ligarEventosNtfy() {
  $('#ntfyEnabled').addEventListener('change', (e) => {
    state.settings.ntfy.enabled = e.target.checked;
    $('#ntfyFields').hidden = !e.target.checked;
    // Na primeira vez, já sugere um tópico aleatório para o usuário.
    if (e.target.checked && !state.settings.ntfy.topic) {
      state.settings.ntfy.topic = NTFY.sugerirTopico();
      $('#ntfyTopic').value = state.settings.ntfy.topic;
    }
    S.save();
  });

  ['ntfyServer', 'ntfyTopic'].forEach((id) => $(`#${id}`).addEventListener('change', lerConfigNtfy));
  $('#ntfyOnReminder').addEventListener('change', lerConfigNtfy);

  $('#ntfyGen').addEventListener('click', () => {
    state.settings.ntfy.topic = NTFY.sugerirTopico();
    $('#ntfyTopic').value = state.settings.ntfy.topic;
    S.save();
    toast('Tópico gerado — assine-o no app ntfy');
  });

  $('#ntfyTest').addEventListener('click', async (e) => {
    lerConfigNtfy();
    if (!state.settings.ntfy.topic) { toast('Defina ou gere um tópico'); return; }
    e.target.disabled = true;
    toast('Enviando teste…');
    try {
      await NTFY.publish(state.settings.ntfy, {
        title: 'Rotina do Bebê', message: '✅ Teste do Rotina do Bebê — chegou!', tags: 'tada', priority: 'high',
      });
      toast('Teste enviado — veja no app ntfy');
    } catch (err) {
      alert(`Falha ao enviar: ${err.message}\n\nConfira se o tópico está certo e assinado no app ntfy.`);
    } finally {
      e.target.disabled = false;
    }
  });

  $('#ntfyDiaper').addEventListener('change', lerConfigNtfy);
}

function lerConfigWhatsApp() {
  const wa = state.settings.wa;
  wa.provider = $('#waProvider').value;
  wa.baseUrl = $('#waBaseUrl').value.trim();
  wa.apiKey = $('#waApiKey').value.trim();
  wa.session = $('#waSession').value.trim() || 'default';
  wa.numbers = $('#waNumbers').value.trim();
  wa.onReminder = $('#waOnReminder').checked;
  wa.workerUrl = $('#waWorkerUrl').value.trim();
  wa.workerToken = $('#waWorkerToken').value.trim();
  S.save();
}

function ligarEventosWhatsApp() {
  $('#waEnabled').addEventListener('change', (e) => {
    state.settings.wa.enabled = e.target.checked;
    $('#waFields').hidden = !e.target.checked;
    S.save();
  });

  // Campos: salvam ao editar; provider também troca o rótulo Sessão/Instância.
  ['waBaseUrl', 'waApiKey', 'waSession', 'waNumbers', 'waWorkerUrl', 'waWorkerToken'].forEach((id) => {
    $(`#${id}`).addEventListener('change', lerConfigWhatsApp);
  });
  $('#waOnReminder').addEventListener('change', lerConfigWhatsApp);
  $('#waProvider').addEventListener('change', () => {
    lerConfigWhatsApp();
    $('#waSessionLabel').textContent = state.settings.wa.provider === 'evolution' ? 'Instância' : 'Sessão';
  });

  $('#waTest').addEventListener('click', async (e) => {
    lerConfigWhatsApp();
    const wa = state.settings.wa;
    const numeros = WA.parseNumbers(wa.numbers);
    if (!wa.baseUrl || !numeros.length) { toast('Preencha URL e ao menos um número'); return; }
    e.target.disabled = true;
    toast('Enviando teste…');
    try {
      const r = await WA.broadcast(wa, '✅ Teste do Rotina do Bebê — está funcionando!');
      toast(`Teste enviado (${r.enviados}/${r.total})`);
    } catch (err) {
      alert(`Falha ao enviar: ${err.message}\n\nVerifique URL, chave, sessão e o CORS do servidor.`);
    } finally {
      e.target.disabled = false;
    }
  });

  $('#waSendSummary').addEventListener('click', async (e) => {
    lerConfigWhatsApp();
    const wa = state.settings.wa;
    if (!wa.baseUrl || !WA.parseNumbers(wa.numbers).length) { toast('Preencha URL e ao menos um número'); return; }
    e.target.disabled = true;
    toast('Enviando resumo…');
    try {
      const r = await WA.broadcast(wa, textoResumo());
      toast(`Resumo enviado (${r.enviados}/${r.total})`);
    } catch (err) {
      alert(`Falha ao enviar: ${err.message}`);
    } finally {
      e.target.disabled = false;
    }
  });

  $('#waPush').addEventListener('click', async (e) => {
    lerConfigWhatsApp();
    if (!state.settings.wa.workerUrl) { toast('Informe a URL do worker 24/7'); return; }
    e.target.disabled = true;
    toast('Sincronizando…');
    try {
      await sincronizarWorker(true);
      toast('Agenda enviada ao worker');
    } catch (err) {
      alert(`Falha ao sincronizar: ${err.message}`);
    } finally {
      e.target.disabled = false;
    }
  });
}

/* ================================================================ eventos de UI */

function ligarEventos() {
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => { vibrar(); irPara(tab.dataset.view); }));

  $$('.quick').forEach((btn) => btn.addEventListener('click', () => {
    vibrar();
    const acao = btn.dataset.quick;
    if (acao === 'mamada') {
      if (!state.activeFeed) S.startFeed(S.nextSide() || 'E');
      irPara('mamada');
      toast('Mamada iniciada — finalize quando terminar');
    } else if (acao === 'xixi' || acao === 'cocô') {
      S.addEvent({ type: 'diaper', kind: acao });
      toast(`${acao === 'xixi' ? 'Xixi' : 'Cocô'} registrado`);
    } else if (acao === 'arroto') {
      if (state.activeBurp) {
        const ev = S.finishBurp();
        burpAvisado = false;
        if (ev) toast(`Arroto de ${fmtMin(ev.durationMin)} registrado`);
      } else {
        S.startBurp();
        burpAvisado = false;
        toast(`Cronômetro de arroto iniciado — meta ${BURP_TARGET_MIN} min`);
      }
    } else if (acao === 'sono') {
      const fim = S.toggleSleep();
      toast(fim ? `Acordou · dormiu ${fmtMin((fim.endAt - fim.at) / MS_MIN)}` : 'Sono iniciado');
    }
  }));

  $$('.side-btn').forEach((btn) => btn.addEventListener('click', () => {
    vibrar();
    const side = btn.dataset.side;
    if (state.activeFeed) S.switchSide(side);
    else S.startFeed(side);
  }));

  $('#btnFeedFinish').addEventListener('click', () => {
    const ev = S.finishFeed();
    vibrar();
    if (ev) toast(`Mamada de ${fmtMin(ev.durationMin)} registrada`);
  });

  $('#btnFeedCancel').addEventListener('click', () => {
    if (confirm('Cancelar esta mamada sem registrar?')) S.cancelFeed();
  });

  $('#btnFeedManual').addEventListener('click', sheetMamadaManual);
  $('#btnSleepManual').addEventListener('click', () => sheetSono());
  $('#btnAddMed').addEventListener('click', () => sheetMed());

  $('#dayPrev').addEventListener('click', () => { diaDiario -= 1; render(); });
  $('#dayNext').addEventListener('click', () => { if (diaDiario < 0) { diaDiario += 1; render(); } });
  $('#btnAgenda').addEventListener('click', sheetAgenda);
  $('#btnResumo').addEventListener('click', () => copiar(textoResumo()));

  ligarEventosSync();
  ligarEventosNtfy();
  ligarEventosWhatsApp();

  $('#setName').addEventListener('input', (e) => { state.baby.name = e.target.value; S.save(); });
  $('#setBirth').addEventListener('change', (e) => { state.baby.birth = e.target.value; S.save(); });
  $('#setInterval').addEventListener('change', (e) => {
    state.settings.feedIntervalMin = Number(e.target.value);
    S.save();
  });
  $('#setNotify').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const ok = await pedirPermissao();
      e.target.checked = ok;
    } else {
      state.settings.notify = false;
      S.save();
    }
  });
  $('#btnNotify').addEventListener('click', async () => {
    if (state.settings.notify) {
      state.settings.notify = false;
      S.save();
      toast('Avisos desligados');
    } else {
      await pedirPermissao();
    }
  });

  $('#btnExport').addEventListener('click', baixarBackup);
  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    try {
      S.importData(await arquivo.text());
      toast('Backup restaurado');
    } catch (err) {
      alert(`Não deu para importar: ${err.message}`);
    }
    e.target.value = '';
  });
  $('#btnWipe').addEventListener('click', () => {
    if (confirm('Apagar TODOS os registros deste aparelho? Não dá para desfazer.')) {
      S.wipe();
      toast('Tudo apagado');
    }
  });

  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetBackdrop').addEventListener('click', (e) => { if (e.target.id === 'sheetBackdrop') closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
}

/* ================================================================ boot */

S.onChange(render);
S.onChange(() => SYNC.triggerSoon());
ligarEventos();
irPara('agora');
setInterval(tick, 1000);
SYNC.start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW falhou:', err));
  });
}
