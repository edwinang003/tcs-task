/**
 * The row shapes, and the sync columns every row carries from day one.
 *
 * SPEC §15: "every row is created with its full sync column set (§4.1)". P0a
 * has one hardcoded list, so most of these are null — but they exist, and they
 * are populated from variables rather than constants, so P0b and P1 add
 * behaviour rather than a migration.
 */

/** SPEC §4.1 — present on every syncable row. */
export interface SyncColumns {
  /** UUIDv7, generated on the client — offline creation requires it. */
  id: string
  /** SPEC §12 item 1: on every row from the start, even with one workspace. */
  workspace_id: string
  /** Server-stamped on write (SPEC §4.1). Provisional until P1's first push. */
  updated_at: string
  /** Soft delete — a tombstone, so other devices learn about deletions. */
  deleted_at: string | null
  /** Which device last wrote. Used in P1 to skip echoing our own changes. */
  client_id: string
}

/** SPEC §4.1 — `tasks`. */
export interface Task extends SyncColumns {
  project_id: string
  section_id: string
  title: string
  notes: string | null
  /** A date, not a timestamp (SPEC §4.1) — "due Tuesday" stays Tuesday. */
  due_on: string | null
  due_time: string | null
  reminder_at: string | null
  /** Server-owned (SPEC §4.1): never written or pushed by a client. */
  reminder_sent_at: string | null
  /** 0 = none … 3 = highest (SPEC §4.1). */
  priority: 0 | 1 | 2 | 3
  completed_at: string | null
  recurrence_rule: string | null
  recurrence_parent_id: string | null
  /** Fractional index, a string (SPEC §4.2). */
  position: string
  /** SPEC §12 item 4: present from the start; always us for now. */
  created_by: string | null
  assignee_id: string | null
}

/** SPEC §4.1 — `projects`. */
export interface Project extends SyncColumns {
  name: string
  color: string | null
  icon: string | null
  /**
   * SPEC §4.1: the workspace-wide *initial* view for this project. The live
   * per-device toggle is `lib/view.ts` over local storage and is deliberately
   * not synced — switching to board on the tablet must not switch the phone.
   * This column is only the starting point a device inherits before it has an
   * opinion of its own.
   */
  default_view: 'list' | 'board'
  /** Fractional index, a string (SPEC §4.2). */
  position: string
  /** SPEC §4.4: archiving is the safe default the UI nudges toward. */
  archived_at: string | null
}

/** SPEC §4.1 — `sections`. */
export interface Section extends SyncColumns {
  project_id: string
  name: string
  position: string
  /**
   * SPEC §4: checking a task moves it here. The move lands with the sections
   * UI; this slice only creates the row.
   */
  is_done_section: boolean
}

/** SPEC §4.1 — `checklist_items`. */
export interface ChecklistItem extends SyncColumns {
  task_id: string
  title: string
  /**
   * SPEC §4.1 spells this `done`, where `tasks` carries `completed_at`. The
   * asymmetry is deliberate: a task's completion time is data — P2's completed
   * log reads it, and §4's done-section binding preserves it across a move —
   * whereas an item has no detail view for a timestamp to be shown in.
   */
  done: boolean
  /** Fractional index, a string (SPEC §4.2). */
  position: string
}

/** SPEC §4.1 — `labels`. Cross-project tags; §4 says a task is in exactly
 * one project, so labels carry everything that cuts across. */
export interface Label extends SyncColumns {
  name: string
  /**
   * A palette key from `labelling.ts` — `'rose'`, not `'#e11d48'`.
   *
   * Two reasons, and the second binds. Every colour here is a *pair*: the dot
   * that reads on white is not the one that reads on near-black, so the
   * palette resolves to a class per theme rather than to a value. And
   * Tailwind's compiler only emits classes it can see in the source, so a
   * class name assembled at runtime from a stored hex is purged from the
   * build and renders unstyled.
   */
  color: string
}

/**
 * SPEC §4.1 — `task_labels`. The app's first many-to-many.
 *
 * §4.1 lists no `id` column, but the outbox keys every entry by `row_id` and
 * §9.2 upserts by row id, so the join row needs an identity. It is
 * **computed** — `` `${task_id}.${label_id}` `` — not generated.
 *
 * A join row is the one row shape where two devices offline can independently
 * invent the same fact. With a generated id that is two live rows asserting
 * one thing and a dedupe on every read; with a computed one both devices
 * produce the same row id and the push collapses them. `db.ts` already relies
 * on exactly this for the seeded workspace.
 */
export interface TaskLabel extends SyncColumns {
  task_id: string
  label_id: string
}

/**
 * SPEC §9.1 — one entry per dirty row, not a delta log.
 *
 * There is no `op` column on purpose: creates, updates and deletes are all
 * upserts by row id on the server, and a soft delete is `deleted_at` showing
 * up in `columns` like any other change.
 */
export interface OutboxEntry {
  /** Dexie auto-increment. The push order (SPEC §9.2). */
  seq: number
  table: TableName
  row_id: string
  /** The dirty column set, server-owned columns excluded (SPEC §4.1). */
  columns: string[]
  /**
   * SPEC §9.1: "rejectable, not merely retryable". Nothing sets 'parked'
   * until P1 has a server that can reject — the field exists now because
   * retrofitting it "means auditing every write path in the app".
   */
  status: 'pending' | 'parked'
  reason: string | null
  created_at: string
}

/**
 * Columns a client must never push, because the server owns them.
 * SPEC §4.1: "The push payload whitelist is explicit, and these columns are
 * not on it." Kept here next to the schema so it cannot drift out of sync.
 */
export const SERVER_OWNED_COLUMNS = ['updated_at', 'reminder_sent_at'] as const

/**
 * Tables the client may push. SPEC §9.11 item 3 — the push handler validates
 * against an explicit whitelist, so adding a server-owned table later is a
 * one-line change rather than a security review.
 *
 * Listed in SPEC §9.2's push order — `workspaces → projects → sections →
 * tasks → checklist_items → labels → task_labels` — minus `workspaces`, which
 * is not a client-writable table. With `task_labels` this list is complete:
 * every table §9.2 names now exists. The order is inert today: this is a whitelist, and the real push
 * order comes from the outbox's `seq`. But §9.2's dependency chain has to be
 * written down somewhere it cannot drift away from the schema, and this is the
 * one list of tables the app already keeps.
 */
export const PUSHABLE_TABLES = [
  'projects',
  'sections',
  'tasks',
  'checklist_items',
  'labels',
  'task_labels',
] as const

/** The tables a write can target. `outbox` is deliberately not one. */
export type TableName = (typeof PUSHABLE_TABLES)[number]
