/**
 * The local database. The only file in the app that imports Dexie.
 *
 * SPEC §9: "the UI reads and writes IndexedDB; a background sync loop
 * reconciles IndexedDB with Postgres." P0a has the first half only.
 *
 * SPEC §11.3 rule 1: every dependency that could churn is imported in exactly
 * one file. Dexie is imported here and nowhere else — components go through
 * `repo.ts`, and read through `useLiveQuery` on the tables below.
 */

import Dexie, { type EntityTable, type Transaction } from 'dexie'
import { SERVER_OWNED_COLUMNS } from './schema'
import type {
  Task,
  Project,
  Section,
  ChecklistItem,
  Label,
  TaskLabel,
  OutboxEntry,
} from './schema'
import { activeWorkspace } from './workspace'
import { clientId } from './device'

/**
 * SPEC §12 item 7: the database name carries no user identity, so a second
 * user on this device gets their own database rather than colliding with ours.
 */
const DB_NAME = 'lane'

export type LaneDb = Dexie & {
  tasks: EntityTable<Task, 'id'>
  projects: EntityTable<Project, 'id'>
  sections: EntityTable<Section, 'id'>
  checklist_items: EntityTable<ChecklistItem, 'id'>
  labels: EntityTable<Label, 'id'>
  task_labels: EntityTable<TaskLabel, 'id'>
  outbox: EntityTable<OutboxEntry, 'seq'>
}

/**
 * Re-exported so that `repo.ts` can express open-ended index ranges without
 * importing Dexie itself (SPEC §11.3 rule 1).
 */
export const MIN_KEY = Dexie.minKey
export const MAX_KEY = Dexie.maxKey

const serverOwned = new Set<string>(SERVER_OWNED_COLUMNS)

/** SPEC §4.1: server-owned columns are never pushed by a client. */
function outboxEntry(table: string, row: { id: string }, stamp: string) {
  return {
    table,
    row_id: row.id,
    columns: Object.keys(row).filter((c) => !serverOwned.has(c)),
    status: 'pending' as const,
    reason: null,
    created_at: stamp,
  }
}

/**
 * The Inbox project and its two sections, with their outbox entries.
 *
 * Called from two places on purpose: `upgrade` for a database P0a left behind,
 * and `populate` for one created fresh at version 2 — Dexie runs an upgrade
 * only for a database that already existed, so a first install would otherwise
 * end up with an outbox and nothing in it.
 *
 * SPEC §12.3: the ids come from workspace.ts, which pins them precisely so
 * that rows created before a server exists line up with what P1 creates. Every
 * device generates the same ids here, which is harmless — push upserts by row
 * id, so the second device collapses onto the first.
 */
async function seedWorkspace(tx: Transaction): Promise<void> {
  const { workspaceId, projectId, sectionId, doneSectionId } = activeWorkspace()
  const stamp = new Date().toISOString()
  const sync = {
    workspace_id: workspaceId,
    updated_at: stamp,
    deleted_at: null,
    client_id: clientId(),
  }

  const project = {
    id: projectId,
    name: 'Inbox',
    color: null,
    icon: null,
    default_view: 'list',
    position: 'a0',
    archived_at: null,
    ...sync,
  }
  const sections = [
    {
      id: sectionId,
      project_id: projectId,
      name: 'Tasks',
      position: 'a0',
      is_done_section: false,
      ...sync,
    },
    {
      id: doneSectionId,
      project_id: projectId,
      name: 'Done',
      position: 'a1',
      is_done_section: true,
      ...sync,
    },
  ]

  await tx.table('projects').add(project)
  await tx.table('sections').bulkAdd(sections)
  // Order is the push order (SPEC §9.2): the project cannot arrive after the
  // sections that reference it.
  await tx.table('outbox').bulkAdd([
    outboxEntry('projects', project, stamp),
    ...sections.map((sct) => outboxEntry('sections', sct, stamp)),
  ])
}

