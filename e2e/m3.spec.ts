import { expect, test, type Page } from '@playwright/test'

async function openDemo(page: Page, source?: string, name?: string): Promise<void> {
  await page.goto('/')
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__YNOTE_DEBUG__)))
    .toBe(true)
  if (source) {
    await page.evaluate(
      ({ value, filename }) => window.__YNOTE_DEBUG__!.store.openDemo(value, filename),
      { value: source, filename: name ?? 'm3-demo.md' },
    )
  } else {
    await page.getByRole('button', { name: '打开示例文档' }).click()
  }
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__YNOTE_DEBUG__!.store.editor)))
    .toBe(true)
}

async function hashes(page: Page) {
  return page.evaluate(() => window.__YNOTE_DEBUG__!.hashes())
}

test('command palette is fully keyboard operable and closes with Escape', async ({ page }) => {
  await openDemo(page)
  await page.mouse.move(0, 0)

  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: '命令面板' })
  await expect(palette).toBeVisible()
  const input = page.getByRole('combobox', { name: '搜索命令' })
  await expect(input).toBeFocused()

  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.palette-item.active')).toContainText('搜索工作区文件')
  await page.keyboard.press('Enter')
  await expect(palette).toHaveCount(0)
  await expect(page.locator('#file-search')).toBeFocused()

  await page.keyboard.press('Control+k')
  await input.fill('源码')
  await expect(page.getByRole('option', { name: /切换到源码视图/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-testid="source-editor"]')).toBeVisible()
  await expect(palette).toHaveCount(0)

  await page.keyboard.press('Control+k')
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab')
  }
  expect(
    await page.evaluate(() => Boolean(document.activeElement?.closest('.palette-modal'))),
  ).toBe(true)
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)

  await page.keyboard.press('Control+Shift+b')
  await expect(page.locator('.window')).toHaveClass(/sidebar-closed/)
  await expect(page.getByRole('button', { name: '显示文件栏' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await page.keyboard.press('Control+Shift+b')
  await expect(page.locator('.file-sidebar')).toBeVisible()

  await page.keyboard.press('Control+Shift+d')
  await expect(page.locator('#inspector')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+d')
  await expect(page.locator('#inspector')).toBeVisible()
})

test('settings follow the system theme, persist explicitly and respect reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.keyboard.press('Control+,')
  const dialog = page.getByRole('dialog', { name: '设置' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio', { name: /^跟随系统/ })).toBeChecked()

  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await dialog.getByRole('radio', { name: /^深色/ }).check()
  await dialog.getByRole('checkbox', { name: /减少界面动画/ }).check()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
  expect(
    await page.locator('.toast').evaluate(element => getComputedStyle(element).transitionDuration),
  ).toBe('0s')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')

  await page.evaluate(() => {
    window.__YNOTE_DEBUG__!.store.setThemePreference('system')
    window.__YNOTE_DEBUG__!.store.setMotionPreference('system')
  })
})

test('prints the latest source buffer without writing or leaving source mode', async ({ page }) => {
  await openDemo(page)
  await page.evaluate(() => {
    window.__YNOTE_DEBUG__!.store.editor!.chain().focus('end').insertContent(' 打印编辑').run()
  })
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.dirty))
    .toBe(true)
  const edited = await hashes(page)

  await page.evaluate(() => {
    const target = window as unknown as { __printed?: string | null; print: () => void }
    target.__printed = null
    target.print = () => {
      target.__printed = document.querySelector('.print-document')?.textContent ?? ''
    }
  })
  await page.keyboard.press('Control+Shift+p')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __printed?: string }).__printed))
    .toContain('打印编辑')
  expect(await hashes(page)).toEqual(edited)
  await expect(page.locator('.print-root')).toHaveCount(0)

  await page.evaluate(() => window.__YNOTE_DEBUG__!.setMode('source'))
  await expect(page.locator('[data-testid="source-editor"]')).toBeVisible()
  await page.evaluate(() => {
    const store = window.__YNOTE_DEBUG__!.store
    store.applySourceText(`${store.doc!.buffer.current}源码打印编辑\n`)
    const target = window as unknown as { __printed?: string | null }
    target.__printed = null
  })
  await page.keyboard.press('Control+Shift+p')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __printed?: string }).__printed))
    .toContain('源码打印编辑')
  await expect(page.locator('[data-testid="source-editor"]')).toBeVisible()
  expect((await hashes(page))!.disk).toBe(edited!.disk)
})

