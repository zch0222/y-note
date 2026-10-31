// Windows/WebView2 acceptance. Start the app with:
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri -- dev --no-watch
// then run: npm run test:native
import { chromium } from '@playwright/test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'y-note-native-'))
const FILE_A = path.join(DIR, 'lf.md')
const FILE_B = path.join(DIR, 'bom-crlf.md')
const FILE_C = path.join(DIR, 'deleted.md')

const A_TEXT = '# 原生验收\n\n第一段。\n\n- [ ] 任务\n'
const B_TEXT = '\uFEFF# BOM 标题\r\n\r\n第一段。\r\n\r\n第二段。'
const C_TEXT = '# 删除测试\n\n本地内容。\n'

fs.writeFileSync(FILE_A, A_TEXT, 'utf8')
fs.writeFileSync(FILE_B, B_TEXT, 'utf8')
fs.writeFileSync(FILE_C, C_TEXT, 'utf8')

const checks = []

function sha(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!condition) {
    throw new Error(name)
  }
}

async function waitFor(fn, timeout = 8000, interval = 100) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    last = await fn()
    if (last) {
      return last
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  throw new Error(`Timed out after ${timeout} ms; last value: ${JSON.stringify(last)}`)
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const context = browser.contexts()[0] ?? (await browser.newContext())
const page = context.pages().find(candidate => candidate.url().includes('localhost:1420'))
if (!page) {
  throw new Error('Y Note page not found in WebView2')
}
await page.waitForFunction(() => Boolean(window.__YNOTE_DEBUG__), null, { timeout: 15_000 })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__YNOTE_DEBUG__?.store), null, { timeout: 15_000 })

async function openPath(file) {
  return page.evaluate(async target => {
    const api = window.__YNOTE_DEBUG__
    const opened = await api.store.gateway.readDocument(target)
    await api.store.openOpened(opened)
    const doc = api.store.doc
    return {
      path: doc.path,
      source: doc.buffer.current,
      encoding: doc.encoding,
      eol: doc.eol,
      dirty: doc.dirty,
      baseline: doc.buffer.baselineSha256,
    }
  }, file)
}

async function waitEditorContains(text) {
  await page.waitForFunction(
    value => Boolean(window.__YNOTE_DEBUG__?.store.editor?.getText().includes(value)),
    text,
    { timeout: 5000 },
  )
}

async function hashes() {
  return page.evaluate(() => window.__YNOTE_DEBUG__.hashes())
}

async function state() {
  return page.evaluate(() => {
    const doc = window.__YNOTE_DEBUG__.store.doc
    if (!doc) {
      return null
    }
    return {
      dirty: doc.dirty,
      saveState: doc.saveState,
      external: doc.external,
      readOnly: doc.readOnly ?? null,
      source: doc.buffer.current,
    }
  })
}

async function waitState(expected, timeout = 8000) {
  return waitFor(async () => {
    const current = await state()
    return current && Object.entries(expected).every(([key, value]) => current[key] === value)
      ? current
      : null
  }, timeout)
}

async function insertAtEnd(text) {
  await page.evaluate(value => {
    window.__YNOTE_DEBUG__.store.editor.chain().focus('end').insertContent(value).run()
  }, text)
  await waitState({ dirty: true })
}

async function saveWithShortcut() {
  await page.evaluate(() => window.__YNOTE_DEBUG__.focus())
  await page.keyboard.press('Control+s')
}

