'use client';

import { type ReactNode, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';

interface ConfirmButtonProps {
  label: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
  tone?: 'primary' | 'danger';
  small?: boolean;
}

/** A button that asks for confirmation in a modal dialog before running an action. */
export function ConfirmButton(props: ConfirmButtonProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm();
      dialog.current?.close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`button ${props.tone ?? 'primary'}${props.small ? ' small' : ''}`}
        disabled={props.disabled}
        onClick={() => {
          setError(null);
          dialog.current?.showModal();
        }}
      >
        {props.label}
      </button>
      <dialog ref={dialog} className="dialog" aria-labelledby={`${props.title}-title`}>
        <h2 id={`${props.title}-title`}>{props.title}</h2>
        <div className="muted">{props.description}</div>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button
            type="button"
            className="button"
            onClick={() => dialog.current?.close()}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`button ${props.tone ?? 'primary'}`}
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? 'Working…' : props.confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
