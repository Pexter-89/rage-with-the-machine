import { useEffect, useRef, type ReactNode } from 'react';
import { closeLayer, openLayer } from '../router';

interface Props {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
}

/** Generic bottom sheet with a backdrop; tapping the backdrop or the phone's back button closes it. */
export default function Sheet({ open, title, onClose, children }: Props) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const token = openLayer(() => close.current());
    return () => closeLayer(token);
  }, [open]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" data-testid="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label={title}
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="sheet-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