let failed = false
try {
  // 1. Open a real LF file through the native backend.
  const opened = await openPath(FILE_A)
  await waitEditorContains('原生验收')
  const diskSha = sha(fs.readFileSync(FILE_A))
  check('打开真实 LF 文件', opened.path === FILE_A && opened.source === A_TEXT)
  check('LF 与 UTF-8 识别', opened.encoding === 'utf-8' && opened.eol === 'LF')
  check('打开时基线等于磁盘 SHA', opened.baseline === diskSha, diskSha.slice(0, 12))

  // 2. No-op save through the real Ctrl/Cmd+S path.
  await page.evaluate(() => window.__YNOTE_DEBUG__.setMode('source'))
  await page.locator('[data-testid="source-editor"]').waitFor({ state: 'visible' })
  await page.evaluate(() => window.__YNOTE_DEBUG__.setMode('visual'))
  await page.locator('.ProseMirror').waitFor({ state: 'visible' })
  await waitEditorContains('原生验收')
  await saveWithShortcut()
  await waitState({ dirty: false, saveState: 'saved' })
  check('无操作保存字节不变', sha(fs.readFileSync(FILE_A)) === diskSha)

  // 3. Edit and save through the real Tiptap bridge.
  await insertAtEnd(' 原生验收编辑')
  await saveWithShortcut()
  await waitState({ dirty: false, saveState: 'saved' })
  const afterEdit = fs.readFileSync(FILE_A, 'utf8')
  check('编辑写入真实磁盘', afterEdit.includes('原生验收编辑'))
  check('未编辑前缀保持', afterEdit.startsWith('# 原生验收\n\n第一段。\n\n- [ ] 任务'))
  check('行数未增加', afterEdit.split('\n').length === A_TEXT.split('\n').length)
  check('无临时文件残留', !fs.readdirSync(DIR).some(name => name.includes('.ynote.tmp')))
  const savedA = await hashes()
  check(
    '保存后基线/缓冲/磁盘 SHA 一致',
    savedA.baseline === savedA.current && savedA.disk === savedA.current,
  )

  // 4. Native watcher: external change while clean.
  const external = '# 外部修改\n\nwatcher\n'
  fs.writeFileSync(FILE_A, external, 'utf8')
  await waitState({ external: 'external-change' })
  check('原生 watcher 捕获外部修改', true)
  check('外部修改提示可见', await page.locator('.notice-warn').isVisible())

  await page.locator('.notice-warn').getByRole('button', { name: '重新载入' }).click()
  await waitFor(async () => (await state()).source === external)
  await waitEditorContains('外部修改')
  check('重新载入后源码等于外部内容', true)
  check('重新载入未写磁盘', fs.readFileSync(FILE_A, 'utf8') === external)

  // 5. Conflict: dirty buffer plus external write.
  await insertAtEnd(' 本地修改')
  const conflictText = '# 外部冲突\n\ncontent\n'
  fs.writeFileSync(FILE_A, conflictText, 'utf8')
  await waitState({ external: 'conflict' })
  check('脏缓冲时 watcher 报冲突', true)

  await page.evaluate(() => window.__YNOTE_DEBUG__.save())
  await waitState({ external: 'conflict' })
  check('冲突保存未覆盖磁盘', fs.readFileSync(FILE_A, 'utf8') === conflictText)
  const localSource = (await state()).source
  check('本地修改仍在缓冲区', localSource.includes('本地修改'))

  page.once('dialog', dialog => dialog.accept())
  await page.locator('.notice-danger').getByRole('button', { name: '保留本地' }).click()
  await waitState({ dirty: false, external: 'none', saveState: 'saved' })
  check('保留本地覆盖磁盘', fs.readFileSync(FILE_A, 'utf8') === localSource)

  // 6. Missing file: save refuses, keep-local recreates.
  await openPath(FILE_C)
  await waitEditorContains('删除测试')
  await insertAtEnd(' 本地保留')
  fs.rmSync(FILE_C)
  await waitState({ external: 'conflict' })
  await page.evaluate(() => window.__YNOTE_DEBUG__.save())
  await waitState({ external: 'conflict' })
  check('文件缺失时保存不重建', !fs.existsSync(FILE_C))

  page.once('dialog', dialog => dialog.accept())
  await page.locator('.notice-danger').getByRole('button', { name: '保留本地' }).click()
  await waitState({ dirty: false, external: 'none', saveState: 'saved' })
  check('保留本地重建被删除文件', fs.existsSync(FILE_C))
  check('重建内容为本地缓冲区', fs.readFileSync(FILE_C, 'utf8').includes('本地保留'))

  // 7. BOM + CRLF + no final newline.
  const openedB = await openPath(FILE_B)
  await waitEditorContains('BOM 标题')
  check(
    'BOM/CRLF/无末尾换行识别',
    openedB.encoding === 'utf-8-bom' && openedB.eol === 'CRLF' && !B_TEXT.endsWith('\n'),
  )
  const bSha = sha(fs.readFileSync(FILE_B))
  await saveWithShortcut()
  await waitState({ dirty: false, saveState: 'saved' })
  check('BOM/CRLF 无操作保存字节不变', sha(fs.readFileSync(FILE_B)) === bSha)

  await insertAtEnd(' 追加')
  await saveWithShortcut()
  await waitState({ dirty: false, saveState: 'saved' })
  const bBytes = fs.readFileSync(FILE_B)
  const bAfter = bBytes.toString('utf8')
  check('BOM 字节保留', bBytes[0] === 0xef && bBytes[1] === 0xbb && bBytes[2] === 0xbf)
  check('CRLF 保留', bAfter.includes('\r\n') && !bAfter.replace(/\r\n/g, '').includes('\n'))
  check('编辑已写入 BOM/CRLF 文件', bAfter.includes('追加'))
  check('末尾未新增换行', !bAfter.endsWith('\n'))

  // 8. Read-only file: write fails without damaging the original.
  fs.chmodSync(FILE_A, 0o444)
  const readOnlyBytes = fs.readFileSync(FILE_A)
  await openPath(FILE_A)
  await waitEditorContains('本地修改')
  await insertAtEnd(' 只读尝试')
  await page.evaluate(() => window.__YNOTE_DEBUG__.save())
  await waitFor(async () => (await state()).saveState === 'error', 8000)
  check('只读文件保存失败且原文件不变', sha(fs.readFileSync(FILE_A)) === sha(readOnlyBytes))
  fs.chmodSync(FILE_A, 0o666)
  console.log(`\nArtifacts: ${DIR}`)
} catch (error) {
  failed = true
  console.error(`\nACCEPTANCE FAILED: ${error.message}`)
  console.error(`Artifacts kept at ${DIR}`)
  process.exitCode = 1
}

try {
  if (!failed) {
    fs.chmodSync(FILE_A, 0o666)
    fs.rmSync(DIR, { recursive: true, force: true })
    // The last edit schedules a 1.2 s draft write; let it fire before deleting.
    await new Promise(resolve => setTimeout(resolve, 1400))
    await page.evaluate(async () => {
      const api = window.__YNOTE_DEBUG__
      const target = api?.store.doc?.path
      if (target) {
        await api.store.gateway.deleteDraft(target).catch(() => undefined)
      }
    })
    console.log('Temporary acceptance directory removed.')
  }
} catch (error) {
  console.error(`Cleanup warning: ${error.message}`)
}

await browser.close()
console.log(
  JSON.stringify(
    { passed: checks.filter(item => item.ok).length, total: checks.length, checks },
    null,
    2,
  ),
)
