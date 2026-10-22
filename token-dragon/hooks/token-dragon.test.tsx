import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

import { BONES, paletteOf, render } from './dragon'

const BAND = {
  plugin: 'token-dragon',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const RESET = '2026-10-21T07:40:00.000Z'

function usageAt(five: number | null, seven = 21, resetsAt = RESET): SessionUsage {
  const rateLimits = []
  if (five !== null) rateLimits.push({ kind: 'five_hour', percentUsed: five, resetsAt })
  rateLimits.push({ kind: 'seven_day', percentUsed: seven, resetsAt: '2026-10-27T00:00:00.000Z' })

  return { startedAt: 0, context: { window: 200000, percent: 10 }, rateLimits }
}

/** The engine beneath the mod: a session that answers usage from `world.usage`. */
/** A terminal the engine draws inline images on: iTerm2 3.5 or later. */
const ITERM = { TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.7.4' }

async function boot($: Engine, on: On, first: SessionUsage, stored?: Readonly<Record<string, unknown>>, env: Readonly<Record<string, string>> = ITERM) {
  const world = { usage: first, toasts: [] as string[], blits: [] as { requestId: string; key: string; source?: unknown; cells?: string }[], denyBlits: false }
  mock.store(on, stored)
  mock.env(on, env)
  on('session.usage', () => ({ value: world.usage }))
  on('ui.blit', (_, e) => {
    world.blits.push(e)

    return { value: world.denyBlits ? { deny: 'not mounted' } : {} }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer, reason: 'answer' as const }))
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  return world
}

async function turn($: Engine) {
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
}

// fire 48 px + head 56 px + 25 segments of 4 px + a 16 px tail tuft = 220 px = 55 columns; 48 px tall = 6 rows
const COLUMNS_AT_50 = 55

test('at 50% the dragon is an inline image of 25 segments, with both bars', async ($, on) => {
  mock.clock(on)
  await boot($, on, usageAt(50))

  const ui = await $.ui.mount(BAND)

  const image = await ui.find({ type: 'Image', key: 'dragon' })
  expect(image?.props).toMatchObject({ columns: COLUMNS_AT_50, rows: 6 })
  const png = (image?.props.source as { png: string }).png
  expect(png.startsWith('iVBORw0KGgo')).toBe(true) // the PNG signature, base64
  expect((await ui.find({ type: 'Text', text: /룡/ }))?.text).toMatch(/룡$/)
  expect(await ui.find({ type: 'Text', text: /마디/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /5h/ }))?.text).toContain('50%')
  expect((await ui.find({ type: 'Text', text: /7d/ }))?.text).toContain('21%')
  await ui.unmount()
})

// A Raster is painted as an image where the terminal is made to take images,
// so the blocks renderer draws plain colored text: nothing an image protocol
// could spill into the prompt.
test('the blocks renderer draws the same dragon as rows of colored half-block text', { options: { renderer: 'blocks' } }, async ($, on) => {
  mock.clock(on)
  await boot($, on, usageAt(50))

  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  const rows = await ui.findAll({ type: 'Text', text: /[▀▄]/ })
  expect(rows.length).toBeGreaterThanOrEqual(6)
  await ui.unmount()
})

test('a surface without images or rasters gets rows of colored text', async ($, on) => {
  mock.clock(on)
  await boot($, on, usageAt(50))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /[▀▄]/ })).toBeDefined()
  await ui.unmount()
})

test('the info column sits left of the dragon', async ($, on) => {
  mock.clock(on)
  await boot($, on, usageAt(50))

  const ui = await $.ui.mount(BAND)
  const root = await ui.drawn()

  expect(root).toMatchObject({ type: 'Box' })
  const [info, dragon] = (root as { children: { type: string }[] }).children
  expect(info?.type).toBe('Box')
  expect(dragon?.type).toBe('Image')
  await ui.unmount()
})

test('at 100% only bones remain', async ($, on) => {
  mock.clock(on)
  await boot($, on, usageAt(100))

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /뼈/ }))?.text).toContain('뼈')
  await ui.unmount()
})

