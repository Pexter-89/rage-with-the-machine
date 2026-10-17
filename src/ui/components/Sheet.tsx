import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
}

/** Generic bottom sheet with a backdrop; tapping the backdrop closes it. */
export default function Sheet({ open, title, onClose, children }: Props) {
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
