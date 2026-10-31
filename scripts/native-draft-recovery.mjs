// Forced-exit draft recovery, in two phases around a manual app kill:
//   node scripts/native-draft-recovery.mjs prepare
//   ... stop the Y Note process ...
//   ... relaunch with WebView2 remote debugging ...
//   node scripts/native-draft-recovery.mjs verify
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { chromium } from '@playwright/test'

const mode = process.argv[2]
const STATE_FILE = path.join(os.tmpdir(), 'y-note-draft-recovery-state.json')
const DRAFT_EDIT = ' 未保存的草稿内容'

const results = []

function sha(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!condition) {
    throw new Error(name)
  }
}

function appDataDir() {
  const roaming = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(roaming, 'com.ynote.app')
}

function draftFileFor(file) {
  return path.join(appDataDir(), 'drafts', `${sha(Buffer.from(file, 'utf8'))}.json`)
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

async function connect(root) {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const context = browser.contexts()[0] ?? (await browser.newContext())
  const page = context.pages().find(candidate => candidate.url().includes('localhost:1420'))
  if (!page) {
    throw new Error('Y Note page not found in WebView2')
  }
  await page.waitForFunction(() => Boolean(window.__YNOTE_DEBUG__?.store), null, {
    timeout: 15_000,
  })
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve('scripts/close-open-dialogs.ps1'),
      ],
      { stdio: 'ignore', timeout: 15_000 },
    )
  } catch {
    // No app process or no stale dialog.
  }
  await page.evaluate(async () => {
    const store = window.__YNOTE_DEBUG__?.store
    localStorage.clear()
    if (!store) {
      return
    }
    if (store.doc) {
      await store.gateway.deleteDraft(store.doc.path).catch(() => undefined)
    }
    await store.stopWatching().catch(() => undefined)
    store.doc = null
    store.workspace = null
    store.workspaceError = null
    store.recent = []
    store.toast = null
    store.mode = 'visual'
    store.emit()
  })
  await page.waitForFunction(() => !window.__YNOTE_DEBUG__?.store?.editor, null, {
    timeout: 15_000,
  })
  if (root) {
    await page.evaluate(async target => {
      const gateway = window.__YNOTE_DEBUG__?.store?.gateway
      if (!gateway?.authorizeTestRoot) {
        throw new Error('Debug path scope is unavailable')
      }
      await gateway.authorizeTestRoot(target)
    }, root)
  }
  return { browser, page }
}

async function openFile(page, file) {
  return page.evaluate(async target => {
    const api = window.__YNOTE_DEBUG__
    const opened = await api.store.gateway.readDocument(target)
    await api.store.openOpened(opened)
    const doc = api.store.doc
    return {
      path: doc.path,
      source: doc.buffer.current,
      draft: doc.draft ? doc.draft.source : null,
      dirty: doc.dirty,
    }
  }, file)
}

async function state(page) {
  return page.evaluate(() => {
    const doc = window.__YNOTE_DEBUG__.store.doc
    return doc
      ? {
          source: doc.buffer.current,
          dirty: doc.dirty,
          saveState: doc.saveState,
          draft: doc.draft ? doc.draft.source : null,
        }
      : null
  })
}

