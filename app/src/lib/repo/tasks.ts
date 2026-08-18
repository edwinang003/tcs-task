import { db, MIN_KEY, MAX_KEY } from '../db'
import { uuidv7 } from '../ids'
import { clientId } from '../device'
import { generateKeyBetween } from '../fractional-indexing'
import { activeWorkspace } from '../workspace'
import { create, write, now } from './write'
import type { Task } from '../schema'
import type { UndoStep } from '../undo'

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

export async function addTask(
  title: string,
): Promise<{ id: string; undo: UndoStep }> {
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

  return { id, undo: await create('tasks', row, 'Task added') }
}

export function setTaskDone(id: string, done: boolean): Promise<UndoStep | null> {
  // SPEC §4: `completed_at` and `section_id` are always written together,
  // because checking a task moves it to the done section and dragging it
  // there checks it. The done section row now exists; nothing moves into it
  // until the sections UI does, so only the timestamp moves.
  return write(
    'tasks',
    id,
    { completed_at: done ? now() : null },
    done ? 'Task completed' : 'Task reopened',
  )
}

export function renameTask(id: string, title: string): Promise<UndoStep | null> {
  const trimmed = title.trim()
  if (!trimmed) return Promise.resolve(null)
  return write('tasks', id, { title: trimmed }, 'Title changed')
}

/**
 * SPEC §9: deletions are soft. The row stays as a tombstone so that a device
 * offline for a week learns about the deletion instead of resurrecting it.
 *
 * The only mutation that takes its result off the screen, and so the only one
 * that raises a toast rather than relying on the keyboard.
 */
export function deleteTask(id: string): Promise<UndoStep | null> {
  return write('tasks', id, { deleted_at: now() }, 'Task deleted', true)
}

/**
 * One row by id, tombstone or not. The sheet needs to render a task that a
 * background delete may already have tombstoned; filtering here would blank the
 * form under the user's cursor instead.
 */
export function getTask(id: string): Promise<Task | undefined> {
  return db.tasks.get(id)
}

export function setTaskNotes(id: string, notes: string): Promise<UndoStep | null> {
  const trimmed = notes.trim()
  // SPEC §4.1 types notes `string | null`. Storing "" as well as null would
  // give the server two spellings of empty to reconcile.
  return write('tasks', id, { notes: trimmed === '' ? null : trimmed }, 'Notes changed')
}

/**
 * SPEC §4.1: a date plus an optional time, never a timestamp. They are written
 * together because a time without a date is not a due date, and clearing the
 * date has to clear the time with it.
 */
export function setTaskDue(
  id: string,
  dueOn: string | null,
  dueTime: string | null,
): Promise<UndoStep | null> {
  return write(
    'tasks',
    id,
    { due_on: dueOn, due_time: dueOn === null ? null : dueTime },
    'Due date changed',
  )
}

/** SPEC §4.1: 0 = none … 3 = highest, and 0 is a real value. */
export function setTaskPriority(
  id: string,
  priority: 0 | 1 | 2 | 3,
): Promise<UndoStep | null> {
  return write('tasks', id, { priority }, 'Priority changed')
}
