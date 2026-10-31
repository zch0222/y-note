import { marked, type Lexer } from 'marked'

import type { SourceMapIssue } from './types.js'
import { viewForSource, type SourceView } from './views.js'

export interface MarkdownCell {
  text: string
  tokens?: MarkdownToken[]
  align?: 'left' | 'right' | 'center' | null
  header?: boolean
}

export interface MarkdownToken {
  type: string
  raw: string
  text?: string
  depth?: number
  lang?: string
  ordered?: boolean
  start?: number | ''
  task?: boolean
  checked?: boolean
  loose?: boolean
  href?: string
  title?: string | null
  tokens?: MarkdownToken[]
  items?: MarkdownToken[]
  header?: MarkdownCell[]
  rows?: MarkdownCell[][]
  align?: Array<'left' | 'right' | 'center' | null>
  codeBlockStyle?: string
}

export interface LexedToken {
  token: MarkdownToken
  from: number
  to: number
}

export interface LexResult {
  view: SourceView
  frontMatter?: { from: number; to: number }
  tokens: LexedToken[]
  issues: SourceMapIssue[]
}

function createLexer(): Lexer {
  return new marked.Lexer({ ...marked.defaults })
}

function frontMatterEnd(text: string): number {
  const firstNewline = text.indexOf('\n')
  if (firstNewline === -1) {
    return -1
  }

  const opening = text.slice(0, firstNewline).replace(/[ \t]+$/, '')
  if (opening !== '---' && opening !== '+++') {
    return -1
  }

  const closers = opening === '---' ? ['---', '...'] : ['+++']
  let cursor = firstNewline + 1

  while (cursor <= text.length) {
    const newline = text.indexOf('\n', cursor)
    const lineEnd = newline === -1 ? text.length : newline
    const line = text.slice(cursor, lineEnd).trimEnd()

    if (closers.includes(line)) {
      return newline === -1 ? text.length : newline + 1
    }

    if (newline === -1) {
      return -1
    }
    cursor = newline + 1
  }

  return -1
}

export function lexDocument(source: string): LexResult {
  const view = viewForSource(source)
  const issues: SourceMapIssue[] = []
  const frontMatterTo = frontMatterEnd(view.text)
  const bodyFrom = frontMatterTo === -1 ? 0 : frontMatterTo
  const body = view.text.slice(bodyFrom)
  const lexer = createLexer()
  const rawTokens = lexer.lex(body) as unknown as MarkdownToken[]
  const tokens: LexedToken[] = []
  let cursor = bodyFrom

  for (const token of rawTokens) {
    const raw = token.raw ?? ''
    if (raw.length === 0) {
      continue
    }

    let index = view.text.indexOf(raw, cursor)
    if (index === -1) {
      issues.push({
        code: 'token-not-locatable',
        message: `Could not locate token ${token.type} in source`,
        offset: cursor,
      })

      if (cursor < view.text.length) {
        tokens.push({
          token: { type: 'raw', raw: view.text.slice(cursor), text: view.text.slice(cursor) },
          from: cursor,
          to: view.text.length,
        })
      }
      cursor = view.text.length
      break
    }

    if (index < cursor) {
      index = cursor
    }

    tokens.push({ token, from: index, to: index + raw.length })
    cursor = index + raw.length
  }

  if (cursor < view.text.length) {
    const trailing = view.text.slice(cursor)
    issues.push({
      code: 'trailing-unclaimed-source',
      message: 'Trailing source was not claimed by any markdown token',
      offset: cursor,
    })
    tokens.push({
      token: { type: 'raw', raw: trailing, text: trailing },
      from: cursor,
      to: view.text.length,
    })
  }

  return {
    view,
    tokens,
    issues,
    ...(frontMatterTo === -1 ? {} : { frontMatter: { from: 0, to: frontMatterTo } }),
  }
}

export function lexInline(text: string): MarkdownToken[] {
  const lexer = createLexer()
  return lexer.inlineTokens(text) as unknown as MarkdownToken[]
}
