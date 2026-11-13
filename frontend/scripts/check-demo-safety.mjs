#!/usr/bin/env node
// Fails if anything under src/demo/ could write data: the demo screens must
// never record a session, change a preset or plan, or talk to Supabase.
// Run: node scripts/check-demo-safety.mjs
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'demo')
const banned = /\b(recordSession|addExercise|updateExercise|createPlanFromPreset|deleteExercise|registerPatientVisit)\b|supabase/i
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]))
const hits = []
for (const file of walk(root)) {
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (banned.test(line)) hits.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`)
    })
}
if (hits.length) {
  console.error('Demo safety check failed. These lines could write data:\n' + hits.join('\n'))
  process.exit(1)
}
console.log(`Demo safety check passed (${walk(root).length} files under src/demo).`)
