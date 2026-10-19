import { useState } from 'react';
import { oneLine } from '../lib/errors';
import Sheet from './Sheet';

interface Props {
  /** Shown when non-null; the text explains what will be deleted. */
  message: string | null;
  title?: string;
  confirmLabel?: string;
  onConfirm(): Promise<void> | void;
  onClose(): void;
}

/** "Are you sure?" sheet for deletions. Closes after a successful confirm; a failure shows inline. */
export default function ConfirmSheet({ message, title = 'Delete?', confirmLabel = 'Delete', onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      setError(null);
      onClose();
    } catch (e) {
      setError(oneLine(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={message !== null}
      title={title}
      onClose={() => {
        setError(null);
        onClose();
      }}
    >
      <p className="confirm-text">{message}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="nav-row">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-danger" disabled={busy} onClick={() => void confirm()}>
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
