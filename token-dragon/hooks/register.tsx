import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage } from 'claude-code'

import type { Snapshot, Window } from '../types'
import {
  BONES, CELL_H, CELL_W, DEFAULT, base64, cellsOf, crop, hex, nameOf, paletteOf, render, runsOf,
} from './dragon'
import type { Palette } from './dragon'
import { encodePng } from './png'

const INFO_W = 26
const GAP = 2

// ---------------------------------------------------------------------------
// Animation: the body's wave moves a step per frame, the eye blinks now and then
// ---------------------------------------------------------------------------

const FRAME_MS = 150
const PHASE_STEP = (Math.PI * 2) / 20
const BLINK_EVERY = 32 // frames
const BREATH_EVERY = 40 // frames: a breath every 6 s
const BREATH_FROM = 22 // where in that cycle the breath starts
const BREATH_LEN = 14 // frames, about 2 s

/** 0 to 1: how far into a breath this frame is; it swells, holds and fades. */
function breathOf(f: number): number {
  const t = (f % BREATH_EVERY - BREATH_FROM) / BREATH_LEN
  if (t < 0 || t >= 1) return 0

  return t < 0.3 ? t / 0.3 : t > 0.75 ? (1 - t) / 0.25 : 1
}

type Renderer = 'image' | 'blocks'

/** Where the image of the dragon was last drawn, so a frame can be blitted there. */
type Site = { requestId: string; percent: number; pal: Palette; columns: number }

let site: Site | null = null
let frame = 0

/**
 * The text drawing's frame: the band reads it while drawing, so each write
 * draws the band again. Written only while the band drew recently, so a band
 * that is gone (a survey, no window) costs nothing.
 */
const frameAtom = atom({ plugin: 'token-dragon', key: 'frame' } as const, 0)
let textDrawnAt = -1
const TEXT_EVERY = 2 // ticks per redrawn text frame

const phaseNow = () => frame * PHASE_STEP

function picture(percent: number, pal: Palette, columns: number, blink: boolean) {
  return crop(render(percent, pal, false, { phase: phaseNow(), blink, breath: breathOf(frame), seed: frame }), columns * CELL_W)
}

/**
 * One frame. An image is blitted where the band last showed it (a refusal
 * waits for the next drawing); a text dragon is drawn again through its frame
 * value while the band keeps drawing it.
 */
async function tick($: EngineInterface) {
  frame += 1
  if (site) {
    const pic = picture(site.percent, site.pal, site.columns, frame % BLINK_EVERY === 0)
    const rows = pic.height / CELL_H
    const { requestId, columns } = site
    const result = await $.ui.blit({ requestId, key: 'dragon', source: { png: base64(encodePng(pic)) }, columns, rows })
    if (result.deny) site = null

    return
  }
  if (textDrawnAt >= 0 && frame - textDrawnAt <= TEXT_EVERY + 1 && frame % TEXT_EVERY === 0) {
    await update($, frameAtom, () => frame)
  }
}

// ---------------------------------------------------------------------------
// Reading the windows
// ---------------------------------------------------------------------------

const snapshot = atom({ plugin: 'token-dragon', key: 'snapshot' } as const, null)

function windowOf(limits: readonly SessionRateLimit[], kind: string): Window | null {
  const found = limits.find(limit => limit.kind === kind)

  return found ? { percent: found.percentUsed, resetsAt: found.resetsAt ?? null } : null
}

function toSnapshot(usage: SessionUsage): Snapshot {
  return {
    five: windowOf(usage.rateLimits, 'five_hour'),
    seven: windowOf(usage.rateLimits, 'seven_day'),
  }
}

/** 0 before the first segment, 1 from it, 2 from the half, 3 at the end. */
function milestoneOf(percent: number): number {
  if (percent >= 100) return 3
  if (percent >= 50) return 2
  if (percent >= 2) return 1

  return 0
}

const MILESTONE_TOAST = ['', '🐉 알에서 용이 나왔다!', '🐉 용이 절반까지 자랐다', '💀 ...용이 쓰러졌다. 5시간 창을 다 썼다']

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

