import { db, MIN_KEY, MAX_KEY } from '../db'
import { uuidv7 } from '../ids'
import { clientId } from '../device'
import { activeWorkspace } from '../workspace'
import { create, write, batch, now } from './write'
import { doneSectionOf, firstOpenSectionOf, getSection } from './sections'
import { appendPositionIn } from './positions'
import { generateKeyBetween } from '../fractional-indexing'
import type { Task, Section } from '../schema'
import type { UndoStep } from '../undo'

/** Rows the list view shows: not deleted, in this project, in order. */
export async function listTasks(projectId: string): Promise<Task[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.tasks
    .where('[workspace_id+position]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  // Filtered rather than indexed by project: slice 4's Today and Upcoming span
  // every project and want this same workspace-wide read, so a second index
  // would be a second thing to keep correct for no measured gain.
  return rows.filter((t) => t.deleted_at === null && t.project_id === projectId)
}

export async function addTask(
  title: string,
  projectId: string,
): Promise<{ id: string; undo: UndoStep }> {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('refusing to create a task with no title')

  const { workspaceId } = activeWorkspace()
  const section = await firstOpenSectionOf(projectId)
  const id = uuidv7()

  // The position is derived inside the transaction that writes it. QuickAdd
  // keeps focus so the next task can be submitted before this one has landed;
  // read outside, both submissions see the same last key.
  const undo = await batch(['tasks'], async () => {
    const row: Task = {
      id,
      workspace_id: workspaceId,
      project_id: projectId,
      section_id: section.id,
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
      position: await appendPositionIn(section.id),
      created_by: null,
      assignee_id: null,
      updated_at: now(),
      deleted_at: null,
      client_id: clientId(),
    }
    return create('tasks', row, 'Task added')
  })

  return { id, undo }
}

/**
 * The §4 binding, in one place. Nothing else writes these three columns.
 *
 * SPEC §4: "checking a task's checkbox moves it into that section, and
 * dragging a task into that section checks its checkbox. `completed_at` and
 * `section_id` are always written together, never independently." Both public
 * entry points below route through here, so the two halves cannot disagree —
 * and the drag slice adds a third caller rather than a fourth copy of the rule.
 */
async function moveTaskTo(
  task: Task,
  target: Section,
  label: string,
  toast: boolean,
  extra: Record<string, unknown> = {},
  // A drop lands between two neighbours rather than at the end. Passed in so
  // the binding below stays the only place that writes these three columns.
  position?: string,
): Promise<UndoStep | null> {
  // Same transaction for the read and the write: two checkboxes tapped in
  // quick succession both append into the done section.
  return batch(['tasks'], async () =>
    write(
      'tasks',
      task.id,
      {
        ...extra,
        // Landing in the done section completes the task; leaving it reopens
        // it. An existing timestamp is kept, so P2's completed log reads the
        // moment the work was finished rather than the last time the row was
        // touched.
        completed_at: target.is_done_section
          ? (task.completed_at ?? now())
          : null,
        section_id: target.id,
        position: position ?? (await appendPositionIn(target.id)),
      },
      label,
      toast,
    ),
  )
}

/**
 * A toast, because this is the one completion path that takes its result off
 * the screen — the task leaves the section you were looking at. Reopening does
 * not: the task appears in the first open section, in view.
 */
export async function setTaskDone(
  id: string,
  done: boolean,
): Promise<UndoStep | null> {
  const task = await getTask(id)
  if (task === undefined) return null
  const target = done
    ? await doneSectionOf(task.project_id)
    : await firstOpenSectionOf(task.project_id)
  return moveTaskTo(
    task,
    target,
    done ? 'Task completed' : 'Task reopened',
    done,
  )
}

/**
 * SPIKE (touch drag) — throwaway. Drop `id` into `sectionId` directly above
 * `beforeId`, or at the end when that is null.
 *
 * Routes through `moveTaskTo` like every other move, so dropping into the done
 * section ticks the checkbox exactly as the sheet's picker does.
 */
export async function dropTaskAt(
  id: string,
  sectionId: string,
  beforeId: string | null,
): Promise<UndoStep | null> {
  const task = await getTask(id)
  const target = await getSection(sectionId)
  if (task === undefined || target === undefined) return null

  const siblings = (await db.tasks.toArray())
    .filter(
      (t) =>
        t.section_id === sectionId && t.deleted_at === null && t.id !== id,
    )
    .sort((a, b) => (a.position < b.position ? -1 : 1))

  const at = beforeId === null ? -1 : siblings.findIndex((t) => t.id === beforeId)
  const index = at === -1 ? siblings.length : at
  const previous = siblings[index - 1]?.position ?? null
  const next = siblings[index]?.position ?? null

  return moveTaskTo(
    task,
    target,
    'Task moved',
    false,
    {},
    generateKeyBetween(previous, next),
  )
}

/** The sheet's Section picker — the non-drag half of §4's binding. */
export async function setTaskSection(
  id: string,
  sectionId: string,
): Promise<UndoStep | null> {
  const task = await getTask(id)
  const target = await getSection(sectionId)
  if (task === undefined || target === undefined) return null
  return moveTaskTo(task, target, 'Task moved', target.is_done_section)
}

/**
 * A `section_id` from the old project would orphan the row, so the task lands
 * in the target project's done section if it was complete and its first open
 * section otherwise — which keeps §4's rule true across the move.
 */
export async function setTaskProject(
  id: string,
  projectId: string,
): Promise<UndoStep | null> {
  const task = await getTask(id)
  if (task === undefined) return null
  const target =
    task.completed_at !== null
      ? await doneSectionOf(projectId)
      : await firstOpenSectionOf(projectId)
  return moveTaskTo(task, target, 'Task moved', false, { project_id: projectId })
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
