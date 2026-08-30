import { useEffect, useRef, useState } from 'react';
import { ErrorBanner } from './Chrome';

/** The lecturer's code — the only place it is ever asked for. */
export function HelpCodeDialog({
  submitting,
  error,
  onDismiss,
  onSubmit,
}: {
  submitting: boolean;
  error: string | null;
  onDismiss: () => void;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="dialog__scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-code-title"
      onClick={() => {
        if (!submitting) onDismiss();
      }}
    >
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(code);
        }}
      >
        <h2 className="dialog__title" id="help-code-title">
          Attendance code
        </h2>
        <p className="subtitle" style={{ marginBottom: 14 }}>
          Ask your lecturer to read out the 8-digit code for this lecture, then enter it below.
        </p>
        <input
          ref={inputRef}
          className="input"
          value={code}
          // inputMode + pattern give iOS the numeric keypad without the
          // spinners and locale formatting that type="number" brings.
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={8}
          placeholder="8 digits"
          aria-label="Code"
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, '').slice(0, 8);
            setCode(next);
          }}
        />
        {error && (
          <div style={{ marginTop: 10 }}>
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="dialog__actions">
          <button
            type="button"
            className="dialog__action dialog__action--muted"
            onClick={onDismiss}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="dialog__action"
            disabled={code.length !== 8 || submitting}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  );
}
