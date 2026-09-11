/** Formatação de datas, durações e contagens regressivas em português. */
import { MS_MIN, MS_HOUR } from './store.js';

export const pad = (n) => String(n).padStart(2, '0');

export function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Data + hora curtas: "11/09 14:00" (hoje/amanhã viram palavra). */
export function fmtDateTime(ts) {
  const d = new Date(ts);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const difDias = Math.round((dia - hoje) / (24 * MS_HOUR));
  if (difDias === 0) return `hoje ${fmtTime(ts)}`;
  if (difDias === 1) return `amanhã ${fmtTime(ts)}`;
  if (difDias === -1) return `ontem ${fmtTime(ts)}`;
  return `${fmtDate(ts)} ${fmtTime(ts)}`;
}

/** 95 -> "1h35" · 40 -> "40min" */
export function fmtMin(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto ? `${h}h${pad(resto)}` : `${h}h`;
}

/** Diferença em texto curto: "1h35", "12min". */
export function fmtGap(ms) {
  return fmtMin(Math.abs(ms) / MS_MIN);
}

/** Contagem regressiva com estado, usada nos cartões e nos remédios. */
export function countdown(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) {
    const atraso = -diff;
    if (atraso < 5 * MS_MIN) return { label: 'agora', state: 'due' };
    return { label: `${fmtGap(atraso)} atrás`, state: atraso > MS_HOUR ? 'late' : 'due' };
  }
  return { label: `em ${fmtGap(diff)}`, state: 'ok' };
}

/** Idade do bebê em dias/semanas, para o subtítulo. */
export function fmtAge(birth) {
  if (!birth) return '';
  const nasc = new Date(`${birth}T00:00:00`);
  if (Number.isNaN(nasc.getTime())) return '';
  const dias = Math.floor((Date.now() - nasc.getTime()) / (24 * MS_HOUR));
  if (dias < 0) return '';
  if (dias === 0) return 'nasceu hoje 💛';
  if (dias === 1) return '1 dia de vida';
  if (dias < 14) return `${dias} dias de vida`;
  const semanas = Math.floor(dias / 7);
  return `${semanas} semanas (${dias} dias)`;
}

/** Valor para <input type="datetime-local">. */
export function toLocalInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(valor) {
  const ts = new Date(valor).getTime();
  return Number.isNaN(ts) ? null : ts;
}

export const SIDE_LABEL = { E: 'esquerdo', D: 'direito' };

export function describeFeed(ev) {
  const partes = [];
  if (ev.durationMin) partes.push(fmtMin(ev.durationMin));
  const lados = Object.entries(ev.sides || {})
    .filter(([, min]) => min > 0)
    .map(([side, min]) => `${SIDE_LABEL[side] || side} ${min}min`);
  if (lados.length) partes.push(lados.join(' + '));
  return partes.join(' · ') || 'mamada';
}
