// Launches the release binary and verifies the production CSP, packaging,
// window chrome, file scope, editing, saving, printing and settings.
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { chromium } from '@playwright/test'

const APP = path.resolve('src-tauri/target/release/y-note.exe')
const PORT = 9224
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'y-note-release-'))
const FILE = path.join(DIR, 'release.md')
const ORIGINAL = '# 发布验收\n\n原始内容。\n'
fs.writeFileSync(FILE, ORIGINAL, 'utf8')

function sha(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!condition) {
    throw new Error(name)
  }
}

async function waitFor(fn, timeout = 10_000, interval = 100) {
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

async function connect() {
  let lastError
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
      const context = browser.contexts()[0]
      const page = context?.pages().find(candidate => candidate.url().includes('tauri.localhost'))
      if (page) {
        return { browser, context, page }
      }
      await browser.close()
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Could not connect to the release app: ${lastError?.message ?? 'timeout'}`)
}

if (!fs.existsSync(APP)) {
  throw new Error(`Release binary not found: ${APP}`)
}

const child = spawn(APP, {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
  },
  stdio: 'ignore',
})

let browser
let failed = false
try {
  const connected = await connect()
  browser = connected.browser
  const context = connected.context
  const page = connected.page
  await page.waitForSelector('.titlebar')

  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  const headerPromise = new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 8_000)
    cdp.on('Network.responseReceived', event => {
      if (event.response.url === 'http://tauri.localhost/') {
        clearTimeout(timer)
        resolve(event.response.headers['content-security-policy'] ?? '')
      }
    })
  })
  await page.reload()
  await page.waitForSelector('.titlebar')
  const csp = await headerPromise
  check('发布版提供 CSP 响应头', Boolean(csp), String(csp).slice(0, 120))
  check(
    '生产 CSP 不含脚本 unsafe-inline/unsafe-eval',
    Boolean(csp) && !/script-src[^;]*(unsafe-inline|unsafe-eval)/.test(csp),
    String(csp),
  )
  const inlineAllowed = await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.__CSP_INLINE_ALLOWED__ = true'
    document.head.append(script)
    return Boolean(window.__CSP_INLINE_ALLOWED__)
  })
  check('生产 CSP 阻止内联脚本', inlineAllowed === false)

  const titlebar = await page.evaluate(() => ({
    drag: document.querySelectorAll('.titlebar[data-tauri-drag-region]').length,
    controls: document.querySelectorAll('.window-control').length,
    labels: [...document.querySelectorAll('.window-control')].map(button =>
      button.getAttribute('aria-label'),
    ),
  }))
  check('自定义标题栏与拖拽区域存在', titlebar.drag === 1 && titlebar.controls === 3)
  check(
    '窗口控制具有可访问名称',
    titlebar.labels.join(',') === '最小化窗口,最大化窗口,关闭窗口',
    titlebar.labels.join(','),
  )
  await page.getByRole('button', { name: '最大化窗口' }).click()
  await waitFor(
    async () =>
      (await page.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' }),
      )) === true,
  )
  check('发布版最大化按钮生效', true)
  await page.getByRole('button', { name: '还原窗口' }).click()
  await waitFor(
    async () =>
      (await page.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' }),
      )) === false,
  )
  check('发布版还原按钮生效', true)

  await page.getByRole('button', { name: '打开 Markdown' }).click()
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('scripts/select-open-file.ps1'),
      '-Path',
      FILE,
    ],
    { stdio: 'ignore', timeout: 45_000 },
  )
  await page.waitForSelector('.ProseMirror')
  check('发布版通过原生对话框打开文件', (await page.title()).includes('release.md'))

  const before = sha(fs.readFileSync(FILE))
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(800)
  check('发布版无操作保存不改写字节', sha(fs.readFileSync(FILE)) === before)

  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' 发布验证')
  await page.keyboard.press('Control+s')
  await waitFor(() => fs.readFileSync(FILE, 'utf8').includes('发布验证'))
  const saved = fs.readFileSync(FILE, 'utf8')
  check('发布版编辑并原子保存', saved === `${ORIGINAL.replace(/\n$/, '')} 发布验证\n`)
  check('保存只追加真实修改', saved.startsWith('# 发布验收\n\n原始内容。'))
  check('保存后无临时文件残留', !fs.readdirSync(DIR).some(name => name.includes('.ynote.tmp')))

  const printed = await page.evaluate(async () => {
    const original = window.print
    window.__RELEASE_PRINTED__ = null
    window.print = () => {
      window.__RELEASE_PRINTED__ = document.querySelector('.print-document')?.textContent ?? ''
    }
    try {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }),
      )
      await new Promise(resolve => setTimeout(resolve, 400))
      return window.__RELEASE_PRINTED__
    } finally {
      window.print = original
    }
  })
  check('发布版打印/PDF 视图包含正文', String(printed).includes('发布验证'), String(printed))
  check('打印不写回源文件', fs.readFileSync(FILE, 'utf8') === saved)

  await page.keyboard.press('Control+k')
  await page.waitForSelector('.palette-modal')
  check('发布版命令面板可用', true)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+,')
  await page.waitForSelector('.settings-modal')
  await page.getByRole('radio', { name: /^深色/ }).check()
  check(
    '发布版设置切换深色主题',
    (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark',
  )
  await page.keyboard.press('Escape')

  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' 冲突草稿')
  fs.writeFileSync(FILE, '# 外部写入\n\n磁盘版本。\n', 'utf8')
  await page.waitForTimeout(800)
  await page.keyboard.press('Control+s')
  await page.waitForSelector('.notice-danger')
  check(
    '发布版检测外部修改冲突',
    (await page.locator('.notice-danger').textContent()).includes('保存冲突'),
  )
  await page.getByRole('button', { name: '保留我的草稿' }).click()
  await page.locator('.confirm-modal').getByRole('button', { name: '覆盖磁盘' }).click()
  await waitFor(() => !fs.readFileSync(FILE, 'utf8').includes('磁盘版本'))
  check('发布版确认后保留本地草稿', fs.readFileSync(FILE, 'utf8').includes('冲突草稿'))
  await page.waitForSelector('.notice-danger', { state: 'detached' })

  const outside = path.join(os.tmpdir(), `y-note-release-outside-${Date.now()}.md`)
  fs.writeFileSync(outside, '# outside\n', 'utf8')
  const scope = await page.evaluate(async target => {
    try {
      await window.__TAURI_INTERNALS__.invoke('read_document', { path: target })
      return 'allowed'
    } catch (error) {
      return error?.code ?? String(error)
    }
  }, outside)
  check('发布版未授权路径被拒绝', scope === 'not-authorized', scope)
  const testScope = await page.evaluate(async target => {
    try {
      await window.__TAURI_INTERNALS__.invoke('authorize_test_root', { path: target })
      return 'allowed'
    } catch (error) {
      return error?.code ?? String(error)
    }
  }, DIR)
  check('发布版不存在调试授权入口', testScope === 'not-authorized', testScope)
  const external = await page.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke('open_external', {
        url: 'file:///C:/Windows/System32/calc.exe',
      })
      return 'allowed'
    } catch (error) {
      return error?.code ?? String(error)
    }
  })
  check('发布版外链只允许安全协议', external === 'unsupported-scheme', external)
  const capability = await page.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke('plugin:window|is_decorated', { label: 'main' })
      return 'allowed'
    } catch (error) {
      return String(error)
    }
  })
  check('发布版 capability 拒绝未列出的命令', capability !== 'allowed', capability)
  fs.unlinkSync(outside)

  await page.getByRole('button', { name: '关闭窗口' }).click()
  await new Promise(resolve => setTimeout(resolve, 1500))
  console.log(`\nArtifacts: ${DIR}`)
} catch (error) {
  failed = true
  console.error(`\nRELEASE ACCEPTANCE FAILED: ${error.message}`)
  console.error(`Artifacts kept at ${DIR}`)
  process.exitCode = 1
} finally {
  try {
    await browser?.close()
  } catch {
    // The window may already be closed.
  }
  await new Promise(resolve => setTimeout(resolve, 500))
  if (!child.killed) {
    child.kill()
  }
  if (!failed) {
    try {
      fs.rmSync(DIR, { recursive: true, force: true })
      console.log('Temporary release directory removed.')
    } catch (error) {
      console.error(`Cleanup warning: ${error.message}`)
    }
  }
}

console.log(
  JSON.stringify(
    { passed: checks.filter(item => item.ok).length, total: checks.length, checks },
    null,
    2,
  ),
)
