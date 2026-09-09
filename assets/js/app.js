/** Rotina do Bebê — telas, interações e avisos. */
import * as S from './store.js';
import { MS_MIN, MS_HOUR, state } from './store.js';
import {
  countdown, describeFeed, fmtAge, fmtDate, fmtGap, fmtMin, fmtTime,
  fromLocalInput, pad, SIDE_LABEL, toLocalInput,
} from './format.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const TITULOS = {
  agora: 'Agora',
  mamada: 'Mamada',
  remedios: 'Remédios',
  diario: 'Diário',
  ajustes: 'Ajustes',
};

let viewAtual = 'agora';
let diaDiario = 0; // 0 = hoje, -1 = ontem...

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

function renderAgora() {
  const cards = $('#nextCards');
  cards.innerHTML = '';

  // — próxima mamada —
  const proxima = S.nextFeedAt();
  const ultima = S.lastEvent('feed');
  if (state.activeFeed) {
    cards.append(cartaoProximo({
      emoji: '🍼',
      titulo: 'Mamando agora',
      sub: `Lado ${SIDE_LABEL[state.activeFeed.side]} · começou ${fmtTime(state.activeFeed.startAt)}`,
      at: Date.now(),
      onClick: () => irPara('mamada'),
    }));
  } else if (proxima) {
    const lado = S.nextSide();
    cards.append(cartaoProximo({
      emoji: '🍼',
      titulo: 'Próxima mamada',
      sub: `${fmtTime(proxima)} · última às ${fmtTime(ultima.at)}${lado ? ` · dar o ${SIDE_LABEL[lado]}` : ''}`,
      at: proxima,
      onClick: () => irPara('mamada'),
    }));
  } else {
    const vazio = el('button', 'next');
    vazio.append(el('div', 'emoji', '🍼'));
    const corpo = el('div', 'next-body');
    corpo.append(
      el('div', 'next-title', 'Nenhuma mamada registrada'),
      el('div', 'next-sub', 'Toque para começar a primeira'),
    );
    vazio.append(corpo);
    vazio.addEventListener('click', () => irPara('mamada'));
    cards.append(vazio);
  }

  // — remédios com dose já iniciada —
  state.meds
    .filter((m) => m.active !== false && S.nextDoseAt(m))
    .map((m) => ({ med: m, at: S.nextDoseAt(m) }))
    .sort((a, b) => a.at - b.at)
    .slice(0, 3)
    .forEach(({ med, at }) => {
      cards.append(cartaoProximo({
        emoji: '💊',
        titulo: med.name,
        sub: `${fmtTime(at)} · a cada ${med.intervalHours}h${med.dose ? ` · ${med.dose}` : ''}`,
        at,
        onClick: () => irPara('remedios'),
      }));
    });

  // — sono em andamento —
  if (state.activeSleep) {
    const dormindo = el('div', 'item');
    dormindo.append(el('div', 'emoji', '😴'));
    const corpo = el('div', 'item-body');
    corpo.append(
      el('div', 'item-title', 'Dormindo'),
      el('div', 'item-sub', `desde ${fmtTime(state.activeSleep.startAt)} · ${fmtGap(Date.now() - state.activeSleep.startAt)}`),
    );
    dormindo.append(corpo);
    cards.append(dormindo);
  }

  $('#quickSonoLabel').textContent = state.activeSleep ? 'Acordou' : 'Dormiu';

  renderResumo($('#todayGrid'), S.daySummary());

  // — últimos registros —
  const recentes = $('#recentList');
  recentes.innerHTML = '';
  const ultimos = [...state.events].slice(-6).reverse();
  if (!ultimos.length) {
    recentes.append(el('p', 'empty', 'Ainda nada registrado hoje.'));
  } else {
    ultimos.forEach((ev) => recentes.append(linhaEvento(ev)));
  }
}

function renderResumo(grid, resumo) {
  grid.innerHTML = '';
  const stats = [
    ['🍼', resumo.mamadas, 'mamadas'],
    ['💧', resumo.xixis, 'xixis'],
    ['💩', resumo.cocos, 'cocôs'],
    ['😴', resumo.minutosDormindo ? fmtMin(resumo.minutosDormindo) : '0', 'sono'],
  ];
  stats.forEach(([emoji, valor, rotulo]) => {
    const stat = el('div', 'stat');
    stat.append(el('b', null, String(valor)), el('span', null, `${emoji} ${rotulo}`));
    grid.append(stat);
  });
}

/* ================================================================ linhas de evento */

const EVENTO_EMOJI = { feed: '🍼', diaper: '💧', sleep: '😴', med: '💊', note: '📝' };

function tituloEvento(ev) {
  switch (ev.type) {
    case 'feed': return 'Mamada';
    case 'diaper': return `Fralda · ${ev.kind}`;
    case 'sleep': return 'Sono';
    case 'med': return ev.name;
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
    case 'note': return ev.text || '';
    default: return '';
  }
}

