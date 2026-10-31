// Reproducible M2 performance benchmark.
// Browser: npm run perf:bench
// Native (start the app with WebView2 CDP first):
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri -- dev --no-watch
//   npm run perf:bench -- --native
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { chromium } from '@playwright/test'

const APP_URL = 'http://127.0.0.1:1420'
const CDP_URL = 'http://127.0.0.1:9222'
const BLOCK_COUNT = 10_000
const TYPE_COUNT = 180
const WARMUP_COUNT = 20
const BUDGET_TTI_MS = 1500
const BUDGET_INPUT_P95_MS = 16

const args = process.argv.slice(2)
const native = args.includes('--native')
const strict = !args.includes('--no-strict')

function generateDocument() {
  const parts = []
  for (let index = 0; index < BLOCK_COUNT; index += 1) {
    let block
    if (index === BLOCK_COUNT - 1) {
      block = `Final paragraph ${index}: ${'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '.repeat(2)}`
    } else if (index % 100 === 0) {
      block = `## Section ${index}`
    } else if (index % 250 === 0) {
      block = `\`\`\`ts\nconst value${index} = ${index}\n\`\`\``
    } else if (index % 50 === 0) {
      block = `- item ${index} alpha\n- item ${index} beta\n- item ${index} gamma`
    } else {
      block = `Paragraph ${index}: ${'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '.repeat(1)} plus more`
    }
    parts.push(block)
  }
  return `${parts.join('\n\n')}\n`
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))
  return sorted[index]
}

function round(value) {
  return Math.round(value * 10) / 10
}

async function waitForServer(timeoutMs = 60_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(APP_URL)
      if (response.ok) {
        return true
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  return false
}

async function ensureServer() {
  if (await waitForServer(1500)) {
    return null
  }
  const child = spawn('npm run dev -- --host 127.0.0.1', {
    shell: true,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  })
  if (!(await waitForServer())) {
    stopServer(child)
    throw new Error('Vite dev server did not start within 60 s')
  }
  return child
}

function stopServer(child) {
  if (!child) {
    return
  }
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(-child.pid, 'SIGTERM')
    }
  } catch {
    // The dev server may already be gone.
  }
}

async function measure(page) {
  return page.evaluate(
    async ({ typeCount, warmupCount }) => {
      const api = window.__YNOTE_DEBUG__
      const store = api.store
      const reset = () => {
        const bridge = store.bridge
        if (!bridge) {
          return null
        }
        bridge.inputDurations.length = 0
        bridge.serializations = 0
        bridge.fullDiffs = 0
        bridge.fastEdits = 0
        return bridge
      }

      store.editor.commands.focus('end')
      return {
        reset: Boolean(reset()),
        ready: store.editor.view.dom.isConnected,
        typeCount,
        warmupCount,
        sourceLength: store.doc.buffer.current.length,
        blocks: store.doc.buffer.map.roots.filter(root => root.kind !== 'gap').length,
        analysisMode: store.analysisMode,
        virtualization: getComputedStyle(document.querySelector('.ProseMirror pre') ?? document.body)
          .contentVisibility,
        inputTarget: store.doc.path,
      }
    },
    { typeCount: TYPE_COUNT, warmupCount: WARMUP_COUNT },
  )
}

async function readCounters(page) {
  return page.evaluate(() => {
    const store = window.__YNOTE_DEBUG__.store
    const bridge = store.bridge
    return {
      durations: [...bridge.inputDurations],
      fastEdits: bridge.fastEdits,
      serializations: bridge.serializations,
      fullDiffs: bridge.fullDiffs,
      dirty: store.doc.dirty,
      mapIssues: store.doc.buffer.mapIssues.length,
      sourceTail: store.doc.buffer.current.slice(-64),
      sourceLength: store.doc.buffer.current.length,
    }
  })
}

