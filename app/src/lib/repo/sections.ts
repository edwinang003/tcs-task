/**
 * Sections. SPEC §4: "Sections belong to a project", and each project has
 * exactly one flagged `is_done_section`.
 */
import { clientId } from '../device'
import { generateKeyBetween } from '../fractional-indexing'
import { activeWorkspace } from '../workspace'
import { now } from './write'
import { uuidv7 } from '../ids'
import type { Section } from '../schema'

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
