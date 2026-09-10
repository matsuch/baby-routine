/**
 * Núcleo da sincronização (sem dependências): recebe o que o app empurrou e
 * devolve o que mudou desde o cursor. Separado do banco para dar para testar.
 *
 * Modelo:
 *  - Eventos sincronizam um a um (append + edição + tombstone de exclusão),
 *    então dois celulares registrando ao mesmo tempo NÃO se sobrescrevem.
 *  - O "perfil" (bebê, ajustes, remédios) sincroniza por última-edição-vence.
 *
 * O `db` injetado precisa expor (todos async):
 *   now()                         -> epoch ms do relógio do banco
 *   getEventsSince(key, sinceMs)  -> [{ id, data, deleted, updatedMs }]
 *   upsertEvents(key, events)     -> grava [{ id, data, deleted }] com updated_at=now()
 *   getProfile(key)               -> { data, updatedMs } | null
 *   upsertProfile(key, data)      -> grava o perfil com updated_at=now()
 */

export const MAX_EVENTS_PER_SYNC = 1000;

/** Limpa um evento vindo do cliente para gravar (sem campos locais). */
export function sanitizeEvent(ev) {
  if (!ev || typeof ev.id !== 'string' || !ev.id) return null;
  const data = { ...ev };
  delete data._dirty;
  delete data.deleted;
  return { id: ev.id.slice(0, 64), data, deleted: !!ev.deleted };
}

/**
 * Aplica o push e devolve o pull. `familyKey` já vem resolvido (hash) do wrapper.
 * `since` é o cursor (epoch ms do servidor) da última resposta que o app viu.
 */
export async function applySync(db, { familyKey, since = 0, events = [], profile = null } = {}) {
  if (!familyKey) throw new Error('familyKey ausente');

  const limpos = (Array.isArray(events) ? events : [])
    .slice(0, MAX_EVENTS_PER_SYNC)
    .map(sanitizeEvent)
    .filter(Boolean);
  if (limpos.length) await db.upsertEvents(familyKey, limpos);

  if (profile && profile.data && typeof profile.data === 'object') {
    await db.upsertProfile(familyKey, profile.data);
  }

  // now() antes do pull: itens escritos entre agora e a leitura podem voltar
  // de novo na próxima vez (idempotente no cliente), mas nada é perdido.
  const now = await db.now();
  const changed = await db.getEventsSince(familyKey, Number(since) || 0);
  const prof = await db.getProfile(familyKey);

  return {
    now,
    events: changed.map((e) => ({ id: e.id, data: e.data, deleted: !!e.deleted, updatedMs: e.updatedMs })),
    profile: prof ? { data: prof.data, updatedMs: prof.updatedMs } : null,
  };
}