async function runBrowser(source) {
  const server = await ensureServer()
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto(APP_URL)
    try {
      await page.waitForFunction(() => Boolean(window.__YNOTE_DEBUG__), null, { timeout: 20_000 })
    } catch (error) {
      console.error(
        `Benchmark page did not expose __YNOTE_DEBUG__ (${page.url()}): ${pageErrors.join('; ')}`,
      )
      throw error
    }

    const open = await page.evaluate(async text => {
      const api = window.__YNOTE_DEBUG__
      const store = api.store
      localStorage.clear()

      const started = performance.now()
      await api.openDemo(text, 'perf-1mb.md')
      const openedAt = performance.now()
      const waitFor = async predicate => {
        const waitStarted = performance.now()
        while (!predicate()) {
          if (performance.now() - waitStarted > 15_000) {
            throw new Error('Editor did not become interactive within 15 s')
          }
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        return performance.now()
      }
      const editorAt = await waitFor(() => Boolean(store.editor))
      const domAt = await waitFor(() => Boolean(document.querySelector('.ProseMirror')))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const interactive = performance.now()
      return {
        storeOpenMs: openedAt - started,
        editorAttachMs: editorAt - started,
        domMs: domAt - started,
        ttiMs: interactive - started,
        metrics: store.lastOpenMetrics,
        analysisMode: store.analysisMode,
      }
    }, source)

    await page.evaluate(() => {
      const bridge = window.__YNOTE_DEBUG__.store.bridge
      bridge.inputDurations.length = 0
      bridge.serializations = 0
      bridge.fullDiffs = 0
      bridge.fastEdits = 0
    })

    const target = await measure(page)
    await page.keyboard.type('w'.repeat(WARMUP_COUNT), { delay: 0 })
    await page.evaluate(() => {
      const bridge = window.__YNOTE_DEBUG__.store.bridge
      bridge.inputDurations.length = 0
      bridge.serializations = 0
      bridge.fullDiffs = 0
      bridge.fastEdits = 0
    })
    const typingStarted = Date.now()
    await page.keyboard.type('x'.repeat(TYPE_COUNT), { delay: 0 })
    try {
      await page.waitForFunction(
        count =>
          window.__YNOTE_DEBUG__.store.doc.buffer.current
            .replace(/\n$/, '')
            .endsWith('x'.repeat(count)),
        TYPE_COUNT,
        { timeout: 20_000 },
      )
    } catch (error) {
      const diagnostics = await readCounters(page)
      console.error(
        `Typing did not reach the source buffer: ${JSON.stringify({
          tail: diagnostics.sourceTail,
          fastEdits: diagnostics.fastEdits,
          fullDiffs: diagnostics.fullDiffs,
          serializations: diagnostics.serializations,
          dirty: diagnostics.dirty,
        })}`,
      )
      throw error
    }
    const typingWallMs = Date.now() - typingStarted
    const counters = await readCounters(page)

    await page.evaluate(() => {
      const store = window.__YNOTE_DEBUG__.store
      const bridge = store.bridge
      bridge.inputDurations.length = 0
      bridge.serializations = 0
      bridge.fullDiffs = 0
      bridge.fastEdits = 0
      store.editor.commands.focus('start')
    })
    const startTypingStarted = Date.now()
    await page.keyboard.type('y'.repeat(60), { delay: 0 })
    await page.waitForFunction(
      () => window.__YNOTE_DEBUG__.store.doc.buffer.current.includes('y'.repeat(60)),
      null,
      { timeout: 20_000 },
    )
    const startTypingWallMs = Date.now() - startTypingStarted
    const startCounters = await readCounters(page)

    return {
      mode: 'browser',
      browser: `msedge ${browser.version()}`,
      pageErrors,
      open,
      target,
      typingWallMs,
      counters,
      startTypingWallMs,
      startCounters,
    }
  } finally {
    await browser.close()
    stopServer(server)
  }
}

