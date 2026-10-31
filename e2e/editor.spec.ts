import { expect, test, type Page } from '@playwright/test'

async function openDemo(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '打开示例文档' }).click()
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__YNOTE_DEBUG__?.store.doc)))
    .toBe(true)
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__YNOTE_DEBUG__?.store.editor)))
    .toBe(true)
}

async function hashes(page: Page) {
  return page.evaluate(() => window.__YNOTE_DEBUG__!.hashes())
}

async function source(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__YNOTE_DEBUG__!.source())
}

async function diskSource(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const api = window.__YNOTE_DEBUG__!
    const opened = await api.store.gateway.readDocument(api.store.doc!.path)
    return new TextDecoder().decode(opened.bytes)
  })
}

async function replaceDisk(page: Page, text: string): Promise<void> {
  await page.evaluate(async source => {
    const api = window.__YNOTE_DEBUG__!
    const path = api.store.doc!.path
    await api.store.gateway.writeDocument(path, new TextEncoder().encode(source), '')
  }, text)
}

async function insertAtEnd(page: Page, text: string): Promise<void> {
  await page.evaluate(value => {
    const editor = window.__YNOTE_DEBUG__!.store.editor!
    editor.chain().focus('end').insertContent(value).run()
  }, text)
}

test('opens, edits, saves, and leaves a no-op save byte-identical', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await openDemo(page)
  const initial = await hashes(page)
  expect(initial).not.toBeNull()
  expect(initial!.baseline).toBe(initial!.disk)

  await page.evaluate(() => window.__YNOTE_DEBUG__!.setMode('source'))
  await expect(page.locator('[data-testid="source-editor"]')).toBeVisible()
  await page.evaluate(() => window.__YNOTE_DEBUG__!.setMode('visual'))
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await page.evaluate(() => window.__YNOTE_DEBUG__!.focus())
  await page.keyboard.press('Control+s')

  const untouched = await hashes(page)
  expect(untouched).toEqual(initial)
  expect(await page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.dirty)).toBe(false)

  await insertAtEnd(page, ' E2E 编辑')
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.dirty))
    .toBe(true)

  await page.keyboard.press('Control+s')
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.dirty))
    .toBe(false)
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.saveState))
    .toBe('saved')

  const saved = await hashes(page)
  expect(saved!.baseline).toBe(saved!.current)
  expect(saved!.disk).toBe(saved!.current)
  expect(await source(page)).toContain('E2E 编辑')
  expect(pageErrors).toEqual([])
})

test('blocks a conflicting save and overwrites only after keeping local content', async ({ page }) => {
  await openDemo(page)
  await replaceDisk(page, '# 外部修改\n')
  await insertAtEnd(page, ' 本地修改')

  await page.keyboard.press('Control+s')
  await expect(page.locator('.notice-danger')).toContainText('保存冲突')

  const conflicted = await hashes(page)
  expect(conflicted!.disk).not.toBe(conflicted!.current)
  expect(await diskSource(page)).toBe('# 外部修改\n')

  await page.getByRole('button', { name: '保留我的草稿' }).click()
  await expect(page.getByRole('alertdialog', { name: '保留我的草稿？' })).toBeVisible()
  await page.getByRole('button', { name: '覆盖磁盘' }).click()
  await expect(page.locator('.notice-danger')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.dirty))
    .toBe(false)

  const local = await source(page)
  expect(local).toContain('本地修改')
  expect(await diskSource(page)).toBe(local)
  expect(await page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.external)).toBe('none')
})

test('offers a reload for a clean external change without writing the disk', async ({ page }) => {
  await openDemo(page)
  await replaceDisk(page, '# 外部修改\n')

  await page.keyboard.press('Control+s')
  await expect(page.locator('.notice-warn')).toContainText('磁盘文件已在外部修改')

  await page.locator('.notice-warn').getByRole('button', { name: '重新载入' }).click()
  await expect.poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.source())).toBe('# 外部修改\n')
  await expect(page.locator('.ProseMirror')).toContainText('外部修改')
  expect(await diskSource(page)).toBe('# 外部修改\n')
  expect(await page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.external)).toBe('none')
})

test('undoes and redoes an edit through the source bridge', async ({ page }) => {
  await openDemo(page)
  const initial = await hashes(page)
  const initialSource = await source(page)

  await insertAtEnd(page, ' 撤销测试')
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.dirty))
    .toBe(true)
  const edited = await hashes(page)

  await page.evaluate(() => window.__YNOTE_DEBUG__!.focus())
  await page.keyboard.press('Control+z')
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.dirty))
    .toBe(false)
  expect(await source(page)).toBe(initialSource)
  expect((await hashes(page))!.current).toBe(initial!.current)

  await page.evaluate(() => window.__YNOTE_DEBUG__!.store.editor!.commands.redo())
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.dirty))
    .toBe(true)
  expect(await source(page)).toContain('撤销测试')
  expect((await hashes(page))!.current).toBe(edited!.current)

  await page.keyboard.press('Control+s')
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.saveState))
    .toBe('saved')
  expect((await hashes(page))!.disk).toBe(edited!.current)
})

