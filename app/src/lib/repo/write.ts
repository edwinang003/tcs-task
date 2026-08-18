/**
 * The write primitives — the only place in the app that opens a transaction.
 *
 * SPEC §9.1 calls the atomicity of "row plus outbox entry" the single most
 * important detail in the sync engine, so it is enforced in one file rather
 * than trusted to every call site.
 *
 * P1's pull deliberately does NOT use these: rows arriving from the server
 * must not be enqueued straight back at it.
 */
import { db } from '../db'
import { appendOutbox } from '../outbox'
import { clientId } from '../device'
import type { TableName } from '../schema'
import type { UndoStep } from '../undo'

/**
 * SPEC §9.4: the client's wall clock never resolves a conflict — the server
 * stamps `updated_at` on push. This is the provisional local value, which P1's
 * pull will overwrite with the server's.
 */
export function now(): string {
  return new Date().toISOString()
}

/** The previous values of just the columns an edit is about to change. */
function pick(
  row: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, row[key]]))
}

export async function create<T extends { id: string }>(
  table: TableName,
  row: T,
  label: string,
): Promise<UndoStep> {
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    await db.table(table).add(row)
    await appendOutbox(table, row.id, Object.keys(row))
  })
  // Undoing a create is a soft delete, not a removal: SPEC §9 wants other
  // devices to learn the row is gone rather than never hear of it.
  return {
    label,
    toast: false,
    apply: () => write(table, row.id, { deleted_at: now() }, label),
  }
}

export async function write(
  table: TableName,
  id: string,
  changes: Record<string, unknown>,
  label: string,
  toast = false,
): Promise<UndoStep | null> {
  // SPEC §9.4: this is the provisional local value; the server stamps the
  // real `updated_at` on push.
  const stamped = { ...changes, updated_at: now(), client_id: clientId() }

  // SPEC §4.5: the previous value is captured inside the transaction that
  // changes it. Captured outside, a write landing in between would be silently
  // reverted by the undo.
  const previous = await db.transaction(
    'rw',
    db.table(table),
    db.outbox,
    async () => {
      const row = await db.table(table).get(id)
      // A row that is not there cannot be dirty. Enqueueing anyway would push
      // a phantom id at the server.
      if (row === undefined) return null
      // The columns in `changes`, not in `stamped`: restoring a previous
      // `updated_at` would push a server-owned column backwards (SPEC §4.1),
      // and the restore deserves its own stamp anyway.
      const before = pick(row as Record<string, unknown>, Object.keys(changes))
      await db.table(table).update(id, stamped)
      await appendOutbox(table, id, Object.keys(stamped))
      return before
    },
  )

  if (previous === null) return null
  return { label, toast, apply: () => write(table, id, previous, label) }
}

/**
 * Several writes in one transaction.
 *
 * Dexie joins an inner transaction to an outer one when the inner scope is a
 * subset, so `create` and `write` called inside this become part of one
 * all-or-nothing write rather than opening their own. `write.test.ts` proves
 * that rather than trusting it.
 *
 * `db.outbox` is always in scope: no write reaches the database without it.
 */
export function batch<T>(
  tables: TableName[],
  body: () => Promise<T>,
): Promise<T> {
  return db.transaction(
    'rw',
    [...tables.map((table) => db.table(table)), db.outbox],
    body,
  )
}

/**
 * Several writes, one undo step.
 *
 * Reversed newest-first, which is the order a person expects and the only
 * order that is safe: a section delete moves tasks and then tombstones the
 * section, so undoing it must restore the section before the tasks move back.
 *
 * Nulls are accepted so callers stay one line — `write` returns null for a row
 * that was already gone, and that is not a reason to lose the whole step.
 *
 * This is not one transaction, on purpose. SPEC §4.5: an undo is "reapplied as
 * an ordinary new mutation", so each write here is atomic with its own outbox
 * entry, exactly like the writes it reverses.
 */
export function composite(
  label: string,
  steps: (UndoStep | null)[],
  toast = false,
): UndoStep {
  const real = steps.filter((step): step is UndoStep => step !== null)
  return {
    label,
    toast,
    apply: async () => {
      for (const step of [...real].reverse()) await step.apply()
    },
  }
}