function clock(iso: string | null, withDay: boolean): string {
  if (iso === null) return '?'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '?'
  const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`

  return withDay ? `${WEEKDAY[at.getDay()]} ${hhmm}` : hhmm
}

function bar(percent: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)))

  return '▓'.repeat(filled) + '░'.repeat(10 - filled)
}

const STORE_KEY = 'snapshot'

/** A window whose reset is still ahead is kept as read; one past its reset starts over at 0%. */
function stillValid(window: Window | null, now: number): Window | null {
  if (!window) return null
  if (window.resetsAt !== null && Date.parse(window.resetsAt) > now) return window

  return { percent: 0, resetsAt: null }
}

/**
 * A session has no rate-limit reading until its first API response. Until
 * then the last reading any session kept stands in, so the band is never
 * empty at a start; with nothing kept (an API key) there is nothing to show.
 */
async function kept($: EngineInterface): Promise<Snapshot | null> {
  const stored = (await $.store.get(STORE_KEY)) as Snapshot | undefined
  if (!stored?.five) return null
  const now = await $.clock.now()

  return { five: stillValid(stored.five, now), seven: stillValid(stored.seven, now) }
}

/** Reads the windows again; a milestone passed since the last reading toasts. */
async function refresh($: EngineInterface) {
  const previous = await read($, snapshot)
  const live = toSnapshot(await $.session.usage())
  const next = live.five ? live : ((await kept($)) ?? live)
  await update($, snapshot, () => next)
  if (live.five) await $.store.set(STORE_KEY, live)

  if (previous?.five && live.five) {
    const was = milestoneOf(previous.five.percent)
    const now = milestoneOf(live.five.percent)
    if (now > was) $.ui.toast(MILESTONE_TOAST[now] ?? '')
  }
}

// ---------------------------------------------------------------------------
// The mod
// ---------------------------------------------------------------------------

/** `[major, minor]` of a version string, zeros where it says less. */
function versionOf(text: string | undefined): [number, number] {
  const [major, minor] = (text ?? '').split('.').map(part => Number.parseInt(part, 10))

  return [major || 0, minor || 0]
}

/**
 * Which renderer the terminal gets. An inline image is sent as a graphics
 * payload, and a terminal that half-understands the protocol spills it into
 * the prompt (Orca's does), so the image goes only to terminals the engine is
 * known to draw it on: iTerm2 3.5 and later, kitty and Ghostty. A `renderer`
 * option of `image` or `blocks` overrides the choice.
 */
async function detectRenderer($: EngineInterface, choice: unknown): Promise<Renderer> {
  if (choice === 'image' || choice === 'blocks') return choice
  const program = await $.env.get('TERM_PROGRAM')
  if (program === 'iTerm.app') {
    const [major, minor] = versionOf(await $.env.get('TERM_PROGRAM_VERSION'))

    return major > 3 || (major === 3 && minor >= 5) ? 'image' : 'blocks'
  }
  if (program === 'ghostty') return 'image'
  // Orca drops an escape sequence over 4096 bytes when it snapshots a pane; a
  // PNG frame is one chunk well under that, so its kitty support holds.
  if (program === 'Orca' && (await $.env.get('ORCA_IMAGE_PROTOCOL')) === 'kitty') return 'image'
  if (await $.env.get('KITTY_WINDOW_ID')) return 'image'
  if ((await $.env.get('TERM')) === 'xterm-kitty') return 'image'

  return 'blocks'
}

/** Decided once per load, in `session.start`; cells until then. */
let renderer: Renderer = 'blocks'

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    renderer = await detectRenderer($, options.renderer)
    await refresh($)
    $.clock.every(60_000, () => {
      void refresh($)
    })
    $.clock.every(FRAME_MS, () => {
      void tick($)
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || !snap?.five) return next(e)
    await read($, frameAtom) // subscribes the band to the text frames

    const five = snap.five
    const dead = five.percent >= 100
    const { hue, pal } = paletteOf(five.resetsAt ?? 'none')
    const whole = render(five.percent, dead ? BONES : pal, dead, { phase: phaseNow(), breath: breathOf(frame), seed: frame })
    const columns = Math.max(1, Math.min(Math.ceil(whole.width / CELL_W), e.props.bodyColumns - INFO_W - GAP))
    const rows = whole.height / CELL_H
    const pic = crop(whole, columns * CELL_W)
    const name = dead ? '용의 뼈' : nameOf(hue)
    const { Box, Text } = $.ui.resolve(e)

    // the frames go where the terminal shows the image; text and bones lie still
    site = e.surface === 'terminal' && renderer === 'image' && !dead ? { requestId: e.requestId, percent: five.percent, pal, columns } : null

    const sprite = (() => {
      if (e.surface === 'terminal' && renderer === 'image') {
        const { Image } = $.ui.resolve(e)

        return (
          <Image
            key="dragon"
            source={{ png: base64(encodePng(pic)) }}
            columns={columns}
            rows={rows}
            alt={`${name} ${bar(five.percent)}`}
          />
        )
      }

      // Plain colored text: a Raster is painted as an image where the terminal
      // is made to take images (Orca sets CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1
      // and then spills the payload into the prompt), and text never is.
      if (!dead) textDrawnAt = frame

      return (
        <Box flexDirection="column">
          {cellsOf(pic, columns).map(row => (
            <Text>
              {runsOf(row).map(run => (
                <Text
                  color={run.fg === DEFAULT ? undefined : hex(run.fg)}
                  backgroundColor={run.bg === DEFAULT ? undefined : hex(run.bg)}
                >
                  {run.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      )
    })()

    return (
      <Box flexDirection="row" gap={GAP}>
        <Box flexDirection="column" width={INFO_W}>
          <Text color={dead ? '#9e9e9e' : hex((pal.M2[0] << 16) | (pal.M2[1] << 8) | pal.M2[2])} weight="bold">{name}</Text>
          <Text>
            <Text dimColor>5h  </Text>
            <Text color="#7cc47f">{bar(five.percent)}</Text> {five.percent}%
          </Text>
          <Text dimColor>    리셋 {clock(five.resetsAt, false)}</Text>
          {snap.seven && (
            <Text>
              <Text dimColor>7d  </Text>
              <Text color="#7cc47f">{bar(snap.seven.percent)}</Text> {snap.seven.percent}%
            </Text>
          )}
          {snap.seven && <Text dimColor>    리셋 {clock(snap.seven.resetsAt, true)}</Text>}
        </Box>
        {sprite}
      </Box>
    )
  })
}
