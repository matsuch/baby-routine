-- Esquema do Rotina do Bebê (Neon / Postgres). A função /api/sync cria isto
-- sozinha na primeira chamada; este arquivo serve de referência/documentação.

create table if not exists families (
  family_key         text primary key,   -- sha256(codigo_de_familia + SYNC_PEPPER)
  profile            jsonb,               -- { baby, settings, meds } (última-edição-vence)
  profile_updated_at timestamptz
);

create table if not exists events (
  family_key text not null,
  id         text not null,              -- id do evento gerado no app
  data       jsonb not null,             -- o evento (mamada, fralda, arroto, dose...)
  deleted    boolean not null default false, -- tombstone, para exclusão sincronizar
  updated_at timestamptz not null default now(),
  primary key (family_key, id)
);

create index if not exists events_family_updated on events (family_key, updated_at);
