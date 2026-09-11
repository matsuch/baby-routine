/**
 * Núcleo do "robô" que dispara os avisos automáticos (sem dependências de
 * banco/rede — tudo injetado, para testar). Roda periodicamente (ex.: a cada
 * 10 min, disparado pelo GitHub Actions) e, para cada família:
 *
 *  1. lê os eventos recentes + perfil (ntfy, remédios, intervalo…)
 *  2. pergunta ao agenda-core o que está vencendo AGORA
 *  3. envia no ntfy só o que ainda não foi enviado (dedup no banco)
 *
 * Como recalcula do zero a cada rodada, não há nada "pré-agendado" para
 * cancelar: antecipar/atrasar uma mamada muda o próximo automaticamente.
 *
 * `db` (async):
 *   now()                         -> epoch ms
 *   listFamilies()                -> [{ key, profile }]  (só as com perfil)
 *   getRecentEvents(key, sinceMs) -> [data...]           (eventos não apagados)
 *   markSent(key, pushKey)        -> true se inseriu agora (false se já existia)
 *   unmarkSent(key, pushKey)      -> desfaz (usado se o envio falhar)
 *   pruneSent(beforeMs)           -> limpa dedup antigo
 *
 * `deps`:
 *   publish(cfg, { title, message, tags, priority }) -> Promise (envia 1 push)
 *   log(...)                                          -> opcional
 */
import { dueReminders, MS_HOUR } from './agenda-core.mjs';

const HEADER_LATIN1 = /^[ -ÿ]*$/;

export async function runCron(db, { publish, log = () => {} } = {}) {
  if (typeof publish !== 'function') throw new Error('publish() é obrigatório');
  const now = await db.now();
  const familias = await db.listFamilies();
  let enviados = 0;
  let consideradas = 0;

  for (const fam of familias) {
    const perfil = fam.profile;
    const ntfy = perfil?.settings?.ntfy;
    if (!ntfy || !ntfy.enabled || !ntfy.topic) continue; // sem push configurado
    consideradas += 1;

    // 3 dias cobrem com folga a última mamada (3h) e a última dose (até 12h).
    const eventos = await db.getRecentEvents(fam.key, now - 3 * 24 * MS_HOUR);
    const vencendo = dueReminders(perfil, eventos, { now });
    if (!vencendo.length) continue;

    const nome = String(perfil?.baby?.name || '').trim();
    const title = HEADER_LATIN1.test(`Rotina · ${nome}`) && nome ? `Rotina · ${nome}` : 'Rotina';

    for (const r of vencendo) {
      // Insere o dedup ANTES de enviar (idempotente e à prova de corrida):
      // se outro tick já mandou, markSent devolve false e a gente pula.
      const novo = await db.markSent(fam.key, r.key);
      if (!novo) continue;
      try {
        await publish(ntfy, { title, message: r.message, tags: r.tags, priority: 'high' });
        enviados += 1;
        log(`enviado ${r.kind} -> ${fam.key.slice(0, 8)}…`);
      } catch (err) {
        await db.unmarkSent(fam.key, r.key); // deixa reenviar no próximo tick
        log(`falha ao enviar ${r.kind}: ${err.message}`);
      }
    }
  }

  await db.pruneSent(now - 3 * 24 * MS_HOUR).catch(() => {});
  return { now, familias: familias.length, consideradas, enviados };
}
