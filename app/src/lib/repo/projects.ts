/**
 * Projects. SPEC §4.4 decides what happens when one goes away: archiving is
 * "the safe default the UI should nudge toward" and is what this slice ships;
 * deleting cascades to sections, tasks and checklist items and gets its own
 * slice with a confirm.
 */
import { db, MIN_KEY, MAX_KEY } from '../db'
import { uuidv7 } from '../ids'
import { clientId } from '../device'
import { generateKeyBetween } from '../fractional-indexing'
import { activeWorkspace } from '../workspace'
import { create, write, composite, batch, now } from './write'
import { sectionRowsFor } from './sections'
import type { Project } from '../schema'
import type { UndoStep } from '../undo'

/** What the drawer shows: live, not archived, in order. */
export async function listProjects(): Promise<Project[]> {
  const { workspaceId } = activeWorkspace()
  const rows = await db.projects
    .where('[workspace_id+position]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .toArray()
  // SPEC §9: deletions are soft, so tombstones live in the table and are
  // filtered by the reader — never by the query that syncs them.
  return rows.filter((p) => p.deleted_at === null && p.archived_at === null)
}

export function getProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id)
}

/**
 * SPEC §4: a project is never created alone — it has exactly one done section
 * from the moment it exists, or the binding has nowhere to move tasks to.
 *
 * The three rows go in one transaction and come back as one undo step. The
 * order matters beyond tidiness: SPEC §9.2 makes seq the push order, and the
 * project cannot arrive after the sections that reference it.
 */
export async function addProject(
  name: string,
): Promise<{ id: string; undo: UndoStep }> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('refusing to create a project with no name')

  const { workspaceId } = activeWorkspace()
  const id = uuidv7()
  const last = await db.projects
    .where('[workspace_id+position]')
    .between([workspaceId, MIN_KEY], [workspaceId, MAX_KEY])
    .last()

  const project: Project = {
    id,
    workspace_id: workspaceId,
    name: trimmed,
    color: null,
    icon: null,
    default_view: 'list',
    position: generateKeyBetween(last?.position ?? null, null),
    archived_at: null,
    updated_at: now(),
    deleted_at: null,
    client_id: clientId(),
  }
  const [tasks, done] = sectionRowsFor(id)

  const steps = await batch(['projects', 'sections'], async () => [
    await create('projects', project, 'Project added'),
    await create('sections', tasks, 'Project added'),
    await create('sections', done, 'Project added'),
  ])

  return { id, undo: composite('Project added', steps) }
}

export function renameProject(
  id: string,
  name: string,
): Promise<UndoStep | null> {
  const trimmed = name.trim()
  if (!trimmed) return Promise.resolve(null)
  return write('projects', id, { name: trimmed }, 'Project renamed')
}

/**
 * SPEC §4.4: "nothing is deleted; it leaves the sidebar". A toast, because
 * leaving the sidebar is exactly the kind of disappearance §4.5's undo exists
 * for.
 */
export function archiveProject(id: string): Promise<UndoStep | null> {
  return write('projects', id, { archived_at: now() }, 'Project archived', true)
}