test('opens external links outside the app and rejects unsafe schemes', async ({ page }) => {
  await openDemo(
    page,
    '# 链接\n\n[例子](https://example.com/path)\n\n[坏链接](javascript:alert(1))\n',
    'links.md',
  )
  await page.evaluate(() => {
    const target = window as unknown as { __opened?: string[]; open: (...args: unknown[]) => null }
    target.__opened = []
    target.open = (...args: unknown[]) => {
      target.__opened!.push(String(args[0]))
      return null
    }
  })

  await page.getByRole('link', { name: '例子' }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __opened?: string[] }).__opened))
    .toEqual(['https://example.com/path'])
  expect(page.url()).toBe('http://127.0.0.1:1420/')

  const unsafe = page.getByRole('link', { name: '坏链接' })
  if ((await unsafe.count()) > 0) {
    await unsafe.click()
    await expect(page.locator('.toast')).toContainText('只允许打开 http、https 或 mailto')
    expect(
      await page.evaluate(() => (window as unknown as { __opened?: string[] }).__opened),
    ).toEqual(['https://example.com/path'])
  }
})

test('link editing uses an accessible dialog and rejects active schemes', async ({ page }) => {
  await openDemo(page, '# 链接\n\n选择这段文字。\n', 'links-edit.md')
  await page.evaluate(() => {
    const editor = window.__YNOTE_DEBUG__!.store.editor!
    let range: { from: number; to: number } | null = null
    editor.state.doc.descendants((node, position) => {
      if (!range && node.isText && node.text?.includes('选择')) {
        range = { from: position, to: position + 2 }
      }
    })
    editor.chain().focus().setTextSelection(range!).run()
  })
  await page.getByRole('button', { name: '链接', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '插入链接' })
  await expect(dialog).toBeVisible()
  const input = page.getByRole('textbox', { name: '链接地址' })
  await expect(input).toBeFocused()

  await input.fill('javascript:alert(1)')
  await page.getByRole('button', { name: '应用' }).click()
  await expect(page.locator('.link-error')).toContainText('只支持 http')
  expect(await page.evaluate(() => window.__YNOTE_DEBUG__!.source())).not.toContain('javascript:')

  await input.fill('https://example.com/docs')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.source()))
    .toContain('[选择](https://example.com/docs)')
  expect(await page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.buffer.mapIssues.length)).toBe(
    0,
  )
})

test('core editing flow works without a mouse and survives 200% zoom', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 })
  await page.goto('/')
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__YNOTE_DEBUG__)))
    .toBe(true)
  await expect(page.getByRole('button', { name: '打开 Markdown' })).toBeVisible()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.keyboard.press('Control+o')
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'keyboard.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 键盘流程\n\n开始。\n', 'utf8'),
  })
  await expect(page.locator('.ProseMirror')).toContainText('键盘流程')

  await page.keyboard.type(' 输入')
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.source()))
    .toContain('输入')
  await page.keyboard.press('Control+s')
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.saveState))
    .toBe('saved')

  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: '搜索命令' }).fill('源码')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-testid="source-editor"]')).toBeVisible()
  await page.keyboard.press('Control+Shift+e')
  await expect(page.locator('.ProseMirror')).toBeVisible()

  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    editorWidth: document.querySelector('.editor-pane')!.getBoundingClientRect().width,
    editorSurfaceWidth: document.querySelector('.ProseMirror')!.getBoundingClientRect().width,
    sidebar: getComputedStyle(document.querySelector('.file-sidebar')!).display,
    inspector: document.querySelector('#inspector')
      ? getComputedStyle(document.querySelector('#inspector')!).display
      : null,
  }))
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1)
  expect(layout.editorWidth).toBeGreaterThan(600)
  expect(layout.editorSurfaceWidth).toBeGreaterThan(400)
  expect(layout.sidebar).toBe('none')
  expect(layout.inspector === null || layout.inspector === 'none').toBe(true)

  await page.keyboard.press('Control+k')
  const box = await page.locator('.palette-modal').boundingBox()
  expect(box!.width).toBeLessThanOrEqual(720)
  expect(box!.height).toBeLessThanOrEqual(450)
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 480, height: 320 })
  await expect
    .poll(() =>
      page.evaluate(() => ({
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        editorWidth: document.querySelector('.editor-pane')!.getBoundingClientRect().width,
      })),
    )
    .toEqual({ width: 480, scrollWidth: 480, editorWidth: 436 })
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+,')
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible()
  const settingsBox = await page.locator('.settings-modal').boundingBox()
  expect(settingsBox!.height).toBeLessThanOrEqual(320)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+s')
  await expect
    .poll(() => page.evaluate(() => window.__YNOTE_DEBUG__!.store.doc?.saveState))
    .toBe('saved')
})