test('rolls back an unmappable table insertion', async ({ page }) => {
  await openDemo(page)
  const before = await source(page)
  const tableCount = () =>
    page.evaluate(
      () =>
        (window.__YNOTE_DEBUG__!.store.editor!.getJSON().content ?? []).filter(
          node => node.type === 'table',
        ).length,
    )
  const tablesBefore = await tableCount()

  await page.evaluate(() => {
    window.__YNOTE_DEBUG__!.store.editor!
      .chain()
      .focus('end')
      .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
      .run()
  })

  await expect(page.locator('.toast')).toContainText('表格')
  await expect.poll(tableCount).toBe(tablesBefore)
  expect(await source(page)).toBe(before)
  expect(await page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.dirty)).toBe(false)
})

test('does not carry undo history across documents', async ({ page }) => {
  await openDemo(page)
  await insertAtEnd(page, ' 第一篇编辑')
  await page.keyboard.press('Control+s')
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.saveState))
    .toBe('saved')

  await page.evaluate(async () => {
    await window.__YNOTE_DEBUG__!.store.openDemo('# 第二篇\n\n第二篇内容。\n', 'second.md')
  })
  await expect(page.locator('.ProseMirror')).toContainText('第二篇')
  const before = await source(page)

  await page.evaluate(() => window.__YNOTE_DEBUG__!.store.editor!.commands.undo())
  const after = await source(page)
  expect(after).toBe(before)
  expect(after).toContain('第二篇')
  expect(after).not.toContain('Clean by design')
})

test('commits an IME composition without dropping text', async ({ page, context }) => {
  await openDemo(page)
  await page.evaluate(() => window.__YNOTE_DEBUG__!.store.editor!.chain().focus('end').run())

  const cdp = await context.newCDPSession(page)
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

  await expect.poll(() => source(page)).toContain('中文')
  const text = (await source(page))!
  expect(text.split('中文')).toHaveLength(2)
  const selection = await page.evaluate(() => {
    const editor = window.__YNOTE_DEBUG__!.store.editor!
    return {
      empty: editor.state.selection.empty,
      atEnd: editor.state.selection.$from.parent.textContent.endsWith('中文'),
    }
  })
  expect(selection).toEqual({ empty: true, atEnd: true })
  expect(
    await page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.buffer.mapIssues.length),
  ).toBe(0)

  await page.keyboard.press('Control+s')
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.saveState))
    .toBe('saved')
  expect(await diskSource(page)).toContain('中文')
})

test('shows the Git diff view in browser preview without touching the document', async ({
  page,
}) => {
  await openDemo(page)
  await page.evaluate(() => {
    const store = window.__YNOTE_DEBUG__!.store
    store.setInspectorTab('diff')
    store.setDiffSource('git')
  })

  await expect(page.locator('.diff-source-switch button.active')).toHaveText('Git 差异')
  await expect(page.locator('.git-state')).toContainText('文件不在 Git 仓库中')
  expect(await page.evaluate(() => window.__YNOTE_DEBUG__!.store.git?.status)).toBe('not-repo')

  const before = await hashes(page)
  await page.keyboard.press('Control+s')
  expect(await hashes(page)).toEqual(before)
  expect(await page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.dirty)).toBe(false)

  await page.evaluate(() => window.__YNOTE_DEBUG__!.store.setDiffSource('local'))
  await expect(page.locator('.diff-source-switch button.active')).toHaveText('未保存改动')
})

test('types continuously through the incremental source patch path', async ({ page }) => {
  await openDemo(page)
  const before = (await source(page))!
  await page.evaluate(() => window.__YNOTE_DEBUG__!.store.editor!.chain().focus('end').run())
  await page.keyboard.type('ABC中文', { delay: 20 })
  await expect.poll(() => source(page)).toContain('ABC中文')

  const typed = (await source(page))!
  const expected = `${before.replace(/\n$/, '')}ABC中文${before.endsWith('\n') ? '\n' : ''}`
  expect(typed).toBe(expected)

  const fastEdits = await page.evaluate(
    () => window.__YNOTE_DEBUG__!.store.bridge?.fastEdits ?? 0,
  )
  expect(fastEdits).toBeGreaterThanOrEqual(3)
  expect(
    await page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.buffer.mapIssues.length),
  ).toBe(0)
  expect(await page.evaluate(() => window.__YNOTE_DEBUG__!.store.analysisMode)).toBe('worker')

  await page.keyboard.press('Control+z')
  await expect.poll(() => source(page)).toBe(before)
  await page.evaluate(() => window.__YNOTE_DEBUG__!.store.editor!.commands.redo())
  await expect.poll(() => source(page)).toBe(typed)

  await page.keyboard.press('Control+s')
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.saveState))
    .toBe('saved')
  expect(await diskSource(page)).toBe(typed)
})

