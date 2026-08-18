/**
 * Per-device identity and per-device preferences.
 *
 * SPEC §12 item 7: no user identity is baked into ids, storage keys or cache
 * names — a second user on the same device must not collide. Everything here
 * is keyed by device, never by user.
 */

import { uuidv7 } from './ids'

const CLIENT_ID_KEY = 'lane.client_id'

let cached: string | null = null

/** Stable id for this browser profile. Survives reloads, not a reinstall. */
export function clientId(): string {
  if (cached) return cached
  let id = localStorage.getItem(CLIENT_ID_KEY)
  if (!id) {
    id = uuidv7()
    localStorage.setItem(CLIENT_ID_KEY, id)
  }
  cached = id
  return id
}
