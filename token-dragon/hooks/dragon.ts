// A procedural eastern dragon, 48 px tall: a drawn head, then one 4 px body
// segment per 2% of the 5-hour window, bones at 100%. Pure: no `$` here.

export const HEIGHT = 48
export const HEAD_W = 56
export const SEG_W = 4
export const TUFT_W = 16
/** Kept free left of the head for the breath's flame, so every frame has one width. */
export const FIRE_W = 48
/** One terminal cell shows this many pixels across and down. */
export const CELL_W = 4
export const CELL_H = 8

export type Role = 'M' | 'M2' | 'M3' | 'D' | 'B' | 'B2' | 'N' | 'N2' | 'H' | 'H2' | 'E' | 'W' | 'R' | 'T' | Flame
type Flame = 'F0' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5'
const FLAMES: readonly Flame[] = ['F0', 'F1', 'F2', 'F3', 'F4', 'F5']
const FLAME_COLORS: Record<Flame, Rgb> = {
  F0: [255, 250, 214], F1: [255, 222, 96], F2: [255, 164, 44], F3: [238, 96, 32], F4: [176, 44, 22], F5: [96, 26, 20],
}
export type Rgb = readonly [number, number, number]
export type Palette = Record<Role, Rgb>

export type Picture = { width: number; height: number; rgba: Uint8Array }

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261
  for (const c of s) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }

  return h
}

function hsl(h: number, s: number, l: number): Rgb {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))

  return [f(0), f(8), f(4)]
}

/** The window's own colors: its reset time hashed to a hue. */
export function paletteOf(seed: string): { hue: number; pal: Palette } {
  const hue = hash(seed) % 360

  return {
    hue,
    pal: {
      M: hsl(hue, 60, 46), M2: hsl(hue, 62, 58), M3: hsl(hue, 60, 36), D: hsl(hue, 55, 16),
      B: hsl((hue + 30) % 360, 50, 80), B2: hsl((hue + 30) % 360, 45, 66),
      N: hsl((hue + 180) % 360, 70, 60), N2: hsl((hue + 180) % 360, 70, 42),
      H: [242, 230, 196], H2: [190, 175, 130], E: [12, 12, 12], W: [255, 255, 255], R: [200, 60, 60], T: [250, 250, 245],
      ...FLAME_COLORS,
    },
  }
}

export const BONES: Palette = {
  M: [180, 180, 180], M2: [200, 200, 200], M3: [150, 150, 150], D: [70, 70, 70],
  B: [205, 205, 205], B2: [170, 170, 170], N: [140, 140, 140], N2: [110, 110, 110],
  H: [210, 210, 210], H2: [160, 160, 160], E: [30, 30, 30], W: [230, 230, 230], R: [90, 90, 90], T: [230, 230, 230],
  ...FLAME_COLORS,
}

export function nameOf(hue: number): string {
  if (hue < 22 || hue >= 335) return '적룡'
  if (hue < 48) return '주황룡'
  if (hue < 70) return '황룡'
  if (hue < 165) return '녹룡'
  if (hue < 265) return '청룡'

  return '자룡'
}

// ---------------------------------------------------------------------------
// A grid of roles, painted with discs and strokes
// ---------------------------------------------------------------------------

type Point = readonly [number, number]

class Grid {
  readonly p: (Role | null)[]
  /** Where drawing calls put their origin: the head and body sit right of the flame's margin. */
  ox = 0
  oy = 0

  constructor(readonly w: number, readonly h: number) {
    this.p = new Array<Role | null>(w * h).fill(null)
  }

  get(x: number, y: number): Role | null {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : (this.p[y * this.w + x] ?? null)
  }

  set(x: number, y: number, r: Role): void {
    x = Math.round(x + this.ox)
    y = Math.round(y + this.oy)
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.p[y * this.w + x] = r
  }