test('the color comes from the window: same reset, same dragon; another reset, another', async ($, on) => {
  mock.clock(on)
  const world = await boot($, on, usageAt(60, 21, RESET))
  const pixels = async () => ((await (await $.ui.mount(BAND)).find({ type: 'Image', key: 'dragon' }))?.props.source as { png: string }).png

  const a = await pixels()
  world.usage = usageAt(60, 21, RESET)
  await turn($)
  const b = await pixels()
  world.usage = usageAt(60, 21, '2026-10-22T03:00:00.000Z')
  await turn($)
  const c = await pixels()

  expect(a).toBeDefined()
  expect(b).toEqual(a)
  expect(c).not.toEqual(a)
})

test('a narrow band clips the tail, never the info column', async ($, on) => {
  mock.clock(on)
  await boot($, on, usageAt(100))

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 50 } })

  const image = await ui.find({ type: 'Image', key: 'dragon' })
  const columns = image?.props.columns as number
  expect(columns).toBeLessThanOrEqual(50 - 26 - 2 - 4) // info, gap, border and its padding
  expect(columns).toBe(50 - 26 - 2 - 4) // the dragon takes all that is left
  await ui.unmount()
})

test('without a 5-hour window (an API key session) the band is left to the engine', async ($, on) => {
  mock.clock(on)
  await boot($, on, usageAt(null))

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect(await ui.find({ type: 'Image', key: 'dragon' })).toBeUndefined()
  await ui.unmount()
})

test('while a survey holds the band the mod yields', async ($, on) => {
  mock.clock(on)
  await boot($, on, usageAt(50))

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('toasts at the first segment, the half, and the end; never on the first reading', async ($, on) => {
  mock.clock(on)
  const world = await boot($, on, usageAt(1))
  expect(world.toasts).toEqual([])

  world.usage = usageAt(3)
  await turn($)
  expect(world.toasts).toHaveLength(1)
  expect(world.toasts[0]).toContain('용')

  world.usage = usageAt(10)
  await turn($)
  expect(world.toasts).toHaveLength(1)

  world.usage = usageAt(50)
  await turn($)
  expect(world.toasts).toHaveLength(2)

  world.usage = usageAt(100)
  await turn($)
  expect(world.toasts).toHaveLength(3)
  expect(world.toasts[2]).toContain('쓰러')
})

test('the band follows the window on its own clock, a minute at a time', async ($, on) => {
  const clock = mock.clock(on)
  const world = await boot($, on, usageAt(100))

  world.usage = usageAt(3)
  await clock.advance(60_000)

  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /룡/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /뼈/ })).toBeUndefined()
  await ui.unmount()
})

test('the body undulates: frames are blitted to the band while it is drawn', async ($, on) => {
  const clock = mock.clock(on)
  const world = await boot($, on, usageAt(50))

  const ui = await $.ui.mount({ ...BAND, requestId: 'band' })
  const first = ((await ui.find({ type: 'Image', key: 'dragon' }))?.props.source as { png: string }).png
  await clock.advance(1000)

  expect(world.blits.length).toBeGreaterThanOrEqual(4)
  expect(world.blits[0]).toMatchObject({ requestId: 'band', key: 'dragon' })
  const frames = world.blits.map(b => (b.source as { png: string }).png)
  expect(frames[0]).not.toEqual(first)
  expect(new Set(frames).size).toBeGreaterThan(1)
  await ui.unmount()
})

test('the blocks renderer animates by redrawing its text, never by a blit', { options: { renderer: 'blocks' } }, async ($, on) => {
  const clock = mock.clock(on)
  const world = await boot($, on, usageAt(50))

  const ui = await $.ui.mount({ ...BAND, requestId: 'band' })
  const shape = async () => (await ui.findAll({ type: 'Text', text: /[▀▄]/ })).map(t => t.text).join('\n')
  const before = await shape()
  await clock.advance(900)

  expect(await shape()).not.toEqual(before)
  expect(world.blits).toHaveLength(0)
  await ui.unmount()
})

test('bones do not move, and nothing is blitted before the band is drawn', async ($, on) => {
  const clock = mock.clock(on)
  const world = await boot($, on, usageAt(100))

  await clock.advance(1000)
  expect(world.blits).toHaveLength(0)

  const ui = await $.ui.mount({ ...BAND, requestId: 'band' })
  await clock.advance(1000)
  expect(world.blits).toHaveLength(0)
  await ui.unmount()
})

