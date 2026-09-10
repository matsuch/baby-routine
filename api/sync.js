/**
 * Função serverless da Vercel: POST /api/sync.
 * Sincroniza a rotina entre celulares via "código de família", usando Neon (Postgres).
 *
 * Env necessárias (Vercel → Settings → Environment Variables):
 *   DATABASE_URL  — connection string do Neon (com sslmode=require)
 *   SYNC_PEPPER   — segredo do servidor; embaralha o código antes de virar chave
 *
 * O código de família nunca é gravado em claro: guardamos só sha256(código+PEPPER).
 */
import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import { applySync } from '../lib/sync-core.mjs';

// Inicialização preguiçosa: não quebra no cold start se DATABASE_URL faltar.
let _sql = null;
function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}
const sql = (strings, ...values) => getSql()(strings, ...values);

function familyKey(code) {
  return createHash('sha256').update(`${code}::${process.env.SYNC_PEPPER || ''}`).digest('hex');
}

let schemaPronto = null;
function ensureSchema() {
  if (!schemaPronto) {
    schemaPronto = (async () => {
      await sql`create table if not exists families (
        family_key text primary key,
        profile jsonb,
        profile_updated_at timestamptz
      )`;
      await sql`create table if not exists events (
        family_key text not null,
        id text not null,
        data jsonb not null,
        deleted boolean not null default false,
        updated_at timestamptz not null default now(),
        primary key (family_key, id)
      )`;
      await sql`create index if not exists events_family_updated on events (family_key, updated_at)`;
    })().catch((err) => { schemaPronto = null; throw err; });
  }
  return schemaPronto;
}

// Adaptador de banco que o núcleo (lib/sync-core) usa.
const db = {
  async now() {
    const r = await sql`select extract(epoch from now()) * 1000 as now`;
    return Number(r[0].now);
  },
  async getEventsSince(key, sinceMs) {
    const r = await sql`
      select id, data, deleted, extract(epoch from updated_at) * 1000 as u
      from events
      where family_key = ${key} and updated_at > to_timestamp(${sinceMs} / 1000.0)
      order by updated_at asc
      limit 3000`;
    return r.map((row) => ({ id: row.id, data: row.data, deleted: row.deleted, updatedMs: Number(row.u) }));
  },
  async upsertEvents(key, events) {
    for (const e of events) {
      await sql`
        insert into events (family_key, id, data, deleted, updated_at)
        values (${key}, ${e.id}, ${JSON.stringify(e.data)}::jsonb, ${e.deleted}, now())
        on conflict (family_key, id)
        do update set data = excluded.data, deleted = excluded.deleted, updated_at = now()`;
    }
  },
  async getProfile(key) {
    const r = await sql`
      select profile, extract(epoch from profile_updated_at) * 1000 as u
      from families where family_key = ${key}`;
    if (!r.length || r[0].profile == null) return null;
    return { data: r[0].profile, updatedMs: Number(r[0].u) };
  },
  async upsertProfile(key, data) {
    await sql`
      insert into families (family_key, profile, profile_updated_at)
      values (${key}, ${JSON.stringify(data)}::jsonb, now())
      on conflict (family_key)
      do update set profile = excluded.profile, profile_updated_at = now()`;
  },
};

async function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let dados = '';
  for await (const chunk of req) dados += chunk;
  return dados ? JSON.parse(dados) : {};
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });

  if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'DATABASE_URL não configurada' });

  try {
    const body = await lerCorpo(req);
    const code = String(body.familyCode || '').trim();
    if (code.length < 4) return res.status(400).json({ error: 'código de família inválido (mín. 4 caracteres)' });

    await ensureSchema();
    const resultado = await applySync(db, {
      familyKey: familyKey(code),
      since: body.since,
      events: body.events,
      profile: body.profile,
    });
    return res.status(200).json(resultado);
  } catch (err) {
    console.error('sync falhou:', err);
    return res.status(500).json({ error: 'falha ao sincronizar' });
  }
}