  disc(cx: number, cy: number, r: number, role: Role): void {
    for (let y = Math.floor(cy - r); y <= cy + r; y += 1) {
      for (let x = Math.floor(cx - r); x <= cx + r; x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, role)
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, role: Role): void {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y += 1) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x += 1) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.set(x, y, role)
      }
    }
  }

  /** A stroke from a to b whose radius goes r0 to r1. */
  stroke(x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, role: Role): void {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2))
    for (let i = 0; i <= n; i += 1) {
      const t = i / n
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, role)
    }
  }

  /** A curve through points, radius r0 to r1 along its length. */
  curve(pts: readonly Point[], r0: number, r1: number, role: Role): void {
    let total = 0
    for (let i = 1; i < pts.length; i += 1) total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])
    let done = 0
    for (let i = 1; i < pts.length; i += 1) {
      const [ax, ay] = pts[i - 1]!
      const [bx, by] = pts[i]!
      const len = Math.hypot(bx - ax, by - ay)
      const ra = r0 + (r1 - r0) * (done / total)
      const rb = r0 + (r1 - r0) * ((done + len) / total)
      this.stroke(ax, ay, bx, by, ra, rb, role)
      done += len
    }
  }

  /** A 1 px dark outline on the given roles where they meet transparency. */
  outline(roles: ReadonlySet<Role>, role: Role): void {
    const out: Point[] = []
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        const c = this.get(x, y)
        if (!c || !roles.has(c)) continue
        if (!this.get(x - 1, y) || !this.get(x + 1, y) || !this.get(x, y - 1) || !this.get(x, y + 1)) out.push([x, y])
      }
    }
    for (const [x, y] of out) this.set(x, y, role)
  }
}

const SCALED: ReadonlySet<Role> = new Set<Role>(['M', 'M2', 'M3', 'B', 'B2', 'R'])

/** Over this many pixels behind the head the wave grows from nothing, so the neck stays on the head. */
const NECK_PX = 32

/** The spine's height at a pixel column; `phase` moves the wave along it. */
function spineY(px: number, x0: number, phase: number, lift = 0): number {
  const reach = Math.min(1, Math.max(0, (px - x0) / NECK_PX))
  const ease = reach * reach * (3 - 2 * reach) // smoothstep
  // the neck follows a lifted head and lets go of it over the same stretch
  return 22 - lift * (1 - ease) + 9 * ease * Math.sin(((px - x0) / 72) * Math.PI * 2 - phase)
}

