import { generateHTML, type JSONContent } from '@tiptap/core'

import { createEditorExtensions } from './schema.jsx'

export function renderPrintHtml(json: JSONContent): string {
  return generateHTML(
    json,
    createEditorExtensions({
      toggleMark: () => false,
      setBlockType: () => false,
    }),
  )
}
