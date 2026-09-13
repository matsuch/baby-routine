/**
 * Notificações push simples via ntfy.sh — sem servidor, sem conta, sem ban.
 *
 * O usuário instala o app "ntfy", assina um tópico secreto e o app publica
 * mensagens nesse tópico. Duas formas:
 *  - Imediato: publish() dispara um push agora (usado junto do aviso local).
 *  - Agendado: publish(..., { at }) usa a entrega agendada do ntfy (header
 *    Delay), que chega na hora certa mesmo com o app fechado (madrugada).
 *
 * Usa o modo JSON do ntfy (corpo com Content-Type: application/json), que
 * aceita UTF-8 completo — acentos e emoji no título funcionam sem problemas.
 */

/** Tópico sugerido, aleatório e difícil de adivinhar (o tópico é público). */
export function sugerirTopico() {
  const aleatorio = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
  return `rotina-bebe-${aleatorio}`;
}

export function topicUrl(cfg) {
  const base = String(cfg.server || 'https://ntfy.sh').replace(/\/+$/, '');
  const topico = String(cfg.topic || '').trim();
  if (!topico) throw new Error('Defina um tópico do ntfy.');
  return `${base}/${encodeURIComponent(topico)}`;
}

/**
 * Monta o request para publicar no ntfy. Não faz rede.
 * `at` (opcional): timestamp em ms para entrega agendada.
 */
export function buildRequest(cfg, { message, title, tags, priority, at } = {}) {
  const topico = String(cfg.topic || '').trim();
  if (!topico) throw new Error('Defina um tópico do ntfy.');
  const base = String(cfg.server || 'https://ntfy.sh').replace(/\/+$/, '');
  const payload = { topic: topico, message: String(message ?? '') };
  if (title) payload.title = title;
  if (tags) payload.tags = Array.isArray(tags) ? tags : String(tags).split(',').map((s) => s.trim());
  if (priority) payload.priority = priority;
  if (at) payload.delay = String(Math.round(at / 1000));
  return {
    url: base,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

/** Publica uma mensagem (imediata ou agendada). Lança em erro de rede/HTTP. */
export async function publish(cfg, opcoes) {
  const req = buildRequest(cfg, opcoes);
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${detalhe ? ` — ${detalhe.slice(0, 140)}` : ''}`);
  }
  return res.json().catch(() => ({}));
}

/** Ícone (tag do ntfy) a partir do emoji que já usamos nos textos. */
export function tagPara(texto) {
  if (texto.includes('🍼')) return 'baby_bottle';
  if (texto.includes('💊')) return 'pill';
  return 'bell';
}
