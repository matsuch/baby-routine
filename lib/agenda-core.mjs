/**
 * Núcleo da agenda (puro, sem DOM/banco): dado o perfil + eventos + "agora",
 * diz QUAIS lembretes estão vencendo NESTE instante. Nada é pré-agendado.
 *
 * É isso que permite criar/editar/cancelar de graça: como o robô do servidor
 * recalcula a cada rodada a partir do estado atual, antecipar uma mamada em
 * 30 min simplesmente faz o "próximo" mudar — o aviso do horário antigo nunca
 * chega a ser enviado.
 *
 * Compartilhado entre o cliente (store) e o /api/cron do servidor.
 */

export const MS_MIN = 60000;
export const MS_HOUR = 3600000;

// Emoji/tag do ntfy por categoria de alerta (espelha CATEGORIAS do cliente).
const CAT_EMOJI = { remedio: '💊', vacina: '💉', consulta: '🩺', alimentacao: '🍼', higiene: '🧴', outro: '🔔' };
const CAT_TAG = { remedio: 'pill', vacina: 'syringe', consulta: 'hospital', alimentacao: 'baby_bottle', higiene: 'bathtub', outro: 'bell' };

/** Último evento de um tipo (mais recente por `at`), ignorando apagados. */
export function lastEvent(events, type, filtro = () => true) {
  let melhor = null;
  for (const ev of events) {
    if (ev && ev.type === type && !ev.deleted && filtro(ev)) {
      if (!melhor || ev.at > melhor.at) melhor = ev;
    }
  }
  return melhor;
}

/** Quando deveria ser a próxima mamada (fim da última + intervalo). */
export function nextFeedAt(profile, events) {
  const ultima = lastEvent(events, 'feed');
  if (!ultima) return null;
  const intervaloMin = profile?.settings?.feedIntervalMin ?? 180;
  return (ultima.endAt || ultima.at) + intervaloMin * MS_MIN;
}

/** Quando deveria ser a próxima dose de um remédio. */
export function nextDoseAt(med, events) {
  const dose = lastEvent(events, 'med', (e) => e.medId === med.id);
  if (!dose) return null;
  return dose.at + med.intervalHours * MS_HOUR;
}

/* ------------------------------------------------------------ horários locais
 * O servidor roda em UTC; os "horários fixos" de troca são horas de parede
 * no fuso da família (Brasil = -180 min). Convertidos sem depender de libs.
 */
function partesLocais(now, tzOffsetMin) {
  const d = new Date(now + tzOffsetMin * MS_MIN);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), da: d.getUTCDate() };
}

/** Epoch (UTC ms) do horário local "HH:MM" de hoje. */
export function localTimeToday(now, tzOffsetMin, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const { y, mo, da } = partesLocais(now, tzOffsetMin);
  return Date.UTC(y, mo, da, h, m, 0) - tzOffsetMin * MS_MIN;
}

/** Chave de dia local (YYYY-MM-DD) para deduplicar os lembretes fixos. */
export function localDateKey(now, tzOffsetMin) {
  const { y, mo, da } = partesLocais(now, tzOffsetMin);
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

export const REMINDERS_PADRAO = {
  diaperTimes: ['10:00', '14:00', '18:00', '22:00'],
  tzOffsetMin: -180, // Brasil (sem horário de verão)
};

/**
 * Lembretes vencendo em `now`. Um lembrete "vence" quando seu horário-alvo já
 * passou (t <= now) mas não faz muito tempo (janela `maxLateMs`, para o servidor
 * não despejar avisos antigos se ficou horas fora do ar). Cada um traz uma
 * `key` estável para o servidor enviar só uma vez.
 *
 * Retorna [{ kind, key, message, tags, at }]. O título (com o nome do bebê)
 * é montado por quem envia, para caber no header Latin-1 do ntfy.
 */
export function dueReminders(profile, events, {
  now = Date.now(),
  maxLateMs = 90 * MS_MIN,
} = {}) {
  const evs = Array.isArray(events) ? events : [];
  const rem = { ...REMINDERS_PADRAO, ...(profile?.settings?.reminders || {}) };
  const out = [];
  const venceu = (t) => t != null && t <= now && t > now - maxLateMs;

  const mamada = nextFeedAt(profile, evs);
  if (venceu(mamada)) {
    out.push({ kind: 'feed', key: `feed:${mamada}`, message: '🍼 Hora da mamada', tags: 'baby_bottle', at: mamada });
  }

  for (const med of (profile?.meds || [])) {
    if (!med || med.active === false) continue;
    const t = nextDoseAt(med, evs);
    if (venceu(t)) {
      const emoji = CAT_EMOJI[med.category] || CAT_EMOJI.outro;
      out.push({
        kind: 'med',
        key: `med:${med.id}:${t}`,
        message: `${emoji} ${med.name}${med.dose ? ` · ${med.dose}` : ''}`,
        tags: CAT_TAG[med.category] || CAT_TAG.outro,
        at: t,
      });
    }
  }

  const dia = localDateKey(now, rem.tzOffsetMin);
  for (const hhmm of (rem.diaperTimes || [])) {
    const t = localTimeToday(now, rem.tzOffsetMin, hhmm);
    if (venceu(t)) {
      out.push({
        kind: 'diaper',
        key: `diaper:${dia}:${hhmm}`,
        message: '🧷 Hora de anotar as trocas (xixi/cocô)',
        tags: 'toilet',
        at: t,
      });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}
