import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getCurrentBlePayload, patchAdminSessionAttendancePaused } from '../api';

const POLL_INTERVAL_MS = 5_000;
const BLE_MANUFACTURER_ID = 0x004c;

export default function BleSessionPage() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const label = searchParams.get('label') || 'Live BLE session';

  const [bleData, setBleData] = useState(null);
  const [error, setError] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [bleError, setBleError] = useState('');
  const [busy, setBusy] = useState(false);
  const bleAdRef = useRef(null);

  const bleSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const resp = await getCurrentBlePayload(sessionId);
    if (resp.error) { setError(resp.error); setBleData(null); return; }
    setError('');
    setBleData(resp);
  }, [sessionId]);

  // Poll server for current payload
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function tick() {
      if (cancelled) return;
      await refresh();
      if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [refresh]);

  // Update BLE advertisement when payload changes
  useEffect(() => {
    if (!broadcasting || !bleAdRef.current || !bleData?.payload) return;
    const encoder = new TextEncoder();
    const data = encoder.encode(bleData.payload);
    const mfData = new Map([[BLE_MANUFACTURER_ID, data]]);
    bleAdRef.current.updateAdvertisement?.({ manufacturerData: mfData }).catch(() => {});
  }, [bleData, broadcasting]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (bleAdRef.current) { try { bleAdRef.current.stop(); } catch (_) {} }
  }, []);

  const startBroadcast = async () => {
    if (!bleSupported) { setBleError('Web Bluetooth not supported. Use Chrome on Android.'); return; }
    setBleError('');
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(bleData?.payload || '');
        // eslint-disable-next-line no-unused-vars
      const mfData = new Map([[BLE_MANUFACTURER_ID, data]]);
      // Note: navigator.bluetooth.getAvailability + advertise is experimental
      const ad = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: false });
      bleAdRef.current = ad;
      setBroadcasting(true);
    } catch (err) {
      if (err.name === 'NotSupportedError') {
        setBleError('BLE advertising is not yet supported in this browser. Chrome on Android supports scanning; for broadcasting, a native app (Capacitor) is recommended.');
      } else {
        setBleError(`BLE error: ${err.message}`);
      }
    }
  };

  const stopBroadcast = () => {
    if (bleAdRef.current) { try { bleAdRef.current.stop(); } catch (_) {} bleAdRef.current = null; }
    setBroadcasting(false);
  };

  const onToggleAttendancePaused = async () => {
    if (!sessionId || !bleData || busy) return;
    setBusy(true);
    setError('');
    const resp = await patchAdminSessionAttendancePaused(sessionId, !bleData.attendancePaused);
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
      ) : bleData ? (
        <>
          <div className="present-pin__center">
            <p className="present-pin__sublabel">Current BLE Payload</p>
            <p className="present-pin__code" aria-live="polite">{bleData.payload}</p>
            <p className="present-pin__timer" aria-live="polite">
              {bleData.attendancePaused ? (
                <span className="present-pin__paused">Student attendance is paused — submissions are blocked.</span>
              ) : (
                <>
                  <span className="present-pin__seconds">{Math.round(bleData.secondsRemaining ?? 0)}</span>
                  <span className="present-pin__unit">seconds until next rotation</span>
                </>
              )}
            </p>
          </div>

          <div className="present-pin__controls">
            {bleError && <p className="present-pin__error">{bleError}</p>}
            {!bleSupported && (
              <p className="present-pin__hint">Web Bluetooth not available. Use Chrome on Android to broadcast.</p>
            )}
            <div className="present-pin__btn-row">
              <button
                type="button"
                className="present-pin__btn present-pin__btn--secondary"
                onClick={onToggleAttendancePaused}
                disabled={busy}
              >
                {bleData.attendancePaused ? '▶ Resume attendance' : '⏸ Pause attendance'}
              </button>
              {broadcasting ? (
                <button type="button" className="present-pin__btn present-pin__btn--danger" onClick={stopBroadcast}>
                  ⏹ Stop Broadcasting
                </button>
              ) : (
                <button
                  type="button"
                  className="present-pin__btn present-pin__btn--primary"
                  onClick={startBroadcast}
                  disabled={!bleSupported || !bleData}
                >
                  📡 Start Broadcasting
                </button>
              )}
            </div>
            {broadcasting && (
              <p className="present-pin__meta broadcasting-active">● Broadcasting BLE payload</p>
            )}
          </div>
        </>
      ) : (
        <div className="present-pin__center">
          <p className="present-pin__loading">Loading…</p>
        </div>
      )}
    </div>
  );
}
