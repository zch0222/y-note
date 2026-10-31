import { useAppStore } from '../state/useStore.js'

export function PrintPreview() {
  const store = useAppStore()
  if (!store.printHtml) {
    return null
  }

  return (
    <div className="print-root" aria-hidden="true">
      <header className="print-head">
        <span>{store.doc?.name ?? 'Y Note'}</span>
        <span>
          {store.doc?.encoding.toUpperCase()} · {store.doc?.eol}
        </span>
      </header>
      <article
        className="ynote-prose print-document"
        // Tiptap's schema renderer escapes text; only its own node markup is injected here.
        dangerouslySetInnerHTML={{ __html: store.printHtml }}
      />
    </div>
  )
}
