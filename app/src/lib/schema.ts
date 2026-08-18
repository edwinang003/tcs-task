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
export const PUSHABLE_TABLES = ['tasks'] as const