test('classifies block changes as content or format in the local diff panel', async ({
  page,
}) => {
  await page.goto('/')
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__YNOTE_DEBUG__)))
    .toBe(true)
  await page.evaluate(() =>
    window.__YNOTE_DEBUG__!.store.openDemo(
      '# 标题\n\n**粗体**\n\n正文\n',
      'block-analysis.md',
    ),
  )
  await expect(page.locator('.ProseMirror')).toContainText('粗体')
  await page.evaluate(() => {
    const store = window.__YNOTE_DEBUG__!.store
    store.setInspectorTab('diff')
    store.setDiffSource('local')
  })

  await page.evaluate(() =>
    window.__YNOTE_DEBUG__!.store.applySourceText('# 标题\n\n__粗体__\n\n正文\n'),
  )
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.localBlocks?.formatChanges))
    .toBe(1)
  expect(
    await page.evaluate(() => window.__YNOTE_DEBUG__!.store.localBlocks?.contentChanges),
  ).toBe(0)
  await expect(page.locator('.block-change.format')).toHaveCount(1)
  await expect(page.locator('.block-change-summary')).toContainText('0 处内容修改')
  await expect(page.locator('.block-change-summary')).toContainText('1 处格式改写')

  await page.evaluate(() =>
    window.__YNOTE_DEBUG__!.store.applySourceText('# 标题\n\n__粗体__\n\n正文已修改\n'),
  )
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.localBlocks?.contentChanges))
    .toBe(1)
  await expect(page.locator('.block-change.content')).toHaveCount(1)
  await expect(page.locator('.block-change-summary')).toContainText('1 处内容修改')
})

test('keeps offscreen blocks selectable, findable, and undoable under virtualization', async ({
  page,
}) => {
  await page.goto('/')
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__YNOTE_DEBUG__)))
    .toBe(true)
  const blocks = Array.from({ length: 240 }, (_, index) =>
    index % 20 === 0
      ? `## Section ${index}\n\n\`\`\`ts\nconst value${index} = ${index}\n\`\`\``
      : `Paragraph ${index} with **bold** text.`,
  ).join('\n\n')
  await page.evaluate(
    text => window.__YNOTE_DEBUG__!.store.openDemo(`${text}\n`, 'virtual.md'),
    blocks,
  )
  await expect(page.locator('.ProseMirror')).toBeVisible()

  const virtualization = await page.evaluate(() => {
    const pre = document.querySelector('.ProseMirror pre')
    const paragraph = document.querySelector('.ProseMirror p')
    return {
      pre: pre ? getComputedStyle(pre).contentVisibility : null,
      paragraph: paragraph ? getComputedStyle(paragraph).contentVisibility : null,
      paragraphs: document.querySelectorAll('.ProseMirror p').length,
      codeBlocks: document.querySelectorAll('.ProseMirror pre').length,
    }
  })
  expect(virtualization.pre).toBe('auto')
  expect(virtualization.paragraph).toBe('auto')
  expect(virtualization.paragraphs).toBeGreaterThan(200)
  expect(virtualization.codeBlocks).toBe(12)

  await page.evaluate(() => {
    const scroll = document.getElementById('editor-scroll')
    if (scroll) {
      scroll.scrollTop = scroll.scrollHeight
    }
  })
  expect(
    await page.evaluate(() => document.querySelector('.ProseMirror')?.textContent ?? ''),
  ).toContain('Paragraph 10 with')

  const before = (await source(page))!
  await page.evaluate(() => {
    const editor = window.__YNOTE_DEBUG__!.store.editor!
    const size = editor.state.doc.content.size
    editor.chain().focus().setTextSelection(Math.max(1, size - 2)).insertContent('X').run()
  })
  await expect.poll(() => source(page)).toContain('X')
  expect((await source(page))!.length).toBe(before.length + 1)
  expect(
    await page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.buffer.mapIssues.length),
  ).toBe(0)

  await page.evaluate(() => window.__YNOTE_DEBUG__!.store.editor!.commands.undo())
  await expect.poll(() => source(page)).toBe(before)
  expect(
    await page.evaluate(() => {
      const editor = window.__YNOTE_DEBUG__!.store.editor!
      return editor.state.selection.from > 0 && editor.view.hasFocus()
    }),
  ).toBe(true)
})
