import { useState, useEffect, useRef } from 'react';
import {
  startSession, endSession,
  getLecturerBroadcastToken, enableSessionBluetooth, disableSessionBluetooth,
  getAttendance, exportAttendanceUrl, getSessions,
} from '../api';

// Manufacturer company ID — must match LectureEntry.jsx
const BLE_COMPANY_ID = 0xFFFF;
// BLE poll interval — re-fetch token before it rotates (bluetoothCode rotates every 15s)
const POLL_INTERVAL_MS = 8_000;

export default function LecturerDashboard() {
  const [tab, setTab]               = useState('sessions');
  const [activeSession, setActive]  = useState(null);
  const [bleState, setBleState]     = useState(null); // { deviceName, token, rotatesIn }
  const [countdown, setCountdown]   = useState(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [adError, setAdError]       = useState('');
  const [bleEnabled, setBleEnabled] = useState(false);
  const [sessionHistory, setHistory]    = useState([]);
  const [attendance, setAttendance]     = useState([]);
  const [selectedSession, setSelected] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');

  const pollRef  = useRef(null);
  const timerRef = useRef(null);
  const isAdvertising = useRef(false);

  useEffect(() => {
    refreshSessions().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeSession) {
      pollToken(activeSession._id || activeSession.id);
      pollRef.current = setInterval(() => pollToken(activeSession._id || activeSession.id), POLL_INTERVAL_MS);
    }
    return () => { clearInterval(pollRef.current); clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?._id || activeSession?.id]);

  // Countdown timer based on rotatesIn from server
  useEffect(() => {
    clearInterval(timerRef.current);
    if (bleState?.rotatesIn) {
      setCountdown(bleState.rotatesIn);
      timerRef.current = setInterval(() => setCountdown(c => (c > 0 ? c - 1 : 0)), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [bleState?.token]); // reset countdown when token changes

  // Update BLE advertisement when token rotates (while broadcasting)
  // Use isAdvertising.current (ref) not broadcasting (state) to avoid stale closure
  useEffect(() => {
    if (isAdvertising.current && bleState?.token && bleState?.deviceName) {
      updateAdvertisement(bleState.deviceName, bleState.token);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bleState?.token]);

  // Cleanup on unmount
  useEffect(() => () => {
    clearInterval(pollRef.current);
    clearInterval(timerRef.current);
    if (isAdvertising.current) stopBroadcast();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single source of truth: /api/admin/sessions returns the lecturer's sessions
  // (staff-scoped) with `active`, populated `course`, schedule, and BLE fields.
  // The active session (if any) is the one the lecturer can broadcast on.
  async function refreshSessions() {
    const data = await getSessions();
    if (data.error) return;
    const sessions = data.sessions || [];
    setHistory(sessions);
    setActive(sessions.find((s) => s.active) || null);
  }

  async function pollToken(sessionId) {
    if (!sessionId) return;
    const data = await getLecturerBroadcastToken(sessionId);
    if (data.error) return; // session may not have BLE enabled yet
    setBleState(data);
  }

  async function handleStart(sessionId) {
    setError('');
    const res = await startSession(sessionId);
    if (res.error) { setError(res.error); return; }
    await refreshSessions();
    setTab('sessions');
    setAdError('');
  }

  async function handleEnd() {
    if (!activeSession) return;
    await stopBroadcast();
    const sid = activeSession._id || activeSession.id;
    await disableSessionBluetooth(sid);
    await endSession(sid);
    setActive(null);
    setBleState(null);
    setBleEnabled(false);
    setCountdown(null);
    await refreshSessions();
  }

  async function handleEnableBluetooth() {
    const sid = activeSession?._id || activeSession?.id;
    if (!sid) return;
    setAdError('');
    const res = await enableSessionBluetooth(sid);
    if (res.error) { setAdError(res.error); return; }
    setBleEnabled(true);
    // Fetch token immediately
    const data = await getLecturerBroadcastToken(sid);
    if (!data.error) setBleState(data);
    // Start polling
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => pollToken(sid), POLL_INTERVAL_MS);
  }

  async function startBroadcast() {
    if (!bleState?.token || !bleState?.deviceName) {
      setAdError('Enable Bluetooth first to get the broadcast token.');
      return;
    }
    setAdError('');
    if (!navigator.bluetooth?.advertise) {
      setAdError(
        'BLE advertising is not supported in this browser. ' +
        'On Android Chrome, enable "Experimental Web Platform features" at chrome://flags, ' +
        'or use a dedicated BLE beacon device for reliable broadcasting.'
      );
      return;
    }
    try {
      const tokenBytes = new TextEncoder().encode(bleState.token);
      const handle = await navigator.bluetooth.advertise({
        type: 'manufacturer',
        manufacturerData: [{ companyIdentifier: BLE_COMPANY_ID, data: tokenBytes }],
      });
      isAdvertising.current = handle;
      setBroadcasting(true);
    } catch (err) {
      setAdError('Broadcast failed: ' + err.message);
    }
  }

  async function stopBroadcast() {
    if (isAdvertising.current && typeof isAdvertising.current.stop === 'function') {
      try { await isAdvertising.current.stop(); } catch (_) {}
    }
    isAdvertising.current = false;
    setBroadcasting(false);
  }

  async function updateAdvertisement(deviceName, token) {
    if (!isAdvertising.current) return;
    try {
      const tokenBytes = new TextEncoder().encode(token);
      if (typeof isAdvertising.current.updateData === 'function') {
        await isAdvertising.current.updateData({
          manufacturerData: [{ companyIdentifier: BLE_COMPANY_ID, data: tokenBytes }],
        });
      }
    } catch (err) {
      isAdvertising.current = false;
      setBroadcasting(false);
      setAdError('Broadcast interrupted — token rotated. Please restart: ' + err.message);
    }
  }

  async function viewAttendance(session) {
    setSelected(session);
    const { records } = await getAttendance(session._id || session.id);
    setAttendance(records || []);
    setTab('attendance');
  }

  if (loading) return <div className="page"><p className="text-muted">Loading…</p></div>;

  const sid = activeSession?._id || activeSession?.id;

  return (
    <div className="page">
      <h1 className="page-title">Lecturer Dashboard</h1>
      {error && <p className="error-banner">{error}</p>}

      <nav className="tab-nav">
        <button className={"tab-btn" + (tab === 'sessions' ? ' active' : '')} onClick={() => setTab('sessions')}>Sessions</button>
        <button className={"tab-btn" + (tab === 'history' ? ' active' : '')} onClick={() => setTab('history')}>History</button>
        {selectedSession && (
          <button className={"tab-btn" + (tab === 'attendance' ? ' active' : '')} onClick={() => setTab('attendance')}>Attendance</button>
        )}
      </nav>

      {/* ── Active session panel ─────────────────────────────────────────── */}
      {tab === 'sessions' && (
        <div className="panel">
          <h2>Active Session</h2>
          {activeSession ? (
            <div className="session-card active-session">
              <p className="session-label">
                {activeSession.courseCode || activeSession.course?.code} — {activeSession.lectureDay} {activeSession.startTime}–{activeSession.endTime}
              </p>

              {/* BLE Enable */}
              {!bleEnabled && (
                <button className="primary-btn" onClick={handleEnableBluetooth}>
                  📡 Enable Bluetooth Attendance
                </button>
              )}

              {/* BLE token + broadcast controls */}
              {bleState && (
                <div className="ble-panel">
                  <p className="ble-label">Device name: <strong>{bleState.deviceName}</strong></p>
                  <p className="ble-token">Token: <code>{bleState.token}</code></p>
                  <div className="ble-countdown">
                    <div className="countdown-bar" style={{ width: countdown ? (countdown / 15) * 100 + '%' : '100%' }} />
                    <span>{countdown ?? bleState.rotatesIn}s until next token</span>
                  </div>

                  {adError && <p className="error-text">{adError}</p>}

                  {broadcasting ? (
                    <button className="danger-btn" onClick={stopBroadcast}>⏹ Stop Broadcasting</button>
                  ) : (
                    <button className="primary-btn" onClick={startBroadcast}>📡 Start Broadcasting</button>
                  )}
                  {broadcasting && <p className="broadcasting-badge">● Broadcasting</p>}
                </div>
              )}

              <div className="session-actions">
                <button className="secondary-btn" onClick={() => viewAttendance(activeSession)}>View Attendance</button>
                {exportAttendanceUrl && (
                  <a className="secondary-btn" href={exportAttendanceUrl(sid)} download>⬇ Export Excel</a>
                )}
                <button className="danger-btn" onClick={handleEnd}>End Session</button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-muted">No active session. Activate one of your scheduled sessions below.</p>
              <h3>Your Sessions</h3>
              <ul className="session-list">
                {sessionHistory.filter((s) => !s.active).length === 0 ? (
                  <p className="text-muted">No scheduled sessions. An admin must create sessions for your courses.</p>
                ) : (
                  sessionHistory.filter((s) => !s.active).map((s) => (
                    <li key={s._id || s.id} className="session-item">
                      <span>{s.course?.code} — {s.lectureDay} {s.startTime}–{s.endTime}</span>
                      <button className="primary-btn small" onClick={() => handleStart(s._id || s.id)}>Activate</button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Session history ──────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div className="panel">
          <h2>Session History</h2>
          {sessionHistory.length === 0 ? (
            <p className="text-muted">No sessions yet.</p>
          ) : (
            <ul className="session-list">
              {sessionHistory.map(s => (
                <li key={s._id || s.id} className="session-item">
                  <span>{s.courseCode || s.course?.code} — {s.lectureDay} {s.startTime}–{s.endTime}</span>
                  <button className="secondary-btn small" onClick={() => viewAttendance(s)}>View Attendance</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Attendance view ──────────────────────────────────────────────── */}
      {tab === 'attendance' && selectedSession && (
        <div className="panel">
          <h2>Attendance — {selectedSession.courseCode || selectedSession.course?.code}</h2>
          {exportAttendanceUrl && (
            <a className="secondary-btn" href={exportAttendanceUrl(selectedSession._id || selectedSession.id)} download>⬇ Export Excel</a>
          )}
          {attendance.length === 0 ? (
            <p className="text-muted">No attendance records yet.</p>
          ) : (
            <table className="attendance-table">
              <thead><tr><th>Student ID</th><th>Email</th><th>Time</th></tr></thead>
              <tbody>
                {attendance.map(r => (
                  <tr key={r._id}>
                    <td>{r.student?.studentId || '—'}</td>
                    <td>{r.student?.email || '—'}</td>
                    <td>{r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
