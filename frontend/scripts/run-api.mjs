#!/usr/bin/env node
/**
 * Cross-platform launcher for the vision/IMU fusion API (ensemble/api/server.py).
 *
 * `npm run dev`'s dev:api script used to hardcode the command "python" —
 * on most modern Mac/Linux installs there is no bare `python` on PATH at
 * all (only `python3`), so this failed with a plain "command not found"
 * before uvicorn ever got a chance to run. This tries `python3` first,
 * then falls back to `python`, and prints a clear, actionable error
 * instead of a cryptic ENOENT if neither exists.
 */
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

function hasCommand(cmd) {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
  return result.error == null && result.status === 0
}

const candidates = ['python3', 'python']
const pythonCmd = candidates.find(hasCommand)

if (!pythonCmd) {
  console.error(
    "[dev:api] Couldn't find a `python3` or `python` command on your PATH.\n" +
      '[dev:api] Install Python 3 (https://www.python.org/downloads/), make sure it is on PATH, then try again.',
  )
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')

console.log(`[dev:api] Using "${pythonCmd}" to run the API from ${repoRoot}`)

const child = spawn(pythonCmd, ['-m', 'uvicorn', 'ensemble.api.server:app', '--reload', '--port', '8000'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('error', (err) => {
  console.error('[dev:api] Failed to start the vision model API:', err.message)
  process.exit(1)
})

child.on('exit', (code) => process.exit(code ?? 0))
