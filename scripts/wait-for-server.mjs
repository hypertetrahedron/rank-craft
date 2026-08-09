/**
 * Block until the dev server is actually serving RankCraft, then exit 0.
 *
 * Used as the browser launch config's preLaunchTask so the debug browser does
 * not open on a connection-refused page while Next is still compiling.
 *
 *   node scripts/wait-for-server.mjs [url] [timeoutMs]
 *
 * It checks for a RankCraft marker in the response rather than settling for any
 * 200: Next silently moves to the next free port when the configured one is
 * taken, and pointing the debugger at whatever else is on that port is a worse
 * failure than timing out.
 *
 * Uses node:http with `agent: false` rather than fetch. fetch keeps its socket
 * alive after the response, and on Windows that trips a libuv assertion
 * ("!(handle->flags & UV_HANDLE_CLOSING)") on exit — which VS Code reads as a
 * failed preLaunchTask and refuses to launch the browser.
 */

import http from 'node:http'
import https from 'node:https'

const target = new URL(process.argv[2] || 'http://localhost:3210')
const timeoutMs = Number(process.argv[3] || 180_000)
const MARKER = 'RankCraft'

/** Resolves to the body on a 2xx, or null on any failure. Never rejects. */
function probe() {
  return new Promise((resolve) => {
    const client = target.protocol === 'https:' ? https : http
    const req = client.get(
      target,
      { agent: false, timeout: 5000 },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume()
          return resolve({ ok: false, why: `HTTP ${res.statusCode}` })
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => {
          body += c
        })
        res.on('end', () => resolve({ ok: true, body }))
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, why: 'request timed out' })
    })
    req.on('error', (err) => resolve({ ok: false, why: err.code || err.message }))
  })
}

const started = Date.now()
let lastError = 'no response yet'
let wrongApp = false

process.stdout.write(`Waiting for ${target.href} …\n`)

while (Date.now() - started < timeoutMs) {
  const res = await probe()
  if (res.ok && res.body.includes(MARKER)) {
    process.stdout.write(`Ready after ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
    process.exitCode = 0
    break
  }
  if (res.ok) {
    wrongApp = true
    lastError = `something else is serving ${target.href} — no "${MARKER}" in the response`
  } else {
    wrongApp = false
    lastError = res.why
  }
  await new Promise((r) => setTimeout(r, 300))
}

if (process.exitCode !== 0) {
  process.stderr.write(
    `Gave up after ${timeoutMs / 1000}s waiting for ${target.href} (${lastError}).\n`
  )
  if (wrongApp) {
    process.stderr.write(
      'Another app is holding that port, so Next started RankCraft somewhere else.\n' +
        'Stop it, or change the port in package.json (dev:debug), .vscode/launch.json\n' +
        'and .vscode/tasks.json — all three have to agree.\n'
    )
  }
  process.exitCode = 1
}