function head(g: Grid, dead: boolean, blink: boolean, open: number): void {
  // the mane first: it sits behind the head
  if (!dead) {
    const fan: Point[] = [[-2, -14], [6, -12], [10, -6], [12, 2], [10, 10], [6, 14]]
    fan.forEach(([dx, dy], i) => g.curve([[44, 20], [48 + dx * 0.4, 20 + dy * 0.4], [46 + dx, 20 + dy]], 3, 0.5, i % 2 ? 'N' : 'N2'))
  }
  // horns, swept back
  g.curve([[42, 11], [47, 5], [53, 1]], 2.5, 0.8, 'H')
  g.curve([[37, 11], [41, 5], [45, 0]], 2, 0.6, 'H')
  g.stroke(43, 10, 46, 7, 1, 1, 'H2')
  g.stroke(38, 10, 40, 7, 0.8, 0.8, 'H2')
  // cranium and the upper snout, tapering to the left
  g.disc(40, 21, 10, 'M')
  for (let x = 3; x <= 44; x += 1) {
    const t = (x - 3) / 41
    const half = 3 + 8 * t
    const cy = 21 + 1.5 * (1 - t)
    for (let y = Math.round(cy - half); y <= Math.round(cy + half * 0.55); y += 1) g.set(x, y, 'M')
  }
  // the open mouth: a red cavity, then the lower jaw hinged at the cheek
  for (let x = 4; x <= 34; x += 1) {
    const t = (x - 4) / 30
    const top = 23 + 2 * (1 - t)
    const bot = top + 2 + (4 + open) * (1 - t)
    for (let y = Math.round(top); y <= Math.round(bot); y += 1) g.set(x, y, 'R')
  }
  g.curve([[36, 28], [20, 33 + open * 0.7], [6, 36 + open]], 4, 1.5, 'M')
  g.curve([[34, 31], [20, 35 + open * 0.7], [8, 37 + open]], 2.2, 0.8, 'B')
  // teeth
  for (const x of [9, 16, 23]) { g.set(x, 24, 'T'); g.set(x, 25, 'T'); g.set(x + 1, 24, 'T') }
  for (const x of [12, 20, 28]) {
    const y = 31 + Math.round(open * (1 - (x - 4) / 30))
    g.set(x, y, 'T'); g.set(x, y - 1, 'T'); g.set(x + 1, y, 'T')
  }
  // highlights along the top of the snout and the cranium
  for (let x = 8; x <= 42; x += 1) {
    const t = (x - 3) / 41
    const cy = 21 + 1.5 * (1 - t)
    const half = 3 + 8 * t
    g.set(x, Math.round(cy - half) + 1, 'M2')
    if (x % 2) g.set(x, Math.round(cy - half) + 2, 'M2')
  }
  g.ellipse(40, 16, 6, 3, 'M2')
  // the lip line under the snout
  for (let x = 6; x <= 32; x += 1) {
    const t = (x - 4) / 30
    g.set(x, Math.round(23 + 2 * (1 - t)) - 1, 'B2')
  }
  // nostril, brow, eye
  g.set(7, 20, 'E')
  g.set(8, 20, 'E')
  g.stroke(31, 15, 39, 14, 1, 1, 'M3')
  g.ellipse(35, 18, 4, 2.6, 'W')
  g.disc(36, 18, 2, 'E')
  g.set(35, 17, 'W')
  if (dead) {
    const cross: Point[] = [[33, 16], [34, 17], [35, 18], [36, 19], [37, 20], [37, 16], [36, 17], [34, 19], [33, 20]]
    for (const [x, y] of cross) g.set(x, y, 'E')
  } else if (blink) {
    g.ellipse(35, 18, 4.5, 3, 'M')
    g.stroke(31, 18, 39, 18, 0.8, 0.8, 'M3')
  }
  // whiskers from the snout's tip
  if (!dead) {
    g.curve([[5, 25], [1, 29], [1, 36], [5, 42], [11, 44]], 0.7, 0.5, 'W')
    g.curve([[6, 23], [0, 20], [0, 14], [4, 9]], 0.7, 0.5, 'W')
  }
}

