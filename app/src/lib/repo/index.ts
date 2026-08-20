/**
 * The repository layer — the only path by which anything writes.
 *
 * SPEC §13, P0b constraint: "every write in P0b goes through a repository
 * layer that writes the row and appends an outbox entry in one transaction
 * (§9.1) ... Skip this and P1 rewrites every write path in the app — which is
 * the single most common way local-first projects stall."
 *
 * Re-exports only. `write.ts`'s primitives are deliberately not among them:
 * outside this directory, a caller should never be able to write a row without
 * going through a named mutation.
 */
export * from './tasks'
export * from './projects'
export * from './sections'
export * from './checklist'
