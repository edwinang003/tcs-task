/**
 * UUIDv7 — time-sortable, generated on the client.
 *
 * SPEC §4.1: ids are generated client-side because offline creation requires
 * it, and v7 is time-sortable, which keeps index locality sane.
 *
 * Vendored rather than depended on (SPEC §11.3 rule 2): ~30 lines, and the
 * layout is frozen by RFC 9562.
 *
 *   48 bits  unix_ts_ms
 *    4 bits  version (7)
 *   12 bits  rand_a  — used here as a monotonic counter within the same ms
 *    2 bits  variant (0b10)
 *   62 bits  rand_b
 */

const HEX: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
)

let lastMs = 0
let counter = 0

export function uuidv7(now: number = Date.now()): string {
  // Monotonic within a millisecond, so two tasks added in the same tick keep
  // their insertion order. Overflow just rolls into the next millisecond.
  if (now === lastMs) {
    counter += 1
    if (counter > 0xfff) {
      lastMs += 1
      now = lastMs
      counter = 0
    }
  } else if (now > lastMs) {
    lastMs = now
    counter = 0
  } else {
    // Clock moved backwards. Never emit a smaller timestamp than the last one
    // (SPEC §9.4 — the client's wall clock is not trustworthy).
    lastMs += 1
    now = lastMs
    counter = 0
  }

  const b = new Uint8Array(16)
  crypto.getRandomValues(b)

  const ms = now
  b[0] = Math.floor(ms / 2 ** 40) & 0xff
  b[1] = Math.floor(ms / 2 ** 32) & 0xff
  b[2] = Math.floor(ms / 2 ** 24) & 0xff
  b[3] = Math.floor(ms / 2 ** 16) & 0xff
  b[4] = Math.floor(ms / 2 ** 8) & 0xff
  b[5] = ms & 0xff

  b[6] = 0x70 | ((counter >> 8) & 0x0f)
  b[7] = counter & 0xff
  b[8] = 0x80 | (b[8] & 0x3f)

  return (
    HEX[b[0]] + HEX[b[1]] + HEX[b[2]] + HEX[b[3]] + '-' +
    HEX[b[4]] + HEX[b[5]] + '-' +
    HEX[b[6]] + HEX[b[7]] + '-' +
    HEX[b[8]] + HEX[b[9]] + '-' +
    HEX[b[10]] + HEX[b[11]] + HEX[b[12]] + HEX[b[13]] + HEX[b[14]] + HEX[b[15]]
  )
}
