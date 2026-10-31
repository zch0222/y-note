// Windows/WebView2 acceptance. Start the app with:
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri -- dev --no-watch
// then run: npm run test:native
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { chromium } from '@playwright/test'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'y-note-native-'))
const FILE_A = path.join(DIR, 'lf.md')
const FILE_B = path.join(DIR, 'bom-crlf.md')
const FILE_C = path.join(DIR, 'deleted.md')
const FILE_D = path.join(DIR, 'picker.md')
const FILE_IME = path.join(DIR, 'ime.md')
const SUBDIR = path.join(DIR, 'sub')
const FILE_INNER = path.join(SUBDIR, 'inner.md')
const FILE_BLOCKS = path.join(DIR, 'blocks.md')
const FILE_UNTRACKED = path.join(DIR, 'untracked.md')
const FILE_STAGED = path.join(DIR, 'staged.md')
const FILE_RENAME_OLD = path.join(DIR, 'rename-old.md')
const FILE_RENAME_NEW = path.join(DIR, 'rename-new.md')
const FILE_DELETED_TRACKED = path.join(DIR, 'gone.md')
const FILE_BINARY = path.join(DIR, 'binary.bin')
const FILE_GBK = path.join(DIR, 'gbk.md')
const FILE_LARGE = path.join(DIR, 'large.md')

const A_TEXT = '# 原生验收\n\n第一段。\n\n- [ ] 任务\n'
const B_TEXT = '\uFEFF# BOM 标题\r\n\r\n第一段。\r\n\r\n第二段。'
const C_TEXT = '# 删除测试\n\n本地内容。\n'
const D_TEXT = '# 文件选择框\n\n通过原生对话框打开。\n'
const IME_TEXT = '# IME 验收\n\n原文。\n'
const INNER_TEXT = '# 子目录\n'

fs.writeFileSync(FILE_A, A_TEXT, 'utf8')
fs.writeFileSync(FILE_B, B_TEXT, 'utf8')
fs.writeFileSync(FILE_C, C_TEXT, 'utf8')
fs.writeFileSync(FILE_D, D_TEXT, 'utf8')
fs.writeFileSync(FILE_IME, IME_TEXT, 'utf8')
fs.mkdirSync(SUBDIR)
fs.writeFileSync(FILE_INNER, INNER_TEXT, 'utf8')

function git(args, options = {}) {
  return execFileSync('git', ['-C', DIR, ...args], {
    encoding: 'utf8',
    ...options,
  }).trim()
}

function gitStatus() {
  // Leading spaces are part of the porcelain status code.
  return execFileSync('git', ['-C', DIR, 'status', '--porcelain'], {
    encoding: 'utf8',
  }).trimEnd()
}

function changedFiles() {
  return gitStatus()
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3).trim())
}

function checkpoint(message) {
  let lastError = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      execFileSync('git', ['-C', DIR, 'add', '-A'], { encoding: 'utf8', stdio: 'pipe' })
      execFileSync('git', ['-C', DIR, 'commit', '-q', '-m', message], {
        encoding: 'utf8',
        stdio: 'pipe',
      })
      return
    } catch (error) {
      lastError = error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    }
  }
  const stderr = lastError?.stderr?.toString?.() ?? lastError?.message ?? 'git checkpoint failed'
  throw new Error(stderr)
}

git(['init', '-q'])
git(['config', 'user.name', 'Y Note Acceptance'])
git(['config', 'user.email', 'acceptance@example.invalid'])
checkpoint('initial')

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
  // No app process or no stale dialog; either way the reset below is harmless.
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

const testScope = await page.evaluate(async root => {
  const gateway = window.__YNOTE_DEBUG__?.store?.gateway
  if (!gateway?.authorizeTestRoot) {
    return 'unsupported'
  }
  await gateway.authorizeTestRoot(root)
  return 'ok'
}, DIR)
check('原生验收调试路径范围已授权', testScope === 'ok', testScope)

const outsideFile = path.join(os.tmpdir(), `y-note-outside-${Date.now()}.md`)
fs.writeFileSync(outsideFile, '# outside\n', 'utf8')
const outsideResult = await page.evaluate(async target => {
  try {
    await window.__YNOTE_DEBUG__.store.gateway.readDocument(target)
    return { code: 'allowed' }
  } catch (error) {
    return {
      code: error?.code ?? null,
      message: error?.message ?? String(error),
    }
  }
}, outsideFile)
check(
  '未授权路径被 Rust 路径范围拒绝',
  outsideResult.code === 'not-authorized',
  JSON.stringify(outsideResult),
)
fs.unlinkSync(outsideFile)

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

