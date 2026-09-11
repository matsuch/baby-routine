/**
 * Função serverless da Vercel: GET/POST /api/cron.
 *
 * O "despertador" (GitHub Actions, a cada ~10 min) chama este endpoint. Ele lê
 * o Neon, pergunta ao agenda-core o que está vencendo AGORA e dispara no ntfy —
 * em tempo real, então antecipar/atrasar uma mamada muda o próximo aviso sozinho
 * (nada fica pré-agendado para cancelar).
 *
 * Env (Vercel → Settings → Environment Variables):
 *   DATABASE_URL      — Neon (mesma do /api/sync)
 *   PUSH_CRON_SECRET  — segredo compartilhado com o despertador (opcional, mas
 *                       recomendado; se ausente, o endpoint fica aberto)
 */
import { neon } from '@neondatabase/serverless';
import { runCron } from '../lib/cron-core.mjs';
import { publish } from '../assets/js/ntfy.js';

let _sql = null;
function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}
const sql = (strings, ...values) => getSql()(strings, ...values);

let schemaPronto = null;
function ensureSchema() {
  if (!schemaPronto) {
    schemaPronto = (async () => {
      await sql`create table if not exists sent_pushes (
        family_key text not null,
        key text not null,
        sent_at timestamptz not null default now(),
        primary key (family_key, key)
      )`;
    })().catch((err) => { schemaPronto = null; throw err; });
  }
  return schemaPronto;
}

const db = {
  async now() {
    const r = await sql`select extract(epoch from now()) * 1000 as now`;
    return Number(r[0].now);
  },
  async listFamilies() {
    const r = await sql`select family_key, profile from families where profile is not null`;
    return r.map((row) => ({ key: row.family_key, profile: row.profile }));
  },
  async getRecentEvents(key, sinceMs) {
    const r = await sql`
      select data from events
      where family_key = ${key} and deleted = false
        and (data->>'at')::double precision > ${sinceMs}
      order by (data->>'at')::double precision asc
      limit 2000`;
    return r.map((row) => row.data);
  },
  async markSent(key, pushKey) {
    const r = await sql`
      insert into sent_pushes (family_key, key) values (${key}, ${pushKey})
      on conflict (family_key, key) do nothing
      returning key`;
    return r.length > 0;
  },
  async unmarkSent(key, pushKey) {
    await sql`delete from sent_pushes where family_key = ${key} and key = ${pushKey}`;
  },
  async pruneSent(beforeMs) {
    await sql`delete from sent_pushes where sent_at < to_timestamp(${beforeMs} / 1000.0)`;
  },
};

/** Confere o segredo (header Authorization: Bearer, x-cron-secret ou ?key=). */
function autorizado(req) {
  const esperado = process.env.PUSH_CRON_SECRET;
  if (!esperado) return true; // sem segredo configurado: endpoint aberto
  const auth = req.headers.authorization || '';
  const url = new URL(req.url, 'http://x');
  const dado = auth.replace(/^Bearer\s+/i, '') || req.headers['x-cron-secret'] || url.searchParams.get('key') || '';
  return dado === esperado;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'use GET ou POST' });
  }
  if (!autorizado(req)) return res.status(401).json({ error: 'não autorizado' });
  if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'DATABASE_URL não configurada' });

  try {
    await ensureSchema();
    const resumo = await runCron(db, { publish, log: (m) => console.log('[cron]', m) });
    return res.status(200).json({ ok: true, ...resumo });
  } catch (err) {
    console.error('cron falhou:', err);
    return res.status(500).json({ error: 'falha no cron' });
  }
}
