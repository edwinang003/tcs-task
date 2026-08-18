/**
 * The outbox. SPEC §9.1: "Every local mutation writes the row **and** appends
 * an outbox entry **in the same IndexedDB transaction**. A row written without
 * its outbox entry is a silently lost change — this atomicity is the single
 * most important detail in the sync engine."
 *
 * Which is why `appendOutbox` does not open a transaction of its own. It must
 * be called inside the caller's, so that a failure rolls back both.
 */

import { db } from './db'
import { SERVER_OWNED_COLUMNS, type TableName } from './schema'

const SERVER_OWNED = new Set<string>(SERVER_OWNED_COLUMNS)

export async function appendOutbox(
  table: TableName,
  rowId: string,
  columns: string[],
): Promise<void> {
  // SPEC §4.1: the push payload whitelist is explicit, and these are not on it.
  const dirty = columns.filter((c) => !SERVER_OWNED.has(c))
  if (dirty.length === 0) return

  const pending = await db.outbox
    .where('[table+row_id]')
    .equals([table, rowId])
    .filter((e) => e.status === 'pending')
    .first()

  if (pending) {
    // SPEC §9.2: the seq is left alone on purpose. A project created before
    // the tasks inside it must keep its lower sequence number however many
    // times those tasks are edited afterwards.
    await db.outbox.update(pending.seq, {
      columns: [...new Set([...pending.columns, ...dirty])],
    })
    return
  }

  await db.outbox.add({
    table,
    row_id: rowId,
    columns: [...new Set(dirty)],
    status: 'pending',
    reason: null,
    created_at: new Date().toISOString(),
  } as never)
}