test('a refused frame stops the frames until the band is drawn again', async ($, on) => {
  const clock = mock.clock(on)
  const world = await boot($, on, usageAt(50))

  const ui = await $.ui.mount({ ...BAND, requestId: 'band' })
  await clock.advance(400)
  const shown = world.blits.length
  expect(shown).toBeGreaterThan(0)

  world.denyBlits = true
  await clock.advance(400)
  const refusedAt = world.blits.length
  expect(refusedAt).toBe(shown + 1)

  await clock.advance(2000)
  expect(world.blits.length).toBe(refusedAt)

  world.denyBlits = false
  await ui.redraw()
  await clock.advance(400)
  expect(world.blits.length).toBeGreaterThan(refusedAt)
  await ui.unmount()
})

// A session has no rate-limit reading until its first API response; the band
// must not stay empty until then.

function noReading(): SessionUsage {
  return { startedAt: 0, context: { window: 200000, percent: 0 }, rateLimits: [] }
}

test('a reading is kept in the store for the next session', async ($, on) => {
  mock.clock(on)
  const sets: { key: string; value: unknown }[] = []
  on('store.set', (_, e) => {
    sets.push(e)

    return { value: undefined }
  })
  on('store.get', () => ({ value: undefined }))
  mock.env(on, ITERM)
  on('session.usage', () => ({ value: usageAt(50) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(sets).toHaveLength(1)
  expect(sets[0]).toMatchObject({ key: 'snapshot', value: { five: { percent: 50, resetsAt: RESET } } })
})

test('a session with no reading yet draws the dragon from the kept reading', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-21T05:00:00.000Z') })
  await boot($, on, noReading(), {
    snapshot: { five: { percent: 40, resetsAt: RESET }, seven: { percent: 21, resetsAt: '2026-10-27T00:00:00.000Z' } },
  })

  const ui = await $.ui.mount(BAND)

  // fire 48 + head 56 + 20 segments of 4 + tuft 16 = 200 px = 50 columns
  expect((await ui.find({ type: 'Image', key: 'dragon' }))?.props).toMatchObject({ columns: 50 })
  expect((await ui.find({ type: 'Text', text: /5h/ }))?.text).toContain('40%')
  await ui.unmount()
})

test('a kept reading whose window has reset shows a hatchling at 0%', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-21T10:00:00.000Z') })
  await boot($, on, noReading(), {
    snapshot: { five: { percent: 90, resetsAt: RESET }, seven: { percent: 21, resetsAt: '2026-10-27T00:00:00.000Z' } },
  })

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Image', key: 'dragon' }))?.props).toMatchObject({ columns: 26 })
  expect((await ui.find({ type: 'Text', text: /5h/ }))?.text).toContain('0%')
  expect((await ui.find({ type: 'Text', text: /7d/ }))?.text).toContain('21%')
  await ui.unmount()
})

test('the live reading replaces the kept one as soon as it arrives', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-21T05:00:00.000Z') })
  const world = await boot($, on, noReading(), { snapshot: { five: { percent: 40, resetsAt: RESET }, seven: null } })

  world.usage = usageAt(44)
  await turn($)
  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /5h/ }))?.text).toContain('44%')
  expect(world.toasts).toEqual([])
  await ui.unmount()
})

// Inline images reach the terminal as a graphics-protocol payload; a terminal
// that half-understands it (Orca's) spills the payload into the prompt. So
// images go only to terminals known to draw them; everything else gets cells.

async function spriteOn($: Engine, on: On, env: Readonly<Record<string, string>>) {
  await boot($, on, usageAt(50), undefined, env)
  const ui = await $.ui.mount(BAND)
  const image = await ui.find({ type: 'Image', key: 'dragon' })
  const text = await ui.find({ type: 'Text', text: /[▀▄]/ })
  await ui.unmount()

  return image ? 'image' : text ? 'blocks' : 'none'
}

test('an unknown terminal gets cells, not an image', async ($, on) => {
  mock.clock(on)
  expect(await spriteOn($, on, {})).toBe('blocks')
})