test('landmarks, accessible names, skip link and focus indicators are present', async ({
  page,
}) => {
  await page.goto('/')
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__YNOTE_DEBUG__)))
    .toBe(true)
  await expect(page.getByRole('button', { name: '打开 Markdown' })).toBeVisible()

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Tab')
  const skip = page.locator('.skip-link')
  await expect(skip).toBeFocused()
  await expect
    .poll(() => skip.evaluate(element => element.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(0)
  await page.keyboard.press('Enter')
  await expect(page.locator('#editor-pane')).toBeFocused()

  await page.getByRole('button', { name: '打开示例文档' }).click()
  await expect(page.locator('.ProseMirror')).toBeVisible()
  const audit = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    const unnamed = buttons.filter(
      button =>
        !(
          button.getAttribute('aria-label')?.trim() ||
          button.textContent?.trim() ||
          button.getAttribute('title')?.trim()
        ),
    )
    const anchors = Array.from(document.querySelectorAll('a'))
    return {
      unnamed: unnamed.length,
      nav: document.querySelectorAll('nav').length,
      main: document.querySelectorAll('main').length,
      header: document.querySelectorAll('header').length,
      footer: document.querySelectorAll('footer').length,
      live: document.querySelectorAll('[aria-live]').length,
      unnamedAnchors: anchors.filter(
        anchor => !(anchor.textContent?.trim() || anchor.getAttribute('aria-label')),
      ).length,
      title: document.title,
    }
  })
  expect(audit.unnamed).toBe(0)
  expect(audit.unnamedAnchors).toBe(0)
  expect(audit.nav).toBeGreaterThanOrEqual(1)
  expect(audit.main).toBe(1)
  expect(audit.header).toBe(1)
  expect(audit.footer).toBe(1)
  expect(audit.live).toBeGreaterThanOrEqual(2)
  expect(audit.title).toContain('Y Note')

  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.ProseMirror')).toBeFocused()
  const focusEdge = await page
    .locator('#editor-scroll')
    .evaluate(element => getComputedStyle(element).boxShadow)
  expect(focusEdge).not.toBe('none')
})

test('conflict and empty states expose explicit, reversible actions', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /让每一次修改/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开 Markdown' })).toBeVisible()

  await openDemo(page)
  await page.evaluate(async () => {
    const api = window.__YNOTE_DEBUG__!
    const path = api.store.doc!.path
    await api.store.gateway.writeDocument(path, new TextEncoder().encode('# 外部\n'), '')
    api.store.editor!.chain().focus('end').insertContent(' 本地修改').run()
  })
  await page.keyboard.press('Control+s')
  await expect(page.locator('.notice-danger')).toContainText('保存冲突')
  await expect(page.locator('.notice-danger').getByRole('button', { name: '比较差异' })).toBeVisible()
  await expect(
    page.locator('.notice-danger').getByRole('button', { name: '使用磁盘版本' }),
  ).toBeVisible()
  await expect(
    page.locator('.notice-danger').getByRole('button', { name: '保留我的草稿' }),
  ).toBeVisible()
  await page.locator('.notice-danger').getByRole('button', { name: '比较差异' }).click()
  await expect(page.locator('.diff-source-switch button.active')).toHaveText('未保存改动')
})
