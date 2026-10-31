import { describe, expect, it } from 'vitest'

import {
  analyzeBlockChanges,
  previewSourceDiff,
} from '../src/source/analysis.js'

describe('block change classification', () => {
  it('treats emphasis marker rewrites as format-only changes', () => {
    const analysis = analyzeBlockChanges('A **bold** sentence.\n', 'A __bold__ sentence.\n')
    expect(analysis.changes).toHaveLength(1)
    expect(analysis.changes[0]).toMatchObject({
      kind: 'modified',
      classification: 'format',
      tokenType: 'paragraph',
      oldLine: 1,
      newLine: 1,
    })
    expect(analysis.changes[0]?.detail).toContain('标记')
    expect(analysis.contentChanges).toBe(0)
    expect(analysis.formatChanges).toBe(1)
  })

  it('classifies paragraph text edits as content changes', () => {
    const analysis = analyzeBlockChanges('# Title\n\nalpha\n', '# Title\n\nbeta\n')
    expect(analysis.changes).toHaveLength(1)
    expect(analysis.changes[0]).toMatchObject({
      kind: 'modified',
      classification: 'content',
      tokenType: 'paragraph',
    })
    expect(analysis.changes[0]?.detail).toContain('alpha')
    expect(analysis.changes[0]?.detail).toContain('beta')
    expect(analysis.contentChanges).toBe(1)
    expect(analysis.formatChanges).toBe(0)
    expect(analysis.untouched).toBe(1)
  })

  it('reports heading level changes as format changes', () => {
    const analysis = analyzeBlockChanges('# Title\n', '## Title\n')
    expect(analysis.changes).toHaveLength(1)
    expect(analysis.changes[0]).toMatchObject({
      classification: 'format',
      tokenType: 'heading',
    })
    expect(analysis.changes[0]?.detail).toContain('H1')
    expect(analysis.changes[0]?.detail).toContain('H2')
  })

  it('reports list marker changes as format changes', () => {
    const analysis = analyzeBlockChanges('- item\n', '* item\n')
    expect(analysis.changes).toHaveLength(1)
    expect(analysis.changes[0]?.classification).toBe('format')
  })

  it('reports task state changes as content changes', () => {
    const analysis = analyzeBlockChanges('- [ ] task\n', '- [x] task\n')
    expect(analysis.changes).toHaveLength(1)
    expect(analysis.changes[0]?.classification).toBe('content')
    expect(analysis.changes[0]?.detail).toContain('任务状态')
  })

  it('reports link target changes as content changes', () => {
    const analysis = analyzeBlockChanges('[site](https://a.example)\n', '[site](https://b.example)\n')
    expect(analysis.changes).toHaveLength(1)
    expect(analysis.changes[0]?.classification).toBe('content')
    expect(analysis.changes[0]?.detail).toContain('链接')
  })

  it('separates code content edits from language changes', () => {
    const content = analyzeBlockChanges(
      '```ts\nlet answer = 1\n```\n',
      '```ts\nlet answer = 2\n```\n',
    )
    expect(content.changes[0]?.classification).toBe('content')

    const language = analyzeBlockChanges(
      '```ts\nlet answer = 1\n```\n',
      '```js\nlet answer = 1\n```\n',
    )
    expect(language.changes[0]?.classification).toBe('format')
    expect(language.changes[0]?.detail).toContain('代码语言')
  })

  it('detects added and removed blocks with line numbers', () => {
    const added = analyzeBlockChanges('one\n\nthree\n', 'one\n\ntwo\n\nthree\n')
    expect(added.changes).toHaveLength(1)
    expect(added.changes[0]).toMatchObject({
      kind: 'added',
      classification: 'content',
      oldLine: null,
      newLine: 3,
    })

    const removed = analyzeBlockChanges('one\n\ntwo\n\nthree\n', 'one\n\nthree\n')
    expect(removed.changes).toHaveLength(1)
    expect(removed.changes[0]).toMatchObject({
      kind: 'removed',
      oldLine: 3,
      newLine: null,
    })
    expect(removed.untouched).toBe(2)
  })

  it('detects table cell text edits without degrading the table', () => {
    const before = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    const after = '| a | b |\n| --- | --- |\n| 1 | 3 |\n'
    const analysis = analyzeBlockChanges(before, after)
    expect(analysis.changes).toHaveLength(1)
    expect(analysis.changes[0]).toMatchObject({
      tokenType: 'table',
      classification: 'content',
    })
  })

  it('returns no changes for identical sources', () => {
    const analysis = analyzeBlockChanges('# Title\n\ntext\n', '# Title\n\ntext\n')
    expect(analysis.changes).toEqual([])
    expect(analysis.contentChanges).toBe(0)
    expect(analysis.formatChanges).toBe(0)
  })

  it('counts CRLF line numbers correctly', () => {
    const analysis = analyzeBlockChanges('# A\r\n\r\none\r\n', '# A\r\n\r\ntwo\r\n')
    expect(analysis.changes[0]).toMatchObject({ oldLine: 3, newLine: 3 })
  })

  it('aligns insertions in large blocks and keeps untouched counts', () => {
    const lines = Array.from({ length: 600 }, (_, index) => `paragraph ${index}`).join('\n\n')
    const analysis = analyzeBlockChanges(`${lines}\n`, `${lines}\n\ninserted tail\n`)
    expect(analysis.oldBlocks).toBe(600)
    expect(analysis.newBlocks).toBe(601)
    expect(analysis.changes).toHaveLength(1)
    expect(analysis.changes[0]).toMatchObject({ kind: 'added', newLine: 1201 })
    expect(analysis.untouched).toBe(600)
  })

  it('truncates very large change lists but keeps totals', () => {
    const before = Array.from({ length: 250 }, (_, index) => `old ${index}`).join('\n\n')
    const after = Array.from({ length: 250 }, (_, index) => `new ${index}`).join('\n\n')
    const analysis = analyzeBlockChanges(before, after)
    expect(analysis.truncated).toBe(true)
    expect(analysis.changes).toHaveLength(200)
    expect(analysis.contentChanges).toBe(250)
  })
})

describe('source line preview', () => {
  it('reports a single contiguous change with context', () => {
    const preview = previewSourceDiff('one\ntwo\nthree\nfour\nfive\n', 'one\ntwo\nTHREE\nfour\nfive\n')
    expect(preview.added).toBe(1)
    expect(preview.removed).toBe(1)
    expect(preview.changed).toBe(true)
    expect(preview.rows.filter(row => row.kind === 'context')).toHaveLength(5)
  })

  it('reports no change for identical sources', () => {
    const preview = previewSourceDiff('same\n', 'same\n')
    expect(preview.changed).toBe(false)
    expect(preview.added).toBe(0)
    expect(preview.removed).toBe(0)
  })
})