test('iTerm2 before 3.5 gets cells', async ($, on) => {
  mock.clock(on)
  expect(await spriteOn($, on, { TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.4.19' })).toBe('blocks')
})

test('kitty and Ghostty get the image', async ($, on) => {
  mock.clock(on)
  expect(await spriteOn($, on, { KITTY_WINDOW_ID: '1', TERM: 'xterm-kitty' })).toBe('image')
})

test('Ghostty gets the image', async ($, on) => {
  mock.clock(on)
  expect(await spriteOn($, on, { TERM_PROGRAM: 'ghostty' })).toBe('image')
})

test('renderer=image forces the image on an unknown terminal', { options: { renderer: 'image' } }, async ($, on) => {
  mock.clock(on)
  expect(await spriteOn($, on, {})).toBe('image')
})

// Orca drops a partial escape sequence longer than 4096 bytes when it snapshots
// a pane, then prints the rest of it as text. One kitty transmission of the
// dragon must therefore fit in one chunk well under that, at every length.
test('the longest dragon is one PNG short enough for a single kitty chunk', async ($, on) => {
  const clock = mock.clock(on)
  const world = await boot($, on, usageAt(98))

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 200 }, requestId: 'band' })
  const drawn = ((await ui.find({ type: 'Image', key: 'dragon' }))?.props.source as { png: string }).png
  await clock.advance(7000) // a whole breath: the fire frames are the largest
  const longest = Math.max(drawn.length, ...world.blits.map(b => (b.source as { png: string }).png.length))

  expect(longest).toBeLessThan(3900)
  await ui.unmount()
})

// PNG frames fit in one kitty chunk, which Orca keeps whole across a pane
// snapshot, so Orca draws the image like the other kitty terminals.
test('Orca gets the image', async ($, on) => {
  mock.clock(on)
  expect(await spriteOn($, on, { TERM_PROGRAM: 'Orca', ORCA_IMAGE_PROTOCOL: 'kitty' })).toBe('image')
})

// The breath: every few seconds the head lifts and a flame comes out of the
// mouth, in the margin kept free for it left of the head.
const FIRE_MARGIN = 48

function flamePixels(pic: { width: number; height: number; rgba: Uint8Array }): number {
  let n = 0
  for (let y = 0; y < pic.height; y += 1) {
    for (let x = 0; x < FIRE_MARGIN; x += 1) {
      const i = (y * pic.width + x) * 4
      if ((pic.rgba[i + 3] ?? 0) !== 0) n += 1
    }
  }

  return n
}

test('a breath fills the margin before the head with flame; at rest it is empty', () => {
  const { pal } = paletteOf(RESET)

  expect(flamePixels(render(50, pal, false, { breath: 0 }))).toBe(0)
  expect(flamePixels(render(50, pal, false, { breath: 1, seed: 7 }))).toBeGreaterThan(150)
})

test('bones never breathe fire', () => {
  expect(flamePixels(render(100, BONES, true, { breath: 1, seed: 7 }))).toBe(0)
})

test('the dragon breathes during the animation', async ($, on) => {
  const clock = mock.clock(on)
  const world = await boot($, on, usageAt(50))

  const ui = await $.ui.mount({ ...BAND, requestId: 'band' })
  await clock.advance(7000)
  const sizes = world.blits.map(b => (b.source as { png: string }).png.length)

  // fire frames carry more pixels, so a breath shows as frames well above the resting size
  expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes) + 300)
  await ui.unmount()
})

// The band is framed in the dragon's own colour: the colour its name is drawn
// in, grey for bones.
async function frameOf($: Engine, on: On, percent: number) {
  mock.clock(on)
  await boot($, on, usageAt(percent))
  const ui = await $.ui.mount(BAND)
  const root = (await ui.drawn()) as { type: string; props: Record<string, unknown> }
  const name = await ui.find({ type: 'Text', text: percent >= 100 ? /뼈/ : /룡$/ })
  await ui.unmount()

  return { root, nameColor: name?.props.color }
}

test('the band is framed in the colour of the dragon', async ($, on) => {
  const { root, nameColor } = await frameOf($, on, 50)

  expect(root.props.borderStyle).toBe('round')
  expect(typeof nameColor).toBe('string')
  expect(root.props.borderColor).toBe(nameColor)
})

test('bones are framed in grey', async ($, on) => {
  const { root } = await frameOf($, on, 100)

  expect(root.props.borderColor).toBe('#9e9e9e')
})