function body(g: Grid, segs: number, x0: number, dead: boolean, phase: number, lift: number): void {
  const L = segs * SEG_W
  if (dead) {
    for (let px = x0; px < x0 + L; px += 1) {
      const y = spineY(px, x0, phase, lift)
      g.disc(px, y, 1.4, 'M')
      if ((px - x0) % 8 === 2) {
        g.curve([[px, y - 2], [px - 2, y - 7]], 0.9, 0.6, 'M3')
        g.curve([[px, y + 2], [px - 2, y + 7]], 0.9, 0.6, 'M3')
      }
    }

    return
  }
  const radius = (t: number) => Math.max(2, 10 * (1 - t) ** 0.8 + 2 * (1 - t))
  for (let px = x0; px < x0 + L; px += 1) {
    const t = (px - x0) / Math.max(1, L)
    const y = spineY(px, x0, phase, lift)
    const r = radius(t)
    const top = Math.round(y - r)
    const bot = Math.round(y + r)
    const bellyFrom = Math.round(y + r * 0.35)
    for (let py = top; py <= bot; py += 1) {
      if (py >= bellyFrom) {
        g.set(px, py, px % 4 === 0 ? 'B2' : 'B')
      } else {
        const sx = Math.floor(px / 4)
        const sy = Math.floor(py / 4)
        let role: Role = (sx + sy) & 1 ? 'M' : 'M2'
        if (px % 4 === 3 || py % 4 === 3) role = 'M3'
        if (py <= top + 1) role = 'M2'
        g.set(px, py, role)
      }
    }
    // dorsal fin spikes
    if ((px - x0) % 8 === 0 && r > 3.5) {
      const hgt = Math.round(3 + r * 0.6)
      g.stroke(px, top, px + 3, top - hgt, 2, 0.4, (px - x0) % 16 ? 'N' : 'N2')
    }
  }
  // two pairs of legs with claws along the thick part
  if (segs > 12) {
    for (const tt of [0.16, 0.6]) {
      const px = Math.round(x0 + L * tt)
      const y = spineY(px, x0, phase, lift)
      const r = radius(tt)
      const kx = px - 2
      const ky = y + r + 5
      g.curve([[px + 2, y + r - 3], [kx, ky], [kx - 4, ky + 3]], 3.2, 2.2, 'M3')
      g.curve([[px + 2, y + r - 3], [kx, ky], [kx - 4, ky + 3]], 2.2, 1.4, 'M')
      for (const [dx, dy] of [[-4, 2], [-3, 4], [0, 4]] as const) g.stroke(kx - 4, ky + 3, kx - 4 + dx, ky + 3 + dy, 1, 0.3, 'H')
    }
  }
  // the tail's tuft
  if (segs > 0) {
    const px = x0 + L
    const y = spineY(px, x0, phase, lift)
    g.curve([[px, y], [px + 6, y - 4], [px + 14, y - 7]], 2, 0.3, 'N')
    g.curve([[px, y], [px + 8, y], [px + 15, y - 1]], 2, 0.3, 'N2')
    g.curve([[px, y], [px + 6, y + 4], [px + 13, y + 7]], 2, 0.3, 'N')
  }
}

export function segmentsOf(percent: number): number {
  return Math.floor(Math.max(0, Math.min(100, percent)) / 2)
}

export type Frame = {
  /** Where the body's wave stands, in radians; it moves as this grows. */
  phase?: number
  /** True for a frame with the eye shut. */
  blink?: boolean
  /** 0 to 1: how far into a breath, the head lifted and the flame out; 0 at rest. */
  breath?: number
  /** Varies the flame's flicker from frame to frame. */
  seed?: number
}

function flicker(x: number, y: number, seed: number): number {
  let v = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0
  v = Math.imul(v ^ (v >>> 13), 1274126177) >>> 0

  return (v >>> 8) / 16777216
}

/** The flame, from the mouth at (mouthX, mouthY) out to the left edge, as long as the breath is far in. */
function flame(g: Grid, mouthX: number, mouthY: number, breath: number, seed: number): void {
  const span = mouthX
  const reach = Math.round(span * Math.min(1, breath * 1.3))
  for (let x = mouthX - reach; x < mouthX; x += 1) {
    const t = (mouthX - x) / span
    const half = (1.5 + t * 10 * (0.8 + 0.4 * flicker(x, 0, seed))) * (0.6 + 0.4 * breath)
    for (let y = Math.round(mouthY - half); y <= Math.round(mouthY + half); y += 1) {
      const d = Math.abs(y - mouthY) / half
      const n = flicker(x, y, seed)
      if (n < 0.12 + 0.55 * d * d + (t > 0.85 ? 0.3 : 0)) continue
      g.set(x, y, FLAMES[Math.min(5, Math.floor(d * 2.6 + t * 2.4 + n * 1.1))] ?? 'F5')
    }
  }
}