async function undoCommand() {
  await page.evaluate(() => {
    const editor = window.__YNOTE_DEBUG__.store.editor
    editor.chain().focus().run()
    editor.commands.undo()
  })
}

async function redoCommand() {
  await page.evaluate(() => window.__YNOTE_DEBUG__.store.editor.commands.redo())
}

async function tableCount() {
  return page.evaluate(
    () =>
      (window.__YNOTE_DEBUG__.store.editor.getJSON().content ?? []).filter(
        node => node.type === 'table',
      ).length,
  )
}

async function draftOf(file) {
  return page.evaluate(
    async target => window.__YNOTE_DEBUG__.store.gateway.readDraft(target),
    file,
  )
}

async function openViaPicker(file) {
  await page.evaluate(() => {
    void window.__YNOTE_DEBUG__.store.openFile()
  })
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('scripts/select-open-file.ps1'),
      '-Path',
      file,
    ],
    { stdio: 'inherit', timeout: 45_000 },
  )
  await page.waitForFunction(
    target => window.__YNOTE_DEBUG__?.store.doc?.path === target,
    file,
    { timeout: 15_000 },
  )
}

let failed = false
try {
  // 0. Open through the real Windows file dialog.
  await openViaPicker(FILE_D)
  await waitEditorContains('文件选择框')
  check('原生文件选择框打开真实文件', (await state()).source === D_TEXT)
  check('文件选择框打开不改变 Git 工作区', gitStatus() === '')

  // 1. Open a real LF file through the native backend.
  const opened = await openPath(FILE_A)
  await waitEditorContains('原生验收')
  const diskSha = sha(fs.readFileSync(FILE_A))
  check('打开真实 LF 文件', opened.path === FILE_A && opened.source === A_TEXT)
  check('LF 与 UTF-8 识别', opened.encoding === 'utf-8' && opened.eol === 'LF')
  check('打开时基线等于磁盘 SHA', opened.baseline === diskSha, diskSha.slice(0, 12))

  await new Promise(resolve => setTimeout(resolve, 1500))
  check('默认闲置不改变 Git 工作区', gitStatus() === '')
  const recentPaths = await page.evaluate(() =>
    window.__YNOTE_DEBUG__.store.recent.map(entry => entry.path),
  )
  check(
    '最近文件包含对话框与 IPC 打开的文件',
    recentPaths.includes(FILE_D) && recentPaths.includes(FILE_A),
  )

  // 2. No-op save through the real Ctrl/Cmd+S path.
  await page.evaluate(() => window.__YNOTE_DEBUG__.setMode('source'))
  await page.locator('[data-testid="source-editor"]').waitFor({ state: 'visible' })
  await page.evaluate(() => window.__YNOTE_DEBUG__.setMode('visual'))
  await page.locator('.ProseMirror').waitFor({ state: 'visible' })
  await waitEditorContains('原生验收')
  await saveWithShortcut()
  await waitState({ dirty: false, saveState: 'saved' })
  check('无操作保存字节不变', sha(fs.readFileSync(FILE_A)) === diskSha)
  check('无操作保存不改变 Git 工作区', gitStatus() === '')

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
  check(
    '单点修改仅改动目标文件',
    changedFiles().length === 1 && changedFiles()[0] === 'lf.md',
    gitStatus(),
  )
  const diffA = git(['diff', '--unified=0', '--', 'lf.md'])
  const hunks = diffA.split('\n').filter(line => line.startsWith('@@')).length
  const removed = diffA
    .split('\n')
    .filter(line => line.startsWith('-') && !line.startsWith('---')).length
  const added = diffA
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++')).length
  check('Git Diff 只有一个 hunk 和一行增删', hunks === 1 && removed === 1 && added === 1)

  // 3b. The read-only Git panel must match the real CLI diff.
  await page.evaluate(() => {
    const store = window.__YNOTE_DEBUG__.store
    store.setDiffSource('git')
    store.setInspectorTab('diff')
  })
  await page.waitForFunction(
    () => window.__YNOTE_DEBUG__?.store?.git?.status === 'modified',
    null,
    { timeout: 8000 },
  )
  const gitPanel = await page.evaluate(() => {
    const store = window.__YNOTE_DEBUG__.store
    const texts = selector =>
      [...document.querySelectorAll(selector)].map(node => node.textContent ?? '')
    return {
      status: store.git.status,
      additions: store.git.additions,
      deletions: store.git.deletions,
      hunks: store.git.hunks.length,
      branch: store.git.branch,
      head: store.git.head,
      switchLabel: document.querySelector('.diff-source-switch button.active')?.textContent?.trim(),
      summary: document.querySelector('.diff-summary .file-status')?.textContent?.trim(),
      addedRows: texts('.git-diff-line.added .line-text'),
      removedRows: texts('.git-diff-line.removed .line-text'),
    }
  })
  const cliNumstat = git(['diff', '--numstat', 'HEAD', '--', 'lf.md']).split('\t')
  check('Git 面板状态与 CLI 一致', gitPanel.status === 'modified')
  check(
    'Git 面板行数与 CLI numstat 一致',
    gitPanel.additions === Number(cliNumstat[0]) &&
      gitPanel.deletions === Number(cliNumstat[1]),
    `${gitPanel.additions}/${gitPanel.deletions} vs ${cliNumstat[0]}/${cliNumstat[1]}`,
  )
  check('Git 面板 hunk 数与 CLI 一致', gitPanel.hunks === hunks)
  check(
    'Git 面板分支与 HEAD 与 CLI 一致',
    gitPanel.branch === git(['rev-parse', '--abbrev-ref', 'HEAD']) &&
      gitPanel.head === git(['rev-parse', '--short', 'HEAD']),
    `${gitPanel.branch}@${gitPanel.head}`,
  )
  check('改动面板默认显示 Git 差异', gitPanel.switchLabel === 'Git 差异')
  check('Git 面板状态文案正确', gitPanel.summary === '工作区已修改', gitPanel.summary)
  check(
    'Git 面板渲染真实增删行',
    gitPanel.addedRows.some(text => text.includes('原生验收编辑')) &&
      gitPanel.removedRows.some(text => text.includes('任务')),
    JSON.stringify({ added: gitPanel.addedRows, removed: gitPanel.removedRows }),
  )

  checkpoint('single edit')
  await page.evaluate(() => window.__YNOTE_DEBUG__.store.refreshGitDiff())
  await page.waitForFunction(
    () =>
      window.__YNOTE_DEBUG__?.store?.git?.status === 'clean' &&
      (document.querySelector('.diff-panel .panel-placeholder')?.textContent ?? '').includes(
        'HEAD 版本一致',
      ),
    null,
    { timeout: 8000 },
  )
  const cleanGit = await page.evaluate(() => ({
    status: window.__YNOTE_DEBUG__.store.git?.status,
    empty: document.querySelector('.diff-panel .panel-placeholder')?.textContent ?? '',
  }))
  check('检查点后 Git 工作区干净', gitStatus() === '')
  check(
    '检查点后 Git 面板显示无差异',
    cleanGit.status === 'clean' && cleanGit.empty.includes('HEAD 版本一致'),
    cleanGit.empty,
  )

  // 3c. Unsaved buffer edits must not leak into the read-only Git diff.
  await insertAtEnd(' 未保存不进入 Git')
  await page.evaluate(() => window.__YNOTE_DEBUG__.store.refreshGitDiff())
  const unsavedGit = await page.evaluate(() => ({
    status: window.__YNOTE_DEBUG__.store.git?.status,
    lines: document.querySelectorAll('.git-diff-line').length,
  }))
  check(
    '未保存编辑不进入 Git 差异',
    unsavedGit.status === 'clean' && unsavedGit.lines === 0,
    JSON.stringify(unsavedGit),
  )
  await undoCommand()
  await waitState({ dirty: false })

  // 3d. Remaining Git states, block-level classification, and truncation.
  const LARGE_BLOCKS = Array.from({ length: 300 }, (_, index) => `block ${index}`)
  const LARGE_SEPARATOR = '\n'.repeat(10)
  fs.writeFileSync(FILE_BLOCKS, '# Blocks\n\n**bold**\n\nfirst\n', 'utf8')
  fs.writeFileSync(FILE_RENAME_OLD, '# Rename\n', 'utf8')
  fs.writeFileSync(FILE_DELETED_TRACKED, '# Gone\n\ntracked\n', 'utf8')
  fs.writeFileSync(
    FILE_BINARY,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
  )
  fs.writeFileSync(
    FILE_GBK,
    Buffer.from([0x23, 0x20, 0x47, 0x42, 0x4b, 0x0a, 0x0a, 0xd6, 0xd0, 0xce, 0xc4, 0x0a]),
  )
  fs.writeFileSync(FILE_LARGE, `${LARGE_BLOCKS.join(LARGE_SEPARATOR)}\n`, 'utf8')
  checkpoint('git states base')

  fs.writeFileSync(FILE_UNTRACKED, '# Untracked\n\nbody\n', 'utf8')
  fs.writeFileSync(FILE_STAGED, '# Staged\n\nstaged body\n', 'utf8')
  git(['add', 'staged.md'])
  fs.writeFileSync(FILE_BLOCKS, '# Blocks\n\n__bold__\n\nsecond\n', 'utf8')
  git(['mv', 'rename-old.md', 'rename-new.md'])
  fs.writeFileSync(
    FILE_BINARY,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0e]),
  )
  fs.writeFileSync(
    FILE_GBK,
    Buffer.from([
      0x23, 0x20, 0x47, 0x42, 0x4b, 0x0a, 0x0a, 0xd6, 0xd0, 0xce, 0xc4, 0xd0, 0xde, 0xb8, 0xc4,
      0x0a,
    ]),
  )
  fs.writeFileSync(
    FILE_LARGE,
    `${LARGE_BLOCKS.map((line, index) =>
      index < 210 ? `${line} changed` : line,
    ).join(LARGE_SEPARATOR)}\n`,
    'utf8',
  )

  async function waitGitState(status) {
    await page.waitForFunction(
      expected => window.__YNOTE_DEBUG__?.store?.git?.status === expected,
      status,
      { timeout: 10_000 },
    )
  }

  async function waitGitBlocks() {
    await page.waitForFunction(
      () =>
        window.__YNOTE_DEBUG__?.store?.gitBlocks !== null ||
        window.__YNOTE_DEBUG__?.store?.gitAnalysisNote !== null,
      null,
      { timeout: 15_000 },
    )
  }

  async function showGitPanel() {
    await page.evaluate(() => {
      const store = window.__YNOTE_DEBUG__.store
      store.setInspectorTab('diff')
      store.setDiffSource('git')
    })
  }

  await openPath(FILE_BLOCKS)
  await waitEditorContains('Blocks')
  await showGitPanel()
  await waitGitState('modified')
  await waitGitBlocks()
  const blocksAnalysis = await page.evaluate(() => {
    const store = window.__YNOTE_DEBUG__.store
    return {
      content: store.gitBlocks?.contentChanges,
      format: store.gitBlocks?.formatChanges,
      untouched: store.gitBlocks?.untouched,
      contentRows: document.querySelectorAll('.block-change.content').length,
      formatRows: document.querySelectorAll('.block-change.format').length,
      summary: document.querySelector('.block-change-summary')?.textContent ?? '',
    }
  })
  check(
    'Git 块级分析区分内容与格式',
    blocksAnalysis.content === 1 &&
      blocksAnalysis.format === 1 &&
      blocksAnalysis.untouched === 1,
    JSON.stringify(blocksAnalysis),
  )
  check(
    'Git 块级摘要渲染内容/格式条目',
    blocksAnalysis.contentRows === 1 &&
      blocksAnalysis.formatRows === 1 &&
      blocksAnalysis.summary.includes('1 处内容修改') &&
      blocksAnalysis.summary.includes('1 处格式改写'),
    blocksAnalysis.summary,
  )
  const cliBlocks = git(['diff', '--numstat', 'HEAD', '--', 'blocks.md']).split('\t')
  const panelBlocks = await page.evaluate(() => ({
    additions: window.__YNOTE_DEBUG__.store.git?.additions,
    deletions: window.__YNOTE_DEBUG__.store.git?.deletions,
  }))
  check(
    '块级分析文件的 Git 行数与 CLI 一致',
    panelBlocks.additions === Number(cliBlocks[0]) &&
      panelBlocks.deletions === Number(cliBlocks[1]),
    `${panelBlocks.additions}/${panelBlocks.deletions} vs ${cliBlocks[0]}/${cliBlocks[1]}`,
  )

  await openPath(FILE_UNTRACKED)
  await waitEditorContains('Untracked')
  await showGitPanel()
  await waitGitState('untracked')
  await waitGitBlocks()
  const untracked = await page.evaluate(() => ({
    changes: window.__YNOTE_DEBUG__.store.gitBlocks?.changes.length,
    hunks: window.__YNOTE_DEBUG__.store.git?.hunks.length,
    state: document.querySelector('.git-state')?.textContent ?? '',
  }))
  check(
    '未跟踪文件显示空基线和块级新增',
    untracked.hunks === 0 && (untracked.changes ?? 0) >= 2,
    JSON.stringify(untracked),
  )
  check('未跟踪文件空态文案可见', untracked.state.includes('尚未被 Git 跟踪'))

  await openPath(FILE_STAGED)
  await waitEditorContains('Staged')
  await showGitPanel()
  await waitGitState('staged')
  await waitGitBlocks()
  const staged = await page.evaluate(() => ({
    hunks: window.__YNOTE_DEBUG__.store.git?.hunks.length,
    changes: window.__YNOTE_DEBUG__.store.gitBlocks?.contentChanges,
    status: document.querySelector('.diff-summary .file-status')?.textContent ?? '',
  }))
  check(
    '已暂存文件显示相对 HEAD 的差异与块级新增',
    staged.hunks > 0 && (staged.changes ?? 0) >= 2,
    JSON.stringify(staged),
  )
  check('已暂存状态文案正确', staged.status.includes('已暂存'), staged.status)

  await openPath(FILE_RENAME_NEW)
  await waitEditorContains('Rename')
  await showGitPanel()
  await waitGitState('renamed')
  await waitGitBlocks()
  const renamed = await page.evaluate(() => ({
    from: window.__YNOTE_DEBUG__.store.git?.renamedFrom,
    changes: window.__YNOTE_DEBUG__.store.gitBlocks?.changes.length,
    state: document.querySelector('.git-state')?.textContent ?? '',
  }))
  check(
    '重命名文件报告旧路径',
    renamed.from === path.basename(FILE_RENAME_OLD),
    JSON.stringify(renamed),
  )
  check('纯重命名不产生块级变更', renamed.changes === 0, JSON.stringify(renamed))
  check('重命名状态文案可见', renamed.state.includes('已重命名'), renamed.state)

  await openPath(FILE_DELETED_TRACKED)
  await waitEditorContains('Gone')
  fs.rmSync(FILE_DELETED_TRACKED)
  await page.evaluate(() => window.__YNOTE_DEBUG__.store.refreshGitDiff())
  await showGitPanel()
  await waitGitState('deleted')
  await waitGitBlocks()
  const deleted = await page.evaluate(() => ({
    changes: window.__YNOTE_DEBUG__.store.gitBlocks?.changes.length,
    hunks: window.__YNOTE_DEBUG__.store.git?.hunks.length,
    state: document.querySelector('.git-state')?.textContent ?? '',
  }))
  check(
    '删除文件显示 HEAD 内容移除',
    deleted.hunks > 0 && (deleted.changes ?? 0) >= 1,
    JSON.stringify(deleted),
  )
  check('删除状态文案可见', deleted.state.includes('已从工作区删除'), deleted.state)

  await openPath(FILE_BINARY)
  await showGitPanel()
  await waitGitState('modified')
  const binary = await page.evaluate(() => ({
    binary: window.__YNOTE_DEBUG__.store.git?.binary,
    state: document.querySelector('.git-state')?.textContent ?? '',
  }))
  check('二进制文件被识别', binary.binary === true)
  check('二进制文件空态可见', binary.state.includes('二进制文件'), binary.state)

  await openPath(FILE_GBK)
  await showGitPanel()
  await waitGitState('modified')
  await waitGitBlocks()
  const gbk = await page.evaluate(() => ({
    readOnly: Boolean(window.__YNOTE_DEBUG__.store.doc?.readOnly),
    note: window.__YNOTE_DEBUG__.store.gitAnalysisNote,
    content: window.__YNOTE_DEBUG__.store.gitBlocks?.contentChanges,
  }))
  check('非 UTF-8 文件以只读方式打开', gbk.readOnly === true)
  check(
    '非 UTF-8 Git 块级分析标注有损解码',
    (gbk.note ?? '').includes('有损') && (gbk.content ?? 0) >= 1,
    JSON.stringify(gbk),
  )

  await openPath(FILE_LARGE)
  await showGitPanel()
  await waitGitState('modified')
  await waitGitBlocks()
  await waitFor(async () =>
    (await page.evaluate(() =>
      [...document.querySelectorAll('.diff-panel .panel-placeholder')].some(node =>
        (node.textContent ?? '').includes('差异过大'),
      ),
    )) === true,
  )
  const large = await page.evaluate(() => ({
    hunks: window.__YNOTE_DEBUG__.store.git?.hunks.length,
    gitTruncated: window.__YNOTE_DEBUG__.store.git?.truncated,
    blockTruncated: window.__YNOTE_DEBUG__.store.gitBlocks?.truncated,
    changes: window.__YNOTE_DEBUG__.store.gitBlocks?.changes.length,
  }))
  check(
    '大差异在 200 个 hunk 处截断',
    large.gitTruncated === true && large.hunks === 200,
    JSON.stringify(large),
  )
  check(
    '块级变更在 200 条处截断',
    large.blockTruncated === true && large.changes === 200,
    JSON.stringify(large),
  )

  checkpoint('git states')
  check('Git 状态验收后检查点干净', gitStatus() === '')

  // 4. Draft stays outside the Git workspace.
  await openPath(FILE_C)
  await waitEditorContains('删除测试')
  await undoCommand()
  check('打开新文档后撤销不会回到旧文档', (await state()).source === C_TEXT)
  const beforeDraft = fs.readFileSync(FILE_C, 'utf8')
  await insertAtEnd(' 草稿未保存')
  await new Promise(resolve => setTimeout(resolve, 1600))
  const draft = await draftOf(FILE_C)
  check('草稿写入应用数据目录', Boolean(draft?.source.includes('草稿未保存')))
  check('闲置与草稿不改变 Git 工作区', gitStatus() === '')
  check('草稿未写回文件', fs.readFileSync(FILE_C, 'utf8') === beforeDraft)
  await undoCommand()
  await waitState({ dirty: false })
  await page.evaluate(() => window.__YNOTE_DEBUG__.store.discardDraft())
  check('丢弃草稿后无残留', (await draftOf(FILE_C)) === null)
  check('撤销草稿后 Git 工作区仍干净', gitStatus() === '')

  // 5. Workspace tree and recent files.
  const tree = await page.evaluate(
    async root => window.__YNOTE_DEBUG__.store.gateway.readWorkspace(root),
    DIR,
  )
  const treeNames = []
  const walk = node => {
    treeNames.push(node.name)
    for (const child of node.children) walk(child)
  }
  walk(tree)
  check(
    '工作区树包含 Markdown 文件与子目录',
    treeNames.includes('lf.md') && treeNames.includes('sub') && treeNames.includes('inner.md'),
  )
  await page.evaluate(value => {
    const store = window.__YNOTE_DEBUG__.store
    store.workspace = value
    store.emit()
  }, tree)
  await page.locator('.file-sidebar .tree-row', { hasText: 'sub' }).click()
  await page.locator('.file-sidebar .tree-row', { hasText: 'inner.md' }).click()
  await waitFor(async () => (await state()).source === INNER_TEXT)
  check('文件树可打开子目录文件', true)

  // 6. Native watcher: external change while clean.
  await openPath(FILE_A)
  await waitEditorContains('原生验收')
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

  await page.locator('.notice-danger').getByRole('button', { name: '保留我的草稿' }).click()
  await page.locator('.confirm-modal').getByRole('button', { name: '覆盖磁盘' }).click()
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

  await page.locator('.notice-danger').getByRole('button', { name: '保留我的草稿' }).click()
  await page.locator('.confirm-modal').getByRole('button', { name: '覆盖磁盘' }).click()
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

  // 8. IME composition, undo/redo, and bridge rollback.
  checkpoint('before ime')
  check('IME 前检查点干净', gitStatus() === '')

  const cdp = await context.newCDPSession(page)
  await openPath(FILE_IME)
  await waitEditorContains('IME 验收')
  await page.evaluate(() => window.__YNOTE_DEBUG__.store.editor.chain().focus('end').run())
  await cdp.send('Input.imeSetComposition', {
    text: 'zhong',
    selectionStart: 5,
    selectionEnd: 5,
  })
  await cdp.send('Input.imeSetComposition', {
    text: '中文',
    selectionStart: 2,
    selectionEnd: 2,
  })
  await cdp.send('Input.insertText', { text: '中文' })
  await waitFor(async () => (await state()).source.includes('中文'))

  const imeSource = (await state()).source
  check('IME composition 不丢字', imeSource.split('中文').length === 2)
  const imeSelection = await page.evaluate(() => {
    const editor = window.__YNOTE_DEBUG__.store.editor
    return {
      empty: editor.state.selection.empty,
      atEnd: editor.state.selection.$from.parent.textContent.endsWith('中文'),
      issues: window.__YNOTE_DEBUG__.store.doc.buffer.mapIssues.length,
    }
  })
  check('IME 提交后选区在末尾', imeSelection.empty && imeSelection.atEnd)
  check('IME 后映射问题为 0', imeSelection.issues === 0)

  await undoCommand()
  await waitState({ dirty: false })
  check('撤销恢复 IME 前原文', (await state()).source === IME_TEXT)
  check('撤销后 Git 工作区干净', gitStatus() === '')
  await redoCommand()
  await waitState({ dirty: true })
  check('重做恢复中文输入', (await state()).source.includes('中文'))

  await saveWithShortcut()
  await waitState({ dirty: false, saveState: 'saved' })
  check(
    'IME 保存只改动目标文件',
    changedFiles().length === 1 && changedFiles()[0] === 'ime.md',
    gitStatus(),
  )
  const imeDiff = git(['diff', '--unified=0', '--', 'ime.md'])
  const imeHunks = imeDiff.split('\n').filter(line => line.startsWith('@@')).length
  const imeRemoved = imeDiff
    .split('\n')
    .filter(line => line.startsWith('-') && !line.startsWith('---')).length
  const imeAdded = imeDiff
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++')).length
  check('IME 的 Git Diff 只有一行增删', imeHunks === 1 && imeRemoved === 1 && imeAdded === 1)
  checkpoint('ime')

  const tablesBefore = await tableCount()
  await page.evaluate(() => {
    window.__YNOTE_DEBUG__.store.editor
      .chain()
      .focus('end')
      .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
      .run()
  })
  await waitFor(async () =>
    (await page.evaluate(() => window.__YNOTE_DEBUG__.store.toast?.message ?? '')).includes(
      '表格',
    ),
  )
  check('无法映射的结构变更被回滚', (await tableCount()) === tablesBefore)
  check('回滚后源码不变', (await state()).source === imeSource)
  check('回滚后文档仍未修改', (await state()).dirty === false)

  // 9. Read-only file: write fails without damaging the original.
  fs.chmodSync(FILE_A, 0o444)
  const readOnlyBytes = fs.readFileSync(FILE_A)
  await openPath(FILE_A)
  await waitEditorContains('本地修改')
  await insertAtEnd(' 只读尝试')
  await page.evaluate(() => window.__YNOTE_DEBUG__.save())
  await waitFor(async () => (await state()).saveState === 'error', 8000)
  check('只读文件保存失败且原文件不变', sha(fs.readFileSync(FILE_A)) === sha(readOnlyBytes))
  fs.chmodSync(FILE_A, 0o666)
  await page.evaluate(() => window.__YNOTE_DEBUG__.save())
  await waitState({ dirty: false, saveState: 'saved' })
  check('恢复写权限后可保存只读尝试', fs.readFileSync(FILE_A, 'utf8').includes('只读尝试'))

  // 10. M3: window chrome, palette, settings, print, security and 200% zoom.
  await openPath(FILE_A)
  await waitEditorContains('本地修改')
  check(
    '自定义标题栏使用原生拖拽区域',
    (await page.locator('.titlebar[data-tauri-drag-region]').count()) === 1 &&
      (await page.locator('.title-left[data-tauri-drag-region]').count()) === 1,
  )
  check(
    'Windows 标题栏包含最小化/最大化/关闭',
    (await page.getByRole('button', { name: '最小化窗口' }).count()) === 1 &&
      (await page.getByRole('button', { name: '最大化窗口' }).count()) === 1 &&
      (await page.getByRole('button', { name: '关闭窗口' }).count()) === 1,
  )

  await page.getByRole('button', { name: '最大化窗口' }).click()
  await waitFor(
    async () =>
      (await page.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' }),
      )) === true,
  )
  check('最大化按钮改变原生窗口状态', true)
  await page.getByRole('button', { name: '还原窗口' }).click()
  await waitFor(
    async () =>
      (await page.evaluate(() =>
        window.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' }),
      )) === false,
  )
  check('还原按钮恢复原生窗口状态', true)

  await page.keyboard.press('Control+k')
  await waitFor(async () => (await page.locator('.palette-modal').count()) === 1)
  check('命令面板可在原生窗口打开', await page.locator('.palette-modal').isVisible())
  await page.getByRole('combobox', { name: '搜索命令' }).fill('设置')
  await page.keyboard.press('Enter')
  await waitFor(async () => (await page.locator('.settings-modal').count()) === 1)
  check('命令面板可打开设置', await page.locator('.settings-modal').isVisible())
  await page.getByRole('radio', { name: /^深色/ }).check()
  check(
    '设置切换深色主题',
    (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark',
  )
  await page.getByRole('checkbox', { name: /减少界面动画/ }).check()
  check(
    '设置写入减少动效偏好',
    (await page.evaluate(() => document.documentElement.dataset.motion)) === 'reduced',
  )
  await page.keyboard.press('Escape')
  await waitFor(async () => (await page.locator('.settings-modal').count()) === 0)

  const beforePrint = sha(fs.readFileSync(FILE_A))
  const printed = await page.evaluate(async () => {
    const original = window.print
    window.__YNOTE_M3_PRINTED__ = null
    window.print = () => {
      window.__YNOTE_M3_PRINTED__ = document.querySelector('.print-document')?.textContent ?? ''
    }
    try {
      await window.__YNOTE_DEBUG__.store.printDocument()
      return window.__YNOTE_M3_PRINTED__
    } finally {
      window.print = original
    }
  })
  check('原生打印生成文档内容', String(printed).includes('本地修改'))
  check('打印不写回源文件', sha(fs.readFileSync(FILE_A)) === beforePrint)
  check(
    '打印结束后移除打印视图',
    (await page.locator('.print-root').count()) === 0,
  )

  const deniedCommand = await page.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke('plugin:window|is_decorated', { label: 'main' })
      return 'allowed'
    } catch (error) {
      return String(error)
    }
  })
  check('capability 未列出的 window 命令被拒绝', deniedCommand !== 'allowed', deniedCommand)

  const badExternal = await page.evaluate(async () => {
    try {
      await window.__YNOTE_DEBUG__.store.gateway.openExternal(
        'file:///C:/Windows/System32/calc.exe',
      )
      return 'allowed'
    } catch (error) {
      return error?.code ?? String(error)
    }
  })
  check('Rust 外部链接策略拒绝 file:// URL', badExternal === 'unsupported-scheme', badExternal)

  const zoomCdp = await context.newCDPSession(page)
  await zoomCdp.send('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 450,
    deviceScaleFactor: 2,
    mobile: false,
  })
  await new Promise(resolve => setTimeout(resolve, 300))
  const zoomLayout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    editorWidth: document.querySelector('.editor-pane').getBoundingClientRect().width,
    sidebar: getComputedStyle(document.querySelector('.file-sidebar')).display,
    inspector: document.querySelector('#inspector')
      ? getComputedStyle(document.querySelector('#inspector')).display
      : 'absent',
  }))
  check('200% 缩放等效视口无横向溢出', zoomLayout.scrollWidth <= zoomLayout.width + 1)
  check('200% 缩放下编辑器宽度有效', zoomLayout.editorWidth > 600, String(zoomLayout.editorWidth))
  check('200% 缩放收起文件栏与上下文面板', zoomLayout.sidebar === 'none')
  check(
    '200% 缩放下上下文面板不可见',
    zoomLayout.inspector === 'none' || zoomLayout.inspector === 'absent',
  )
  await page.keyboard.press('Control+k')
  await waitFor(async () => (await page.locator('.palette-modal').count()) === 1)
  const paletteBox = await page.locator('.palette-modal').boundingBox()
  check(
    '200% 缩放下命令面板不超出视口',
    paletteBox.width <= 720 && paletteBox.height <= 450,
    JSON.stringify(paletteBox),
  )
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+s')
  await waitState({ saveState: 'saved' })
  check('200% 缩放下仍可保存', sha(fs.readFileSync(FILE_A)) === beforePrint)
  await zoomCdp.send('Emulation.clearDeviceMetricsOverride')
  await new Promise(resolve => setTimeout(resolve, 300))

  await page.evaluate(() => {
    const store = window.__YNOTE_DEBUG__.store
    store.setThemePreference('system')
    store.setMotionPreference('system')
  })
  check(
    'M3 设置可恢复系统偏好',
    (await page.evaluate(() => document.documentElement.dataset.motion)) === 'system',
  )

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