/**
 * Indexes are the local mirror of SPEC §12.2's access paths.
 * `[workspace_id+position]` is how a list view reads;
 * `[workspace_id+updated_at]` is what P1's push scans for dirty rows.
 *
 * `ceiling` exists so that the migration test can open a genuine version 1
 * database without importing Dexie itself (SPEC §11.3 rule 1). Production
 * never passes it.
 */
export function createDb(
  name: string = DB_NAME,
  ceiling: 1 | 2 | 3 | 4 | 5 = 5,
): LaneDb {
  const db = new Dexie(name) as LaneDb

  db.version(1).stores({
    tasks:
      'id, [workspace_id+position], [workspace_id+updated_at], completed_at, deleted_at',
  })

  if (ceiling >= 2) {
    // Dexie carries unchanged tables forward, so `tasks` is not restated.
    db.version(2).stores({
      projects:
        'id, [workspace_id+position], [workspace_id+updated_at], deleted_at',
      sections:
        'id, [workspace_id+project_id], [workspace_id+updated_at], deleted_at',
      outbox: '++seq, table, [table+row_id], status',
    }).upgrade(async (tx) => {
      await seedWorkspace(tx)

      // Tasks typed during P0a were written before an outbox existed. Without
      // this backfill, P1's first push sends the project and none of the work
      // inside it (SPEC §9.1: never drop an entry).
      const stamp = new Date().toISOString()
      const tasks = await tx.table('tasks').toArray()
      await tx.table('outbox').bulkAdd(
        tasks.map((t: { id: string }) => outboxEntry('tasks', t, stamp)),
      )
    })

    // A database created fresh at v2 never runs an upgrade. The handler
    // belongs inside this block: `populate` fires for any database born from
    // nothing, and a version 1 one has no `projects` table to seed.
    db.on('populate', (tx) => seedWorkspace(tx))
  }

  if (ceiling >= 3) {
    // No `stores` call: `default_view` is not indexed, so the schema is
    // unchanged and Dexie carries every table forward. Only the data moves.
    db.version(3).upgrade(async (tx) => {
      await tx
        .table('projects')
        .toCollection()
        .modify((project: { default_view?: string }) => {
          project.default_view ??= 'list'
        })
    })
  }

  if (ceiling >= 4) {
    // The mirror of version 3: that one was an `upgrade` with no `stores`,
    // because `default_view` is not indexed and only the data moved. This one
    // is a `stores` with no `upgrade`, because a table that has never existed
    // has no rows to backfill. Between them they are both halves of a Dexie
    // migration.
    //
    // `[workspace_id+task_id]` serves both access paths on its own: one task's
    // items is an equality read, and every item in the workspace — what the row
    // counters need — is a range across the whole second component, the same
    // trick `listAllTasks` uses over `[workspace_id+position]`.
    db.version(4).stores({
      checklist_items:
        'id, [workspace_id+task_id], [workspace_id+updated_at], deleted_at',
    })
  }

  if (ceiling >= 5) {
    // Version 4's shape again: `stores` with no `upgrade`, because tables that
    // have never existed have no rows to backfill.
    //
    // `task_labels` gets one access-path index beside the sync pair, not two.
    // The label route wants "every task carrying label X", which reads like it
    // wants `[workspace_id+label_id]` — but the row dots need every join row in
    // the workspace already, so that filter runs over data the app is holding
    // regardless. A second index would be a second read path to keep correct
    // for no gain.
    //
    // `[workspace_id+name]` on `labels` is the drawer's read order and the
    // picker's duplicate check — the one that stops create-on-the-fly from
    // producing two labels called `errand`.
    db.version(5).stores({
      labels: 'id, [workspace_id+name], [workspace_id+updated_at], deleted_at',
      task_labels:
        'id, [workspace_id+task_id], [workspace_id+updated_at], deleted_at',
    })
  }

  return db
}

export const db = createDb()
