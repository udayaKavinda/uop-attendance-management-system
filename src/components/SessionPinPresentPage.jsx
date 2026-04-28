import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  getAdminSessionCode,
  startAdminSessionRotation,
  stopAdminSessionRotation,
} from '../api';

export default function SessionPinPresentPage() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const label = searchParams.get('label') || 'Live session PIN';

  const [pin, setPin] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const root = document.getElementById('root');
    document.body.classList.add('present-pin-mode');
    root?.classList.add('present-pin-mode');
    return () => {
      document.body.classList.remove('present-pin-mode');
      root?.classList.remove('present-pin-mode');
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const resp = await getAdminSessionCode(sessionId);
    if (resp.error) {
      setError(resp.error);
      setPin(null);
      return;
    }
    setError('');
    setPin(resp);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function tick() {
      if (!sessionId || cancelled) return;
      await refresh();
      if (!cancelled) timer = window.setTimeout(tick, 1000);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [sessionId, refresh]);

  const onToggleRotation = async () => {
    if (!sessionId || !pin || busy) return;
    setBusy(true);
    setError('');
    const resp = pin.paused
      ? await startAdminSessionRotation(sessionId)
      : await stopAdminSessionRotation(sessionId);
    if (resp.error) setError(resp.error);
    await refresh();
    setBusy(false);
  };

  return (
    <div className="present-pin">
      <div className="present-pin__top">
        <Link to="/admin" className="present-pin__back">← Dashboard</Link>
        <p className="present-pin__label">{label}</p>
      </div>

      {error ? (
        <div className="present-pin__center">
          <p className="present-pin__error">{error}</p>
          <p className="present-pin__hint">The session may be inactive or outside its scheduled time.</p>
        </div>
      ) : pin ? (
        <>
          <div className="present-pin__center">
            <p className="present-pin__code" aria-live="polite">{pin.code}</p>
            <p className="present-pin__timer" aria-live="polite">
              {pin.paused ? (
                <span className="present-pin__paused">Rotation paused — PIN stays on screen</span>
              ) : (
                <>
                  <span className="present-pin__seconds">{pin.secondsRemaining ?? '—'}</span>
                  <span className="present-pin__unit">seconds until next PIN</span>
                </>
              )}
            </p>
          </div>
          <div className="present-pin__controls">
            <button
              type="button"
              className="present-pin__btn present-pin__btn--primary"
              onClick={onToggleRotation}
              disabled={busy}
            >
              {pin.paused ? '▶ Resume rotation' : '⏸ Pause rotation'}
            </button>
            <p className="present-pin__meta">
              {pin.rotationSeconds ? `Rotation interval: ${pin.rotationSeconds}s` : null}
            </p>
          </div>
        </>
      ) : (
        <div className="present-pin__center">
          <p className="present-pin__loading">Loading PIN…</p>
        </div>
      )}
    </div>
  );
}
