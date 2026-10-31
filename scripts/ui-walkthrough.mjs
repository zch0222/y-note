// Design walkthrough against a running release app with WebView2 CDP:
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 src-tauri/target/release/y-note.exe
//   node scripts/ui-walkthrough.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { chromium } from '@playwright/test'

const demoPath = path.resolve('test-results/m3-walkthrough.md')
fs.mkdirSync(path.dirname(demoPath), { recursive: true })
fs.writeFileSync(
  demoPath,
  `---
title: Clean by design
tags: [m3, local-first]
---

# 让每一次修改，都只留下真实的差异。

Y Note 是一个本地优先的 Markdown 编辑器。它把优雅的所见即所得体验，和字节级可靠的 Git 友好保存结合在一起。原始源码是唯一事实。

## 01 原始源码是唯一事实

**Tiptap 负责编辑体验，SourceBuffer 负责文件真相。** 保存是源区间补丁，不是全文导出。

- [x] 原始编码、BOM 与换行风格保持
- [x] 未编辑块永不重新序列化
- [ ] 复杂结构使用局部源码安全降级

## 02 最小编辑补丁

\`\`\`ts
export function saveDocument(document: Document) {
  if (document.isPristine) return NO_OP
  return applySourcePatches(document.dirtySpans)
}
\`\`\`

> 未触碰的内容不会因为光标经过而被重新格式化。

| 层级 | 策略 | 适用场景 |
| --- | --- | --- |
| S1 | 行内文本替换 | 普通输入 |
| S4 | 局部区域重建 | 新增段落、列表 |
`,
  'utf8',
)

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const page = browser.contexts()[0].pages().find(candidate => !candidate.url().startsWith('devtools'))
if (!page) {
  throw new Error('Y Note release page not found')
}
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => message.type() === 'error' && errors.push(message.text()))
await page.waitForSelector('.titlebar')
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForSelector('.titlebar')

await page.keyboard.press('Control+,')
await page.waitForSelector('.settings-modal')
await page.getByRole('radio', { name: /^浅色/ }).check()
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.screenshot({ path: 'design/y-note-m3-welcome.png' })

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
    demoPath,
  ],
  { stdio: 'inherit', timeout: 45_000 },
)
await page.waitForSelector('.ProseMirror')
if (await page.locator('.notice-draft').count()) {
  await page.locator('.notice-draft').getByRole('button', { name: '丢弃' }).click()
  await page.waitForSelector('.notice-draft', { state: 'detached' })
}
await page.waitForTimeout(700)
await page.screenshot({ path: 'design/y-note-m3-light.png' })

await page.mouse.move(0, 0)
await page.keyboard.press('Control+k')
await page.waitForSelector('.palette-modal')
await page.waitForTimeout(200)
await page.screenshot({ path: 'design/y-note-m3-palette.png' })
await page.keyboard.press('Escape')

await page.keyboard.press('Control+,')
await page.waitForSelector('.settings-modal')
await page.getByRole('radio', { name: /^深色/ }).check()
await page.waitForTimeout(250)
await page.screenshot({ path: 'design/y-note-m3-settings.png' })
await page.keyboard.press('Escape')
await page.waitForTimeout(350)
await page.screenshot({ path: 'design/y-note-m3-dark.png' })

await page.locator('.ProseMirror').click()
await page.keyboard.press('Control+End')
await page.keyboard.type(' 本地冲突编辑')
fs.writeFileSync(demoPath, '# 外部写入\n\n磁盘版本。\n', 'utf8')
await page.waitForTimeout(900)
await page.keyboard.press('Control+s')
await page.waitForSelector('.notice-danger')
await page.waitForTimeout(200)
await page.screenshot({ path: 'design/y-note-m3-conflict.png' })
await page.getByRole('button', { name: '保留我的草稿' }).click()
await page.waitForSelector('.confirm-modal')
await page.waitForTimeout(150)
await page.screenshot({ path: 'design/y-note-m3-confirm.png' })
await page.getByRole('button', { name: '覆盖磁盘' }).click()
await page.waitForSelector('.notice-danger', { state: 'detached' })
await page.waitForTimeout(3200)

const cdp = await browser.contexts()[0].newCDPSession(page)
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 720,
  height: 450,
  deviceScaleFactor: 2,
  mobile: false,
})
await page.waitForTimeout(500)
await page.evaluate(() => {
  const scroll = document.getElementById('editor-scroll')
  if (scroll) {
    scroll.scrollTop = 0
  }
})
await page.waitForTimeout(200)
await page.screenshot({ path: 'design/y-note-m3-zoom200.png' })
await cdp.send('Emulation.clearDeviceMetricsOverride')
await page.waitForTimeout(300)

await page.keyboard.press('Control+,')
await page.waitForSelector('.settings-modal')
await page.getByRole('radio', { name: /^跟随系统/ }).check()
await page.keyboard.press('Escape')
console.log('errors', errors)
await browser.close()
