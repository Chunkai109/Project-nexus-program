// Reads the colour tokens from src/index.css and checks every text/background
// pair the app uses against WCAG contrast: 4.5:1 for text, 3:1 for icons and fills.
// Run: node scripts/check-contrast.mjs   (exits 1 if any pair fails)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/index.css'), 'utf8')
function tokens(block) {
  const out = {}
  for (const m of block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2]
  return out
}
const light = tokens(css.slice(css.indexOf('@theme'), css.indexOf('.dark {')))
const dark = { ...light, ...tokens(css.slice(css.indexOf('.dark {'), css.indexOf('@layer base'))) }

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const lum = (c) => {
  const [r, g, b] = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** `fg` at `alpha` painted over `bg` (the app's 10% status tints). */
const mix = (fg, bg, alpha) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)))

let failed = 0
function check(theme, t) {
  const bgs = ['canvas', 'surface', 'surface-secondary']
  const rows = []
  const add = (label, fg, bg, min) => {
    const r = ratio(fg, bg)
    if (r < min) failed++
    rows.push(`${r < min ? 'FAIL' : 'ok  '} ${r.toFixed(2).padStart(5)} (min ${min})  ${label}`)
  }
  for (const bg of bgs) {
    for (const fg of ['ink', 'ink-muted', 'ink-faint', 'accent', 'emerald-ink', 'amber-ink', 'crimson-ink'])
      add(`text ${fg} on ${bg}`, rgb(t[fg]), rgb(t[bg]), 4.5)
    for (const fg of ['emerald', 'amber', 'crimson', 'accent']) add(`icon/fill ${fg} on ${bg}`, rgb(t[fg]), rgb(t[bg]), 3)
  }
  // Badges and banners: status text on its own 10% tint, over each surface.
  for (const [fill, text] of [['emerald', 'emerald-ink'], ['amber', 'amber-ink'], ['crimson', 'crimson-ink'], ['accent', 'accent']])
    for (const bg of bgs) add(`text ${text} on ${fill} 10% tint over ${bg}`, rgb(t[text]), mix(rgb(t[fill]), rgb(t[bg]), 0.1), 4.5)
  add('button text accent-ink on accent', rgb(t['accent-ink']), rgb(t.accent), 4.5)
  add('button text accent-ink on accent-hover', rgb(t['accent-ink']), rgb(t['accent-hover']), 4.5)
  add('danger button text accent-ink on crimson', rgb(t['accent-ink']), rgb(t.crimson), 4.5)
  // Only ever a tick icon inside a green dot, never words, so the icon threshold applies.
  add('icon accent-ink on emerald fill', rgb(t['accent-ink']), rgb(t.emerald), 3)
  console.log(`\n${theme}\n` + rows.join('\n'))
}
check('LIGHT', light)
check('DARK', dark)
console.log(failed ? `\n${failed} pair(s) FAIL` : '\nAll pairs pass')
process.exit(failed ? 1 : 0)
