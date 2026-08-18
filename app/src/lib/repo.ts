/**
 * The repository layer — the only path by which anything writes.
 *
 * SPEC §13, P0b constraint: "every write in P0b goes through a repository
 * layer that writes the row and appends an outbox entry in one transaction
 * (§9.1) ... Skip this and P1 rewrites every write path in the app — which is
 * the single most common way local-first projects stall."
 *
 * P0a has no server, so there is no outbox yet. The seam is what matters: each
 * function below already runs inside a Dexie transaction, so P0b adds the
 * outbox append *inside* these transactions and no component changes.
 */

import { db, MIN_KEY, MAX_KEY } from './db'
import { appendOutbox } from './outbox'
import { clientId } from './device'
import { uuidv7 } from './ids'
import { generateKeyBetween } from './fractional-indexing'
import { activeWorkspace } from './workspace'
import type { Task, TableName } from './schema'

/**
 * SPEC §9.4: the client's wall clock never resolves a conflict — the server
 * stamps `updated_at` on push. This is the provisional local value, which P1's
 * pull will overwrite with the server's.
 */
function now(): string {
  return new Date().toISOString()
}

/**
 * The two write primitives. Everything below goes through them, so a row
 * cannot be written without its outbox entry — SPEC §9.1 calls that atomicity
 * "the single most important detail in the sync engine".
 *
 * P1's pull deliberately does NOT use these: rows arriving from the server
 * must not be enqueued straight back at it.
 */
async function create<T extends { id: string }>(
  table: TableName,
  row: T,
): Promise<void> {
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    await db.table(table).add(row)
    await appendOutbox(table, row.id, Object.keys(row))
  })
}

async function write(
  table: TableName,
  id: string,
  changes: Record<string, unknown>,
): Promise<void> {
  // SPEC §9.4: this is the provisional local value; the server stamps the
  // real `updated_at` on push.
  const stamped = { ...changes, updated_at: now(), client_id: clientId() }
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    const updated = await db.table(table).update(id, stamped)
    // A row that is not there cannot be dirty. Enqueueing anyway would push a
    // phantom id at the server.
    if (updated === 0) return
    await appendOutbox(table, id, Object.keys(stamped))
  })
}

/** Rows the list view shows: not deleted, in this workspace, in order. */
export async function listTasks(): Promise<Task[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.tasks
    .where('[workspace_id+position]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  // SPEC §9: deletions are soft, so tombstones live in the table and are
  // filtered by the reader — never by the query that syncs them (§12.1 trap 1).
  return rows.filter((t) => t.deleted_at === null)
}

export async function addTask(title: string): Promise<string> {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('refusing to create a task with no title')

  const { workspaceId, projectId, sectionId } = activeWorkspace()
  const id = uuidv7()

  // New tasks append to the end of the list.
  const last = await db.tasks
    .where('[workspace_id+position]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .last()

  const row: Task = {
    id,
    workspace_id: workspaceId,
    project_id: projectId,
    section_id: sectionId,
    title: trimmed,
    notes: null,
    due_on: null,
    due_time: null,
    reminder_at: null,
    reminder_sent_at: null,
    priority: 0,
    completed_at: null,
    recurrence_rule: null,
    recurrence_parent_id: null,
    position: generateKeyBetween(last?.position ?? null, null),
    created_by: null,
    assignee_id: null,
    updated_at: now(),
    deleted_at: null,
    client_id: clientId(),
  }

  await create('tasks', row)
  return id
}

export function setTaskDone(id: string, done: boolean): Promise<void> {
  // SPEC §4: `completed_at` and `section_id` are always written together,
  // because checking a task moves it to the done section and dragging it
  // there checks it. The done section row now exists; nothing moves into it
  // until the sections UI does, so only the timestamp moves.
  return write('tasks', id, { completed_at: done ? now() : null })
}

export function renameTask(id: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return Promise.resolve()
  return write('tasks', id, { title: trimmed })
}

/**
 * SPEC §9: deletions are soft. The row stays as a tombstone so that a device
 * offline for a week learns about the deletion instead of resurrecting it.
 */
export function deleteTask(id: string): Promise<void> {
  return write('tasks', id, { deleted_at: now() })
}