/** The dragon at this percent as RGBA pixels, transparent where nothing is. */
export function render(percent: number, pal: Palette, dead = percent >= 100, frame: Frame = {}): Picture {
  const segs = segmentsOf(percent)
  const width = FIRE_W + HEAD_W + segs * SEG_W + (segs > 0 ? TUFT_W : 0)
  const g = new Grid(width, HEIGHT)
  const breath = dead ? 0 : Math.max(0, Math.min(1, frame.breath ?? 0))
  const lift = Math.round(breath * 3)
  g.ox = FIRE_W
  body(g, segs, HEAD_W, dead, frame.phase ?? 0, lift)
  g.oy = -lift
  head(g, dead, frame.blink ?? false, Math.round(breath * 2))
  g.ox = 0
  g.oy = 0
  if (breath > 0) flame(g, FIRE_W + 4, 26 - lift, breath, frame.seed ?? 0)
  g.outline(SCALED, 'D')
  const rgba = new Uint8Array(width * HEIGHT * 4)
  for (let i = 0; i < width * HEIGHT; i += 1) {
    const r = g.p[i]
    if (!r) continue
    const [cr, cg, cb] = pal[r]
    rgba[i * 4] = cr
    rgba[i * 4 + 1] = cg
    rgba[i * 4 + 2] = cb
    rgba[i * 4 + 3] = 255
  }

  return { width, height: HEIGHT, rgba }
}

/** The picture's left `width` pixels, for a band too narrow for all of it. */
export function crop(pic: Picture, width: number): Picture {
  if (width >= pic.width) return pic
  const rgba = new Uint8Array(width * pic.height * 4)
  for (let y = 0; y < pic.height; y += 1) rgba.set(pic.rgba.subarray(y * pic.width * 4, (y * pic.width + width) * 4), y * width * 4)

  return { width, height: pic.height, rgba }
}

// ---------------------------------------------------------------------------
// Half-block cells for surfaces without images: each cell averages 4 x 4 px
// ---------------------------------------------------------------------------

export const DEFAULT = 0x01000000 // the terminal's own color
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const SPACE = 0x20

export type Cell = readonly [codePoint: number, fg: number, bg: number]

function sample(pic: Picture, x0: number, y0: number): number | null {
  let r = 0, g = 0, b = 0, n = 0
  for (let y = y0; y < y0 + CELL_H / 2; y += 1) {
    for (let x = x0; x < x0 + CELL_W; x += 1) {
      if (x >= pic.width || y >= pic.height) continue
      const i = (y * pic.width + x) * 4
      if ((pic.rgba[i + 3] ?? 0) === 0) continue
      r += pic.rgba[i] ?? 0
      g += pic.rgba[i + 1] ?? 0
      b += pic.rgba[i + 2] ?? 0
      n += 1
    }
  }
  if (n < (CELL_W * CELL_H) / 2 * 0.35) return null

  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)
}

export function cellsOf(pic: Picture, columns: number): Cell[][] {
  const rows: Cell[][] = []
  for (let cy = 0; cy < pic.height / CELL_H; cy += 1) {
    const row: Cell[] = []
    for (let cx = 0; cx < columns; cx += 1) {
      const top = sample(pic, cx * CELL_W, cy * CELL_H)
      const bottom = sample(pic, cx * CELL_W, cy * CELL_H + CELL_H / 2)
      if (top !== null && bottom !== null) row.push([UPPER, top, bottom])
      else if (top !== null) row.push([UPPER, top, DEFAULT])
      else if (bottom !== null) row.push([LOWER, bottom, DEFAULT])
      else row.push([SPACE, DEFAULT, DEFAULT])
    }
    rows.push(row)
  }

  return rows
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += b === undefined ? '=' : B64.charAt((n >> 6) & 63)
    out += c === undefined ? '=' : B64.charAt(n & 63)
  }

  return out
}

export const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

/** Adjacent cells of one color pair joined, so a row is a few Text runs. */
export function runsOf(row: Cell[]): { text: string; fg: number; bg: number }[] {
  const runs: { text: string; fg: number; bg: number }[] = []
  for (const [cp, fg, bg] of row) {
    const last = runs[runs.length - 1]
    if (last && last.fg === fg && last.bg === bg) last.text += String.fromCodePoint(cp)
    else runs.push({ text: String.fromCodePoint(cp), fg, bg })
  }

  return runs
}
