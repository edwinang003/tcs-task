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

import Dexie, { type EntityTable } from 'dexie'
import type { Task, Project, Section, OutboxEntry } from './schema'

/**
 * SPEC §12 item 7: the database name carries no user identity, so a second
 * user on this device gets their own database rather than colliding with ours.
 */
const DB_NAME = 'lane'

export type LaneDb = Dexie & {
  tasks: EntityTable<Task, 'id'>
  projects: EntityTable<Project, 'id'>
  sections: EntityTable<Section, 'id'>
  outbox: EntityTable<OutboxEntry, 'seq'>
}

/**
 * Re-exported so that `repo.ts` can express open-ended index ranges without
 * importing Dexie itself (SPEC §11.3 rule 1).
 */
export const MIN_KEY = Dexie.minKey
export const MAX_KEY = Dexie.maxKey

/**
 * Indexes are the local mirror of SPEC §12.2's access paths.
 * `[workspace_id+position]` is how a list view reads;
 * `[workspace_id+updated_at]` is what P1's push scans for dirty rows.
 *
 * `ceiling` exists so that the migration test can open a genuine version 1
 * database without importing Dexie itself (SPEC §11.3 rule 1). Production
 * never passes it.
 */
export function createDb(name: string = DB_NAME, ceiling: 1 | 2 = 2): LaneDb {
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
      outbox: '++seq, [table+row_id], status',
    })
  }

  return db
}

export const db = createDb()
