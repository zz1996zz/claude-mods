// A small PNG encoder for the dragon: indexed colour (the picture has a dozen
// colours and transparency), compressed with LZ77 and deflate's fixed Huffman
// codes. The hooks environment has no zlib or CompressionStream, and the
// picture must stay small: a kitty transmission longer than 4096 bytes is split
// into chunks, and a terminal that snapshots a pane mid-chunk (Orca) prints the
// rest of it as text.

import type { Picture } from './dragon'

// ---------------------------------------------------------------------------
// Checksums
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }

  return t
})()

function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8)

  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const v of bytes) {
    a = (a + v) % 65521
    b = (b + a) % 65521
  }

  return ((b << 16) | a) >>> 0
}

// ---------------------------------------------------------------------------
// Deflate, one block of fixed Huffman codes
// ---------------------------------------------------------------------------

class BitWriter {
  private bytes: number[] = []
  private acc = 0
  private n = 0

  /** `count` bits of `value`, least significant first. */
  bits(value: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.acc |= ((value >>> i) & 1) << this.n
      this.n += 1
      if (this.n === 8) {
        this.bytes.push(this.acc)
        this.acc = 0
        this.n = 0
      }
    }
  }

  /** A Huffman code, most significant bit first. */
  code(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits((value >>> i) & 1, 1)
  }

  finish(): Uint8Array {
    if (this.n > 0) this.bytes.push(this.acc)

    return Uint8Array.from(this.bytes)
  }
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

function literalOrLength(w: BitWriter, symbol: number): void {
  if (symbol < 144) w.code(0x30 + symbol, 8)
  else if (symbol < 256) w.code(0x190 + symbol - 144, 9)
  else if (symbol < 280) w.code(symbol - 256, 7)
  else w.code(0xc0 + symbol - 280, 8)
}

function indexIn(bases: readonly number[], value: number): number {
  let i = bases.length - 1
  while ((bases[i] ?? 0) > value) i -= 1

  return i
}

const WINDOW = 32768
const MAX_MATCH = 258
const MAX_CHAIN = 64

function deflate(data: Uint8Array): Uint8Array {
  const w = new BitWriter()
  w.bits(1, 1) // final block
  w.bits(1, 2) // fixed Huffman codes
  const head = new Int32Array(1 << 15).fill(-1)
  const prev = new Int32Array(data.length).fill(-1)
  const hashAt = (i: number) => (((data[i] ?? 0) << 10) ^ ((data[i + 1] ?? 0) << 5) ^ (data[i + 2] ?? 0)) & 0x7fff
  const insert = (i: number) => {
    if (i + 2 >= data.length) return
    const h = hashAt(i)
    prev[i] = head[h] ?? -1
    head[h] = i
  }

  let i = 0
  while (i < data.length) {
    let bestLen = 0
    let bestDist = 0
    if (i + 2 < data.length) {
      let candidate = head[hashAt(i)] ?? -1
      let chain = 0
      while (candidate >= 0 && i - candidate <= WINDOW && chain < MAX_CHAIN) {
        let len = 0
        while (len < MAX_MATCH && i + len < data.length && data[candidate + len] === data[i + len]) len += 1
        if (len > bestLen) {
          bestLen = len
          bestDist = i - candidate
          if (len === MAX_MATCH) break
        }
        candidate = prev[candidate] ?? -1
        chain += 1
      }
    }
    if (bestLen >= 3) {
      const li = indexIn(LENGTH_BASE, bestLen)
      literalOrLength(w, 257 + li)
      w.bits(bestLen - (LENGTH_BASE[li] ?? 0), LENGTH_EXTRA[li] ?? 0)
      const di = indexIn(DIST_BASE, bestDist)
      w.code(di, 5)
      w.bits(bestDist - (DIST_BASE[di] ?? 0), DIST_EXTRA[di] ?? 0)
      for (let k = 0; k < bestLen; k += 1) insert(i + k)
      i += bestLen
    } else {
      literalOrLength(w, data[i] ?? 0)
      insert(i)
      i += 1
    }
  }
  literalOrLength(w, 256) // end of block
  const body = w.finish()

  const out = new Uint8Array(body.length + 6)
  out[0] = 0x78
  out[1] = 0x01
  out.set(body, 2)
  const a = adler32(data)
  out[out.length - 4] = a >>> 24
  out[out.length - 3] = (a >>> 16) & 0xff
  out[out.length - 2] = (a >>> 8) & 0xff
  out[out.length - 1] = a & 0xff

  return out
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let k = 0; k < 4; k += 1) out[4 + k] = type.charCodeAt(k)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))

  return out
}

/** The picture as an indexed-colour PNG; index 0 is transparent. */
export function encodePng(pic: Picture): Uint8Array {
  const colors = new Map<number, number>([[-1, 0]])
  const palette: number[] = [0]
  const rows = new Uint8Array((pic.width + 1) * pic.height)
  for (let y = 0; y < pic.height; y += 1) {
    rows[y * (pic.width + 1)] = 0 // no filter
    for (let x = 0; x < pic.width; x += 1) {
      const i = (y * pic.width + x) * 4
      const key = (pic.rgba[i + 3] ?? 0) === 0 ? -1 : ((pic.rgba[i] ?? 0) << 16) | ((pic.rgba[i + 1] ?? 0) << 8) | (pic.rgba[i + 2] ?? 0)
      let index = colors.get(key)
      if (index === undefined) {
        index = palette.length
        if (index > 255) throw new RangeError('the dragon has more than 255 colours')
        colors.set(key, index)
        palette.push(key)
      }
      rows[y * (pic.width + 1) + 1 + x] = index
    }
  }

  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, pic.width)
  ihdrView.setUint32(4, pic.height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 3 // indexed colour
  const plte = new Uint8Array(palette.length * 3)
  palette.forEach((c, k) => {
    if (k === 0) return
    plte[k * 3] = c >>> 16
    plte[k * 3 + 1] = (c >>> 8) & 0xff
    plte[k * 3 + 2] = c & 0xff
  })
  const trns = Uint8Array.of(0) // index 0 transparent, the rest opaque

  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
    chunk('IDAT', deflate(rows)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }

  return out
}
