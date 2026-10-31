import { useAppStore } from '../state/useStore.js'
import { Modal } from './Modal.js'

export function ConfirmDialog() {
  const store = useAppStore()
  const request = store.confirmRequest
  if (!request) {
    return null
  }

  return (
    <Modal
      title={request.title}
      role="alertdialog"
      onClose={() => store.resolveConfirm(false)}
      className="confirm-modal"
    >
      <p className="confirm-message">{request.message}</p>
      <div className="modal-actions">
        <button
          className="button"
          type="button"
          data-autofocus={request.danger ? true : undefined}
          onClick={() => store.resolveConfirm(false)}
        >
          {request.cancelLabel}
        </button>
        <button
          className={`button${request.danger ? ' danger' : ' primary'}`}
          type="button"
          data-autofocus={request.danger ? undefined : true}
          onClick={() => store.resolveConfirm(true)}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
