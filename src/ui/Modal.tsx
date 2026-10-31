import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'

import { Icon } from './Icon.js'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  className?: string
  role?: 'dialog' | 'alertdialog'
}

export function Modal({
  title,
  description,
  onClose,
  children,
  className,
  role = 'dialog',
}: ModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const focusables = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        element => element.getClientRects().length > 0,
      )
    const preferred =
      dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? dialog
    preferred?.focus()

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const list = focusables()
      if (list.length === 0) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      const first = list[0]!
      const last = list[list.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handler, true)
    return () => {
      document.removeEventListener('keydown', handler, true)
      previous?.focus()
    }
  }, [])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) {
          closeRef.current()
        }
      }}
    >
      <section
        className={`modal${className ? ` ${className}` : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <Icon name="x" size="small" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  )
}
