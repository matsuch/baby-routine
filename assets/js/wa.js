/**
 * Integração com WhatsApp via API não-oficial (WAHA ou Evolution API).
 *
 * Duas camadas:
 *  - Direto do app (enquanto aberto): sendText / sendSummary chamam a API
 *    do WAHA/Evolution. Exige CORS liberado no servidor e a chave fica no
 *    aparelho — ok para um servidor pessoal, não para um público compartilhado.
 *  - Worker 24/7 (server/): pushAgenda envia a agenda + config para o worker,
 *    que dispara os lembretes mesmo com o celular bloqueado (madrugada).
 *
 * As funções de montagem de payload são puras, para dar para testar sem rede.
 */

/** Normaliza um número para só dígitos (DDI+DDD+número). */
export function normalizeNumber(raw) {
  return String(raw || '').replace(/\D/g, '');
}

/** Quebra a lista de destinos ("55119...,55219...") em números válidos. */
export function parseNumbers(str) {
  return String(str || '')
    .split(/[,;\n]/)
    .map(normalizeNumber)
    .filter((n) => n.length >= 10);
}

/**
 * Monta o request (url, método, headers, body) para enviar um texto.
 * Suporta os dois provedores. Não faz rede — só descreve a chamada.
 */
export function buildRequest(cfg, number, text) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  const session = cfg.session || 'default';
  const num = normalizeNumber(number);
  if (!base) throw new Error('Configure a URL do servidor de WhatsApp.');
  if (!num) throw new Error('Número de destino inválido.');

  if (cfg.provider === 'evolution') {
    // Evolution API: POST /message/sendText/{instance}
    return {
      url: `${base}/message/sendText/${encodeURIComponent(session)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey || '' },
      body: { number: num, text },
    };
  }

  // WAHA (padrão): POST /api/sendText
  return {
    url: `${base}/api/sendText`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey || '' },
    body: { session, chatId: `${num}@c.us`, text },
  };
}

/** Envia um texto para um número. Retorna a resposta (ou lança em erro de rede/HTTP). */
export async function sendText(cfg, number, text) {
  const req = buildRequest(cfg, number, text);
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: JSON.stringify(req.body),
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${detalhe ? ` — ${detalhe.slice(0, 140)}` : ''}`);
  }
  return res.json().catch(() => ({}));
}

/** Dispara o mesmo texto para todos os destinos configurados. */
export async function broadcast(cfg, text) {
  const numeros = parseNumbers(cfg.numbers);
  if (!numeros.length) throw new Error('Nenhum número de destino configurado.');
  const resultados = await Promise.allSettled(numeros.map((n) => sendText(cfg, n, text)));
  const enviados = resultados.filter((r) => r.status === 'fulfilled').length;
  const erro = resultados.find((r) => r.status === 'rejected');
  if (!enviados && erro) throw erro.reason;
  return { enviados, total: numeros.length };
}

/**
 * Empurra a agenda das próximas horas + config para o worker 24/7.
 * O worker persiste e dispara os lembretes na hora certa, mesmo app fechado.
 * Best-effort: falha de rede não deve quebrar o app.
 */
export async function pushAgenda(cfg, agenda) {
  const url = String(cfg.workerUrl || '').replace(/\/+$/, '');
  if (!url) return { skipped: true };
  const payload = {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    session: cfg.session,
    numbers: parseNumbers(cfg.numbers),
    agenda: agenda.map((l) => ({ at: l.at, text: `${l.emoji} ${l.text}` })),
    updatedAt: Date.now(),
  };
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.workerToken) headers['x-worker-token'] = cfg.workerToken;
  const res = await fetch(`${url}/routine`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Worker respondeu HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}