async function runNative(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'y-note-perf-'))
  const file = path.join(dir, 'perf-1mb.md')
  fs.writeFileSync(file, source, 'utf8')

  const browser = await chromium.connectOverCDP(CDP_URL)
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = context.pages().find(candidate => candidate.url().includes('localhost:1420'))
    if (!page) {
      throw new Error('Y Note page not found in WebView2; start the app with CDP first')
    }
    await page.waitForFunction(() => Boolean(window.__YNOTE_DEBUG__), null, { timeout: 20_000 })

    const open = await page.evaluate(async target => {
      const api = window.__YNOTE_DEBUG__
      const store = api.store
      localStorage.clear()
      if (store.doc) {
        await store.gateway.deleteDraft(store.doc.path).catch(() => undefined)
        await store.stopWatching().catch(() => undefined)
        store.doc = null
        store.emit()
      }

      const started = performance.now()
      const opened = await store.gateway.readDocument(target)
      await store.openOpened(opened)
      const storeOpen = performance.now()
      await new Promise((resolve, reject) => {
        const waitStarted = performance.now()
        const check = () => {
          if (store.editor && document.querySelector('.ProseMirror')) {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            return
          }
          if (performance.now() - waitStarted > 15_000) {
            reject(new Error('Editor did not become interactive within 15 s'))
            return
          }
          setTimeout(check, 10)
        }
        check()
      })
      const interactive = performance.now()
      return {
        storeOpenMs: storeOpen - started,
        ttiMs: interactive - started,
        metrics: store.lastOpenMetrics,
        analysisMode: store.analysisMode,
      }
    }, file)

    await page.evaluate(() => {
      const bridge = window.__YNOTE_DEBUG__.store.bridge
      bridge.inputDurations.length = 0
      bridge.serializations = 0
      bridge.fullDiffs = 0
      bridge.fastEdits = 0
    })

    const target = await measure(page)
    await page.keyboard.type('w'.repeat(WARMUP_COUNT), { delay: 0 })
    await page.evaluate(() => {
      const bridge = window.__YNOTE_DEBUG__.store.bridge
      bridge.inputDurations.length = 0
      bridge.serializations = 0
      bridge.fullDiffs = 0
      bridge.fastEdits = 0
    })
    const typingStarted = Date.now()
    await page.keyboard.type('x'.repeat(TYPE_COUNT), { delay: 0 })
    try {
      await page.waitForFunction(
        count =>
          window.__YNOTE_DEBUG__.store.doc.buffer.current
            .replace(/\n$/, '')
            .endsWith('x'.repeat(count)),
        TYPE_COUNT,
        { timeout: 20_000 },
      )
    } catch (error) {
      const diagnostics = await readCounters(page)
      console.error(
        `Typing did not reach the source buffer: ${JSON.stringify({
          tail: diagnostics.sourceTail,
          fastEdits: diagnostics.fastEdits,
          fullDiffs: diagnostics.fullDiffs,
          serializations: diagnostics.serializations,
          dirty: diagnostics.dirty,
        })}`,
      )
      throw error
    }
    const typingWallMs = Date.now() - typingStarted
    const counters = await readCounters(page)

    await page.evaluate(() => {
      const store = window.__YNOTE_DEBUG__.store
      const bridge = store.bridge
      bridge.inputDurations.length = 0
      bridge.serializations = 0
      bridge.fullDiffs = 0
      bridge.fastEdits = 0
      store.editor.commands.focus('start')
    })
    const startTypingStarted = Date.now()
    await page.keyboard.type('y'.repeat(60), { delay: 0 })
    await page.waitForFunction(
      () => window.__YNOTE_DEBUG__.store.doc.buffer.current.includes('y'.repeat(60)),
      null,
      { timeout: 20_000 },
    )
    const startTypingWallMs = Date.now() - startTypingStarted
    const startCounters = await readCounters(page)

    await page.evaluate(() => window.__YNOTE_DEBUG__.store.gateway.deleteDraft(
      window.__YNOTE_DEBUG__.store.doc.path,
    ).catch(() => undefined))
    return {
      mode: 'native',
      browser: `WebView2 ${browser.version()}`,
      pageErrors: [],
      open,
      target,
      typingWallMs,
      counters,
      startTypingWallMs,
      startCounters,
    }
  } finally {
    await browser.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const source = generateDocument()
const bytes = Buffer.byteLength(source, 'utf8')
const result = native ? await runNative(source) : await runBrowser(source)
const durations = result.counters.durations
const p50 = percentile(durations, 0.5)
const p95 = percentile(durations, 0.95)
const max = durations.length > 0 ? Math.max(...durations) : 0
const startDurations = result.startCounters.durations
const startP95 = percentile(startDurations, 0.95)
const startMax = startDurations.length > 0 ? Math.max(...startDurations) : 0
const startSerializationPass =
  result.startCounters.serializations === 0 && result.startCounters.fullDiffs === 0
const ttiPass = result.open.ttiMs < BUDGET_TTI_MS
const inputPass = p95 < BUDGET_INPUT_P95_MS
const startInputPass = startP95 < BUDGET_INPUT_P95_MS
const serializationPass = result.counters.serializations === 0 && result.counters.fullDiffs === 0
const blockPass = result.target.blocks === BLOCK_COUNT

const report = {
  timestamp: new Date().toISOString(),
  platform: `${os.type()} ${os.release()} ${os.arch()}`,
  node: process.version,
  mode: result.mode,
  browser: result.browser,
  viewport: { width: 1440, height: 900 },
  fixture: { blocks: result.target.blocks, bytes, characters: source.length },
  analysisMode: result.open.analysisMode,
  open: result.open,
  typing: {
    keystrokes: TYPE_COUNT,
    warmup: WARMUP_COUNT,
    wallMs: result.typingWallMs,
    durations: { p50: round(p50), p95: round(p95), max: round(max) },
    fastEdits: result.counters.fastEdits,
    serializations: result.counters.serializations,
    fullDiffs: result.counters.fullDiffs,
  },
  typingAtStart: {
    keystrokes: 60,
    wallMs: result.startTypingWallMs,
    durations: { p95: round(startP95), max: round(startMax) },
    fastEdits: result.startCounters.fastEdits,
    serializations: result.startCounters.serializations,
    fullDiffs: result.startCounters.fullDiffs,
  },
  checks: {
    blockCount: blockPass,
    tti: { value: round(result.open.ttiMs), budget: BUDGET_TTI_MS, pass: ttiPass },
    inputP95: { value: round(p95), budget: BUDGET_INPUT_P95_MS, pass: inputPass },
    inputAtStartP95: {
      value: round(startP95),
      budget: BUDGET_INPUT_P95_MS,
      pass: startInputPass,
    },
    noFullSerialization: serializationPass,
    noPageErrors: result.pageErrors.length === 0,
    mapIssues: result.counters.mapIssues === 0,
  },
  pageErrors: result.pageErrors,
}

fs.mkdirSync('test-results', { recursive: true })
const outPath = path.join('test-results', `perf-${result.mode}.json`)
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)

