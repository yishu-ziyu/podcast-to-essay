import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  detail: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, detail, confirmLabel, danger = false, onConfirm, onCancel }: Props) {
  // Callers pass inline handlers; read the latest through a ref so the effect runs only on open/close.
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // Capture phase + stopPropagation: Esc closes only this dialog, not the drawer under it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      cancel.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="gate confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
        <b id="confirm-title">{title}</b>
        <p>{detail}</p>
        <div className="confirm-actions">
          <button type="button" className="button quiet" autoFocus onClick={onCancel}>取消</button>
          <button type="button" className={`button ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
