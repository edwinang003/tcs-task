import { db, MIN_KEY, MAX_KEY } from '../db'
import { uuidv7 } from '../ids'
import { clientId } from '../device'
import { activeWorkspace } from '../workspace'
import { create, write, batch, composite, now } from './write'
import { doneSectionOf, firstOpenSectionOf, getSection } from './sections'
import { appendPositionIn, positionBeforeIn } from './positions'
import { listChecklistItems } from './checklist'
import { listTaskLabels } from './labels'
import type { Task, Section } from '../schema'
import type { UndoStep } from '../undo'

/**
 * Every live task in the workspace, in position order.
 *
 * One index read serves both this and `listTasks`: Today and Upcoming span
 * every project, so a second index keyed by project would be a second thing to
 * keep correct for no measured gain.
 */
export async function listAllTasks(): Promise<Task[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.tasks
    .where('[workspace_id+position]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  // SPEC §9: deletions are soft, so tombstones live in the table and are
  // filtered by the reader — never by the query that syncs them.
  return rows.filter((t) => t.deleted_at === null)
}

/** Rows the list view shows: not deleted, in this project, in order. */
export async function listTasks(projectId: string): Promise<Task[]> {
  const rows = await listAllTasks()
  return rows.filter((t) => t.project_id === projectId)
}

export async function addTask(
  title: string,
  projectId: string,
  // A task captured from Today arrives dated, so it appears where it was
  // typed. Written in the create rather than in a second write: a follow-up
  // `setTaskDue` would append a second outbox entry for one user action and,
  // because the undo store holds a single step (SPEC §4.5), would push a step
  // over the create's own — so the undo would clear the date and leave the task.
  options: { dueOn?: string | null } = {},
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
      due_on: options.dueOn ?? null,
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
  // Where in the target section the task lands. Absent means the end, which
  // is what the checkbox and the sheet's picker want; a drag names a slot.
  slot?: { before: string | null },
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
        position:
          slot === undefined
            ? await appendPositionIn(target.id)
            : await positionBeforeIn(target.id, slot.before, task.id),
      },
      label,
      toast,
    ),
  )
}

/**
 * Completing a task, and the toast that usually goes with it.
 *
 * In the project list, completing takes the result off the screen — the task
 * leaves the section you were looking at for a collapsed Done — so it offers
 * the way back. Reopening does not: the task appears in the first open
 * section, in view.
 *
 * But whether the row actually leaves is the *list's* business, not this
 * function's, exactly as it is for `dropTaskAt`: in Today a completed task
 * stays where it is, struck through, and a toast for a row you can still see
 * is noise. So the caller may say so. The default is the project list's
 * behaviour, which is the one every existing caller wants.
 */
export async function setTaskDone(
  id: string,
  done: boolean,
  options: { toast?: boolean } = {},
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
    options.toast ?? done,
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
 * A drag, and the third caller of the binding above.
 *
 * `beforeId` is the task to land above, or null for the end of the section.
 * The toast is the caller's call, not this function's: a drop only takes its
 * result off the screen when the destination is a collapsed section, and only
 * the list knows what is collapsed.
 */
export async function dropTaskAt(
  id: string,
  sectionId: string,
  beforeId: string | null,
  options: { toast?: boolean } = {},
): Promise<UndoStep | null> {
  const task = await getTask(id)
  const target = await getSection(sectionId)
  if (task === undefined || target === undefined) return null
  return moveTaskTo(task, target, 'Task moved', options.toast ?? false, {}, {
    before: beforeId,
  })
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
 * The task's checklist items go with it, in the same transaction. SPEC §4.4
 * decides this one level up — deleting a project tombstones its sections,
 * tasks and checklist items — and the reasoning is unchanged here: an item
 * whose task is gone is unreachable, and leaving it live means P1 pushes
 * `checklist_items` rows for a row the server has been told to forget.
 *
 * The only mutation that takes its result off the screen, and so the only one
 * that raises a toast rather than relying on the keyboard.
 */
export async function deleteTask(id: string): Promise<UndoStep | null> {
  // `task_labels` joins the scope: a table absent from this list cannot be
  // written inside the transaction.
  return batch(['tasks', 'checklist_items', 'task_labels'], async () => {
    const items = await listChecklistItems(id)
    // Live links only. Untag is itself a tombstone, so a label removed from
    // this task last week must not come back when the delete is undone.
    const links = await listTaskLabels(id)
    const stamp = now()

    const steps: (UndoStep | null)[] = [
      await write('tasks', id, { deleted_at: stamp }, 'Task deleted'),
    ]
    for (const item of items) {
      steps.push(
        await write('checklist_items', item.id, { deleted_at: stamp }, 'Task deleted'),
      )
    }
    for (const link of links) {
      steps.push(
        await write('task_labels', link.id, { deleted_at: stamp }, 'Task deleted'),
      )
    }

    // One `deleted_at` for the whole gesture, so the tombstones agree about
    // when the task went away. `composite` reverses newest-first, which is
    // immaterial here — clearing `deleted_at` is order-free — but it is the
    // order `deleteSection` established and there is no reason to differ.
    return composite('Task deleted', steps, true)
  })
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