console.log(`Y Note M2 performance benchmark (${result.mode}, ${result.browser})`)
console.log(`Platform: ${report.platform}, Node ${report.node}, viewport 1440x900`)
console.log(
  `Fixture: ${report.fixture.blocks.toLocaleString()} top-level blocks, ${(bytes / 1000).toFixed(1)} kB`,
)
console.log(
  `Open: store ${round(result.open.storeOpenMs)} ms (decode ${round(result.open.metrics?.decodeMs ?? 0)} ms, index ${round(result.open.metrics?.indexMs ?? 0)} ms via ${result.open.analysisMode}, project ${round(result.open.metrics?.projectMs ?? 0)} ms)`,
)
console.log(
  `Editor attach: ${round(result.open.editorAttachMs ?? 0)} ms; DOM: ${round(result.open.domMs ?? 0)} ms; frames done: ${round(result.open.ttiMs)} ms`,
)
console.log(
  `TTI: ${round(result.open.ttiMs)} ms < ${BUDGET_TTI_MS} ms ${ttiPass ? 'PASS' : 'FAIL'}`,
)
console.log(
  `Input: ${TYPE_COUNT} keystrokes in ${result.typingWallMs} ms; P50 ${round(p50)} ms, P95 ${round(p95)} ms < ${BUDGET_INPUT_P95_MS} ms ${inputPass ? 'PASS' : 'FAIL'}, max ${round(max)} ms`,
)
console.log(
  `Input path: ${result.counters.fastEdits} fast patches, ${result.counters.serializations} serializations, ${result.counters.fullDiffs} full diffs ${serializationPass ? 'PASS' : 'FAIL'}`,
)
console.log(
  `Input at document start: 60 keystrokes in ${result.startTypingWallMs} ms; P95 ${round(startP95)} ms < ${BUDGET_INPUT_P95_MS} ms ${startInputPass ? 'PASS' : 'FAIL'}, max ${round(startMax)} ms; ${result.startCounters.fastEdits} fast patches, ${result.startCounters.serializations} serializations, ${result.startCounters.fullDiffs} full diffs ${startSerializationPass ? 'PASS' : 'FAIL'}`,
)
console.log(
  `Block count ${blockPass ? 'PASS' : 'FAIL'}; map issues ${result.counters.mapIssues}; page errors ${result.pageErrors.length}`,
)
if (result.pageErrors.length > 0) {
  console.log(result.pageErrors.join('\n'))
}
console.log(`Report: ${outPath}`)

const failed =
  !blockPass ||
  !ttiPass ||
  !inputPass ||
  !startInputPass ||
  !startSerializationPass ||
  !serializationPass ||
  !report.checks.mapIssues ||
  !report.checks.noPageErrors
if (failed && strict) {
  process.exitCode = 1
}