if (mode === 'prepare') {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'y-note-draft-recovery-'))
  const file = path.join(repo, 'recovery.md')
  const original = '# 草稿恢复\n\n原始内容。\n'
  fs.writeFileSync(file, original, 'utf8')
  execFileSync('git', ['-C', repo, 'init', '-q'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Y Note Acceptance'])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'acceptance@example.invalid'])
  execFileSync('git', ['-C', repo, 'add', '-A'])
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'initial'])

  const { browser, page } = await connect(repo)
  try {
    const opened = await openFile(page, file)
    await page.waitForFunction(
      () => Boolean(window.__YNOTE_DEBUG__?.store.editor?.getText().includes('草稿恢复')),
      null,
      { timeout: 5000 },
    )
    check('prepare 打开真实文件', opened.path === file && opened.source === original)
    await page.evaluate(value => {
      window.__YNOTE_DEBUG__.store.editor.chain().focus('end').insertContent(value).run()
    }, DRAFT_EDIT)
    await waitFor(async () => (await state(page)).dirty)
    await new Promise(resolve => setTimeout(resolve, 1600))

    const draft = await page.evaluate(
      async target => window.__YNOTE_DEBUG__.store.gateway.readDraft(target),
      file,
    )
    const expected = draft?.source ?? ''
    const draftFile = draftFileFor(file)
    check('草稿包含未保存内容', Boolean(expected.includes(DRAFT_EDIT)))
    check('草稿文件位于应用数据目录', fs.existsSync(draftFile), draftFile)
    check('草稿未写回文件', fs.readFileSync(file, 'utf8') === original)
    check(
      'prepare 后 Git 工作区干净',
      execFileSync('git', ['-C', repo, 'status', '--porcelain'], {
        encoding: 'utf8',
      }).trim() === '',
    )
    check('仓库内没有草稿文件', !fs.readdirSync(repo).some(name => name.includes('draft')))

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ repo, file, original, expected, draftFile }, null, 2),
    )
    console.log(`Prepared ${file}; stop the Y Note process now.`)
    console.log(JSON.stringify({ ok: true, total: results.length, results }, null, 2))
  } catch (error) {
    console.error(`PREPARE FAILED: ${error.message}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
} else if (mode === 'verify') {
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error(`Missing state file ${STATE_FILE}`)
  }
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  const { repo, file, original, expected, draftFile } = saved
  const { browser, page } = await connect(repo)
  try {
    const opened = await openFile(page, file)
    check('重启后检测到草稿', Boolean(opened.draft?.includes(DRAFT_EDIT)))
    check('重启后草稿文件仍在应用数据目录', fs.existsSync(draftFile))
    check('恢复前磁盘仍是原文', fs.readFileSync(file, 'utf8') === original)
    await page.locator('.notice-draft').waitFor({ state: 'visible' })
    check('草稿恢复提示可见', await page.locator('.notice-draft').isVisible())
    check(
      '恢复前 Git 工作区干净',
      execFileSync('git', ['-C', repo, 'status', '--porcelain'], {
        encoding: 'utf8',
      }).trim() === '',
    )

    await page.locator('.notice-draft').getByRole('button', { name: '恢复草稿' }).click()
    await waitFor(async () => (await state(page)).dirty)
    const restored = await state(page)
    check('恢复草稿内容正确', restored.source.includes(DRAFT_EDIT))
    check('恢复后磁盘仍未写入', fs.readFileSync(file, 'utf8') === original)
    check(
      '恢复草稿不改变 Git 工作区',
      execFileSync('git', ['-C', repo, 'status', '--porcelain'], {
        encoding: 'utf8',
      }).trim() === '',
    )

    await page.evaluate(() => window.__YNOTE_DEBUG__.focus())
    await page.keyboard.press('Control+s')
    await waitFor(async () => (await state(page)).saveState === 'saved')
    check('保存恢复后的草稿', fs.readFileSync(file, 'utf8') === expected)
    check('保存后草稿文件删除', !fs.existsSync(draftFile))
    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], {
      encoding: 'utf8',
    }).trimEnd()
    check(
      '恢复保存只改动目标文件',
      status
        .split('\n')
        .filter(Boolean)
        .map(line => line.slice(3).trim())
        .join(',') === 'recovery.md',
      status,
    )
    const diff = execFileSync(
      'git',
      ['-C', repo, 'diff', '--unified=0', '--', 'recovery.md'],
      { encoding: 'utf8' },
    )
    check('恢复保存的 Git Diff 只有一行增删', (diff.match(/^@@/gm) ?? []).length === 1)

    await page.evaluate(async () => {
      const store = window.__YNOTE_DEBUG__?.store
      if (!store) {
        return
      }
      await store.stopWatching().catch(() => undefined)
      store.doc = null
      store.emit()
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    let removed = false
    for (let attempt = 0; attempt < 5 && !removed; attempt += 1) {
      try {
        fs.rmSync(repo, { recursive: true, force: true })
        removed = true
      } catch (error) {
        if (attempt === 4) {
          throw error
        }
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }
    fs.rmSync(STATE_FILE, { force: true })
    console.log('Temporary recovery repository removed.')
    console.log(JSON.stringify({ ok: true, total: results.length, results }, null, 2))
  } catch (error) {
    console.error(`VERIFY FAILED: ${error.message}`)
    console.error(`Artifacts kept: ${repo}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
} else {
  console.error('Usage: node scripts/native-draft-recovery.mjs <prepare|verify>')
  process.exitCode = 1
}
