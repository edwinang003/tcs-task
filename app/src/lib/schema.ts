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
 */
export const PUSHABLE_TABLES = ['tasks', 'projects', 'sections'] as const

/** The tables a write can target. `outbox` is deliberately not one. */
export type TableName = (typeof PUSHABLE_TABLES)[number]
