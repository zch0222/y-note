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

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '保留本地' }).click()
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
