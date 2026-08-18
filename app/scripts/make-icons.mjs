/**
 * Generates the PWA icon set.
 *
 * SPEC §8: install is prompted in-app on Android and desktop Chrome, which
 * needs real 192px and 512px PNGs plus a maskable variant — Android will
 * otherwise letterbox the icon inside its own shape.
 *
 * Written by hand against Node's zlib rather than pulling in an image library
 * (SPEC §11.3 rule 2). Run with `npm run icons`.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const BG = [0x12, 0x15, 0x1c, 0xff]
const INK = [0xe8, 0xea, 0xf0, 0xff]
const ACCENT = [0x7c, 0x9c, 0xff, 0xff]

// ---- PNG encoding ---------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10..12 default to 0: deflate, adaptive filtering, no interlace

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- drawing --------------------------------------------------------------

/** Signed coverage of a rounded rectangle at a point, 0..1, 3x3 supersampled. */
function coverage(px, py, x, y, w, h, r) {
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const qx = px + (sx + 0.5) / 3
      const qy = py + (sy + 0.5) / 3
      const dx = Math.max(x - qx, 0, qx - (x + w))
      const dy = Math.max(y - qy, 0, qy - (y + h))
      if (dx === 0 && dy === 0) {
        // Inside the bounding box: only the corners can miss.
        const cx = Math.min(Math.max(qx, x + r), x + w - r)
        const cy = Math.min(Math.max(qy, y + r), y + h - r)
        if (Math.hypot(qx - cx, qy - cy) <= r) hits++
      }
    }
  }
  return hits / 9
}

function blend(buf, i, colour, alpha) {
  if (alpha <= 0) return
  const a = alpha * (colour[3] / 255)
  for (let c = 0; c < 3; c++) {
    buf[i + c] = Math.round(buf[i + c] * (1 - a) + colour[c] * a)
  }
  buf[i + 3] = Math.round(buf[i + 3] + (255 - buf[i + 3]) * a)
}

function rect(buf, size, colour, x, y, w, h, r) {
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const a = coverage(px, py, x, y, w, h, r)
      if (a > 0) blend(buf, (py * size + px) * 4, colour, a)
    }
  }
}

/**
 * The mark: three stacked bars of decreasing width — a list — with the top one
 * accented. `inset` is the fraction of the canvas the mark occupies.
 */
function draw(size, { maskable }) {
  const buf = Buffer.alloc(size * size * 4) // transparent
  if (maskable) {
    rect(buf, size, BG, 0, 0, size, size, 0)
  } else {
    rect(buf, size, BG, 0, 0, size, size, size * 0.22)
  }

  const markSize = size * (maskable ? 0.52 : 0.62)
  const left = (size - markSize) / 2
  const barH = markSize * 0.185
  const gap = markSize * 0.1225
  const top = (size - (barH * 3 + gap * 2)) / 2
  const widths = [1, 0.78, 0.55]

  widths.forEach((w, i) => {
    rect(
      buf,
      size,
      i === 0 ? ACCENT : INK,
      left,
      top + i * (barH + gap),
      markSize * w,
      barH,
      barH / 2,
    )
  })

  return buf
}

mkdirSync(OUT, { recursive: true })
for (const [name, size, opts] of [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
]) {
  writeFileSync(join(OUT, name), encodePng(size, size, draw(size, opts)))
  console.log('wrote', name, `${size}x${size}`)
}
