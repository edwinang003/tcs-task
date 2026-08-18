/**
 * Sections. SPEC §4: "Sections belong to a project", and each project has
 * exactly one flagged `is_done_section`.
 */
import { clientId } from '../device'
import { generateKeyBetween } from '../fractional-indexing'
import { activeWorkspace } from '../workspace'
import { db } from '../db'
import { create, write, composite, batch, now } from './write'
import { appendPositionIn } from './positions'
import { uuidv7 } from '../ids'
import type { Section } from '../schema'
import type { UndoStep } from '../undo'

/**
 * The two sections every project is born with.
 *
 * The names match what `db.ts`'s `seedWorkspace` gives the Inbox project, so a
 * project the user creates and the project the migration created are the same
 * shape.
 */
export function sectionRowsFor(projectId: string): [Section, Section] {
  const { workspaceId } = activeWorkspace()
  const sync = {
    workspace_id: workspaceId,
    updated_at: now(),
    deleted_at: null,
    client_id: clientId(),
  }
  const first = generateKeyBetween(null, null)
  return [
    {
      id: uuidv7(),
      project_id: projectId,
      name: 'Tasks',
      position: first,
      is_done_section: false,
      ...sync,
    },
    {
      id: uuidv7(),
      project_id: projectId,
      name: 'Done',
      position: generateKeyBetween(first, null),
      is_done_section: true,
      ...sync,
    },
  ]
}

/**
 * Live sections of one project, in position order.
 *
 * Sorted in memory because the `[workspace_id+project_id]` index does not
 * carry position — one index that answers "which sections" is enough for a
 * handful of rows, and a second one would be a second thing to keep correct.
 *
 * Deliberately does NOT force the done section last: `groupBySection` owns
 * display order, and two places enforcing one rule is how they drift apart.
 */
export async function listSections(projectId: string): Promise<Section[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.sections
    .where('[workspace_id+project_id]')
    .equals([workspaceId, projectId])
    .toArray()
  return rows
    .filter((s) => s.deleted_at === null)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
}

export function getSection(id: string): Promise<Section | undefined> {
  return db.sections.get(id)
}

/** SPEC §4: every project has exactly one. Its absence is broken data. */
export async function doneSectionOf(projectId: string): Promise<Section> {
  const section = (await listSections(projectId)).find((s) => s.is_done_section)
  if (section === undefined) {
    throw new Error(`project ${projectId} has no done section`)
  }
  return section
}

/** SPEC §4.4 refuses to delete the last one, so this always finds one. */
export async function firstOpenSectionOf(projectId: string): Promise<Section> {
  const section = (await listSections(projectId)).find((s) => !s.is_done_section)
  if (section === undefined) {
    throw new Error(`project ${projectId} has no open section`)
  }
  return section
}

/** Appends after the last section, which keeps Done at the foot. */
export async function addSection(
  projectId: string,
  name: string,
): Promise<{ id: string; undo: UndoStep }> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('refusing to create a section with no name')

  const sections = await listSections(projectId)
  const row: Section = {
    id: uuidv7(),
    workspace_id: activeWorkspace().workspaceId,
    project_id: projectId,
    name: trimmed,
    position: generateKeyBetween(sections.at(-1)?.position ?? null, null),
    is_done_section: false,
    updated_at: now(),
    deleted_at: null,
    client_id: clientId(),
  }

  return { id: row.id, undo: await create('sections', row, 'Section added') }
}

export function renameSection(
  id: string,
  name: string,
): Promise<UndoStep | null> {
  const trimmed = name.trim()
  if (!trimmed) return Promise.resolve(null)
  return write('sections', id, { name: trimmed }, 'Section renamed')
}

/**
 * SPEC §4.4: "its tasks move to the project's first remaining section, they
 * are *not* deleted. A section is a status label, and losing a status should
 * never lose the work."
 *
 * Both refusals come from the same paragraph: a project keeps exactly one done
 * section (§4) and at least one open one, "and deleting the last one is
 * refused".
 *
 * The task moves do not go through the §4 binding, and do not need to: neither
 * the section being emptied nor the one receiving its tasks can be a done
 * section, so no task's `completed_at` changes.
 */
export async function deleteSection(id: string): Promise<UndoStep> {
  const section = await getSection(id)
  if (section === undefined || section.deleted_at !== null) {
    throw new Error(`no such section: ${id}`)
  }
  if (section.is_done_section) {
    throw new Error('the done section cannot be deleted')
  }

  const remaining = (await listSections(section.project_id)).filter(
    (s) => !s.is_done_section && s.id !== id,
  )
  if (remaining.length === 0) {
    throw new Error('a project needs at least one open section')
  }
  const target = remaining[0]

  const orphans = (await db.tasks.toArray()).filter(
    (t) => t.section_id === id && t.deleted_at === null,
  )

  const steps = await batch(['sections', 'tasks'], async () => {
    const moves: (UndoStep | null)[] = []
    for (const task of orphans) {
      moves.push(
        await write(
          'tasks',
          task.id,
          { section_id: target.id, position: await appendPositionIn(target.id) },
          'Section deleted',
        ),
      )
    }
    // The section goes last, so undoing newest-first restores it before the
    // tasks move back into it.
    moves.push(await write('sections', id, { deleted_at: now() }, 'Section deleted'))
    return moves
  })

  return composite('Section deleted', steps, true)
}
