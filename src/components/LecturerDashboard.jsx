import { useState, useEffect, useRef } from 'react';
import {
  getCourses, getActiveSessions, startSession, endSession,
  getCurrentBlePayload, getAttendance, exportAttendanceUrl, getSessions,
} from '../api';

const BLE_COMPANY_ID = 0xFFFF;
const POLL_INTERVAL_MS = 10_000;

function isBleAdvertisingSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'bluetooth' in navigator &&
    typeof navigator.bluetooth.advertise === 'function'
  );
}

export default function LecturerDashboard() {
  const [tab, setTab]               = useState('sessions');
  const [courses, setCourses]       = useState([]);
  const [activeSession, setActive]  = useState(null);
  const [bleState, setBleState]     = useState(null);
  const [countdown, setCountdown]   = useState(null);
  const [adHandle, setAdHandle]     = useState(null);
  const [adError, setAdError]       = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [sessionHistory, setHistory]    = useState([]);
  const [attendance, setAttendance]     = useState([]);
  const [selectedSession, setSelected] = useState(null);
  const [loading, setLoading]           = useState(true);

  const pollRef  = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    Promise.all([fetchCourses(), fetchActive()]).finally(() => setLoading(false));
    fetchHistory();
  }, []);

  useEffect(() => {
    if (activeSession) {
      pollPayload(activeSession.id);
      pollRef.current = setInterval(() => pollPayload(activeSession.id), POLL_INTERVAL_MS);
    }
    return () => { clearInterval(pollRef.current); clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id]);

  useEffect(() => {
    clearInterval(timerRef.current);
    if (bleState) {
      setCountdown(bleState.rotatesIn);
      timerRef.current = setInterval(() => setCountdown(c => (c > 0 ? c - 1 : 0)), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [bleState?.rotatedAt]);

  async function fetchCourses() {
    const { courses } = await getCourses();
    setCourses(courses || []);
  }

  async function fetchActive() {
    const { sessions } = await getActiveSessions();
    setActive((sessions || [])[0] || null);
  }

  async function fetchHistory() {
    const { sessions } = await getSessions();
    setHistory(sessions || []);
  }

  async function pollPayload(sessionId) {
    try {
      const data = await getCurrentBlePayload(sessionId);
      setBleState(data);
      if (broadcasting) await updateBroadcast(data.payload);
    } catch (_) {}
  }

  async function handleStart(courseId) {
    await startSession(courseId);
    await fetchActive();
    await fetchHistory();
    setTab('sessions');
    setAdError('');
  }

  async function handleEnd() {
    if (!activeSession) return;
    await stopBroadcast();
    await endSession(activeSession.id);
    setActive(null);
    setBleState(null);
    setCountdown(null);
    await fetchHistory();
  }

  async function startBroadcast() {
    if (!isBleAdvertisingSupported()) {
      setAdError(
        'navigator.bluetooth.advertise() is not available. ' +
        'Enable "Experimental Web Platform features" in chrome://flags on Android Chrome, ' +
        'or use the token below with a dedicated BLE beacon device.'
      );
      return;
    }
    if (!bleState?.payload) return;
    try {
      const handle = await navigator.bluetooth.advertise({
        type: 'manufacturer',
        manufacturerData: [{ companyIdentifier: BLE_COMPANY_ID, data: new TextEncoder().encode(bleState.payload) }],
      });
      setAdHandle(handle);
      setBroadcasting(true);
      setAdError('');
    } catch (err) {
      setAdError(`Broadcast failed: ${err.message}`);
    }
  }

  async function stopBroadcast() {
    if (adHandle) {
      try { await adHandle.stop(); } catch (_) {}
      setAdHandle(null);
    }
    setBroadcasting(false);
  }

  async function updateBroadcast(newPayload) {
    if (!adHandle) return;
    try {
      await adHandle.updateData({
        manufacturerData: [{ companyIdentifier: BLE_COMPANY_ID, data: new TextEncoder().encode(newPayload) }],
      });
    } catch (err) {
      setAdHandle(null);
      setBroadcasting(false);
      setAdError(`Broadcast interrupted: ${err.message}. Please restart.`);
    }
  }

  async function viewAttendance(session) {
    setSelected(session);
    const { records } = await getAttendance(session.id);
    setAttendance(records || []);
    setTab('attendance');
  }

  if (loading) return <div className="page"><p className="text-muted">Loading…</p></div>;

  return (
    <div className="page">
      <div className="tabs">
        {['sessions', 'history', 'attendance'].map(t => (
          <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'sessions' && (
        activeSession ? (
          <ActiveSessionPanel
            session={activeSession}
            bleState={bleState}
            countdown={countdown}
            broadcasting={broadcasting}
            adError={adError}
            onStartBroadcast={startBroadcast}
            onStopBroadcast={stopBroadcast}
            onEnd={handleEnd}
          />
        ) : (
          <div className="card">
            <h2>No active session</h2>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Select a course to start a session and begin broadcasting your beacon.
            </p>
            {courses.length === 0 && <p className="text-muted">No assigned courses. Contact an admin.</p>}
            {courses.map(c => (
              <div key={c.id} className="row" style={{ marginBottom: 8 }}>
                <div><strong>{c.code}</strong> — {c.name}</div>
                <div className="spacer" />
                <button className="btn btn-primary" onClick={() => handleStart(c.id)}>Start Session</button>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'history' && (
        <div className="card">
          <h2>Session History</h2>
          {sessionHistory.length === 0 && <p className="text-muted">No sessions yet.</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Course</th><th>Started</th><th>Ended</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {sessionHistory.map(s => (
                  <tr key={s.id}>
                    <td>{s.course_code} — {s.course_name}</td>
                    <td>{new Date(s.started_at).toLocaleString()}</td>
                    <td>{s.ended_at ? new Date(s.ended_at).toLocaleString() : '—'}</td>
                    <td><span className={`badge ${s.status === 'active' ? 'badge-green' : 'badge-gray'}`}>{s.status}</span></td>
                    <td>
                      <button className="btn btn-secondary" style={{ padding: '5px 12px', fontSize: '.8rem' }}
                        onClick={() => viewAttendance(s)}>Attendance</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'attendance' && (
        <div className="card">
          {selectedSession ? (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Attendance — {selectedSession.course_code}</h2>
                <div className="spacer" />
                <a href={exportAttendanceUrl(selectedSession.id)} download
                  className="btn btn-success" style={{ textDecoration: 'none' }}>
                  Export Excel
                </a>
              </div>
              <p className="text-muted mb-8">
                Session {selectedSession.id} · {new Date(selectedSession.started_at).toLocaleString()}
              </p>
              {attendance.length === 0 && <p className="text-muted">No records yet.</p>}
              <div className="table-wrap">
                <table>
                  <thead><tr><th>#</th><th>Student</th><th>Email</th><th>Recorded At</th></tr></thead>
                  <tbody>
                    {attendance.map((r, i) => (
                      <tr key={r.id}>
                        <td>{i + 1}</td><td>{r.student_name}</td>
                        <td>{r.student_email}</td>
                        <td>{new Date(r.recorded_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-muted">Select a session from History to view attendance.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ActiveSessionPanel({ session, bleState, countdown, broadcasting, adError, onStartBroadcast, onStopBroadcast, onEnd }) {
  const pct = countdown != null ? Math.round((countdown / 10) * 100) : 100;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>{session.course_name}</h2>
          <span className="text-muted">{session.course_code} · Session #{session.id}</span>
        </div>
        <div className="spacer" />
        <span className="badge badge-green">Live</span>
        <button className="btn btn-danger" onClick={onEnd}>End Session</button>
      </div>

      <div style={{ background: '#f8f9ff', borderRadius: 10, padding: '16px 20px', marginBottom: 16 }}>
        <p style={{ fontWeight: 600, fontSize: '.85rem', color: '#6b7280', marginBottom: 4 }}>Current Beacon Token</p>
        <div className="ble-token">{bleState?.payload ?? '——'}</div>
        {countdown != null && (
          <>
            <div className="progress-bar-wrap">
              <div className="progress-bar" style={{ width: `${pct}%` }} />
            </div>
            <div className="ble-countdown">Rotates in {countdown}s</div>
          </>
        )}
      </div>

      <div className="row">
        {!broadcasting
          ? <button className="btn btn-primary" onClick={onStartBroadcast}>📡 Start Broadcasting</button>
          : <button className="btn btn-danger" onClick={onStopBroadcast}>⏹ Stop Broadcasting</button>
        }
        {broadcasting && (
          <span className="badge badge-green" style={{ padding: '8px 14px', fontSize: '.85rem' }}>Broadcasting</span>
        )}
      </div>

      {adError && (
        <div className="status-banner status-error" style={{ marginTop: 12 }}>⚠ {adError}</div>
      )}

      <p className="text-muted" style={{ marginTop: 12, fontSize: '.8rem', lineHeight: 1.5 }}>
        Token rotates every 10 seconds. Students scan passively — no pairing required.
        Broadcasting requires Chrome on Android with Experimental Web Platform features enabled.
      </p>
    </div>
  );
}