function linhaEvento(ev, { apagavel = true } = {}) {
  const item = el('div', 'item');
  const emoji = ev.type === 'diaper' && ev.kind !== 'xixi' ? '💩' : EVENTO_EMOJI[ev.type] || '•';
  item.append(el('div', 'emoji', emoji));
  const corpo = el('div', 'item-body');
  corpo.append(el('div', 'item-title', tituloEvento(ev)), el('div', 'item-sub', subtituloEvento(ev)));
  item.append(corpo, el('div', 'item-time', fmtTime(ev.at)));
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

/* ================================================================ REMÉDIOS */

function renderRemedios() {
  const lista = $('#medList');
  lista.innerHTML = '';
  if (!state.meds.length) {
    lista.append(el('p', 'empty', 'Nenhum remédio cadastrado.'));
    return;
  }

  state.meds.forEach((med) => {
    const card = el('div', 'card med');
    const head = el('div', 'med-head');
    head.append(el('div', 'med-name', med.name));
    card.append(head);
    card.append(el('div', 'med-meta',
      `a cada ${med.intervalHours}h${med.dose ? ` · ${med.dose}` : ''}${med.who ? ` · ${med.who}` : ''}`));

    const dose = S.lastDose(med.id);
    const prox = S.nextDoseAt(med);
    const quando = el('div', 'med-when');
    if (prox) {
      const info = countdown(prox);
      if (info.state !== 'ok') quando.classList.add(info.state === 'late' ? 'is-late' : 'is-due');
      quando.textContent = `Próxima ${fmtTime(prox)} (${info.label}) · última ${fmtTime(dose.at)}`;
    } else {
      quando.textContent = 'Sem dose registrada ainda';
    }
    card.append(quando);

    const acoes = el('div', 'med-actions');
    const tomar = el('button', 'btn btn-primary', prox ? 'Tomei agora' : 'Registrar 1ª dose');
    tomar.addEventListener('click', () => {
      S.takeMed(med);
      vibrar();
      toast(`${med.name} registrado às ${fmtTime(Date.now())}`);
    });
    const ajustar = el('button', 'btn btn-ghost btn-icon', '⏱');
    ajustar.title = 'Registrar em outro horário';
    ajustar.addEventListener('click', () => sheetDoseHorario(med));
    const editar = el('button', 'btn btn-ghost btn-icon', '✎');
    editar.title = 'Editar remédio';
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
  const form = el('form');
  form.innerHTML = `
    <label class="field"><span>Nome</span>
      <input type="text" name="name" value="${med ? med.name : ''}" placeholder="Ex.: Cefalexina" required></label>
    <label class="field"><span>Intervalo (horas)</span>
      <input type="number" name="intervalHours" value="${med ? med.intervalHours : 8}" min="1" max="72" inputmode="numeric" required></label>
    <label class="field"><span>Dose (opcional)</span>
      <input type="text" name="dose" value="${med ? med.dose || '' : ''}" placeholder="Ex.: 1 comprimido"></label>
    <label class="field"><span>Para quem</span>
      <select name="who">
        <option value="mãe"${med && med.who === 'mãe' ? ' selected' : ''}>Mãe</option>
        <option value="bebê"${med && med.who === 'bebê' ? ' selected' : ''}>Bebê</option>
      </select></label>
    <button class="btn btn-primary block" type="submit">Salvar</button>`;

  if (med) {
    const apagar = el('button', 'btn btn-danger block', 'Apagar remédio');
    apagar.type = 'button';
    apagar.addEventListener('click', () => {
      if (confirm(`Apagar ${med.name} e o histórico de doses?`)) {
        S.removeMed(med.id);
        closeSheet();
        toast('Remédio apagado');
      }
    });
    form.append(apagar);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    S.saveMed({
      id: med ? med.id : undefined,
      name: d.name.trim(),
      intervalHours: Math.max(1, Number(d.intervalHours) || 8),
      dose: d.dose.trim(),
      who: d.who,
      active: true,
    });
    closeSheet();
    toast('Salvo');
  });
  openSheet(med ? 'Editar remédio' : 'Novo remédio', form);
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

  const linha = $('#timeline');
  linha.innerHTML = '';
  const eventos = [...resumo.eventos].reverse();
  if (!eventos.length) linha.append(el('p', 'empty', 'Nenhum registro neste dia.'));
  eventos.forEach((ev) => linha.append(linhaEvento(ev)));
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
    `Remédios: ${resumo.remedios} doses`,
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

function renderAjustes() {
  $('#setName').value = state.baby.name || '';
  $('#setBirth').value = state.baby.birth || '';
  $('#setInterval').value = String(state.settings.feedIntervalMin);
  $('#setNotify').checked = !!state.settings.notify && Notification.permission === 'granted';
  $('#version').textContent = `Rotina do Bebê · ${state.events.length} registros salvos neste aparelho`;
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

function checarAvisos() {
  if (!state.settings.notify || Notification.permission !== 'granted') return;
  const agora = Date.now();

  const mamada = S.nextFeedAt();
  if (mamada && agora >= mamada && agora - mamada < 30 * MS_MIN && !state.activeFeed) {
    const chave = `feed:${mamada}`;
    if (!avisados.has(chave)) {
      marcarAviso(chave);
      const lado = S.nextSide();
      avisar('Hora da mamada 🍼', lado ? `Oferecer o lado ${SIDE_LABEL[lado]}.` : 'Toque para registrar.', chave);
    }
  }

  state.meds.filter((m) => m.active !== false).forEach((med) => {
    const prox = S.nextDoseAt(med);
    if (!prox || agora < prox || agora - prox > 30 * MS_MIN) return;
    const chave = `med:${med.id}:${prox}`;
    if (avisados.has(chave)) return;
    marcarAviso(chave);
    avisar(`Hora do ${med.name} 💊`, med.dose ? `Dose: ${med.dose}` : `A cada ${med.intervalHours}h.`, chave);
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

function tick() {
  if (viewAtual === 'agora' || viewAtual === 'mamada' || viewAtual === 'remedios') render();
  checarAvisos();
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
  $('#btnAddMed').addEventListener('click', () => sheetMed());

  $('#dayPrev').addEventListener('click', () => { diaDiario -= 1; render(); });
  $('#dayNext').addEventListener('click', () => { if (diaDiario < 0) { diaDiario += 1; render(); } });
  $('#btnAgenda').addEventListener('click', sheetAgenda);
  $('#btnResumo').addEventListener('click', () => copiar(textoResumo()));

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
ligarEventos();
irPara('agora');
setInterval(tick, 1000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW falhou:', err));
  });
}
