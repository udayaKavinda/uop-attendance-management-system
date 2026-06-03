import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import {
  getAdminCourses,
  createAdminCourse,
  deleteAdminCourse,
  disableAdminCourse,
  enableAdminCourse,
  createAdminSession,
  getAdminAllSessions,
  activateAdminSession,
  deactivateAdminSession,
  deleteAdminSession,
  startSessionBluetooth,
  stopSessionBluetooth,
  getLecturerBroadcastToken,
} from '../api';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_ORDER = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const BLE_COMPANY_ID = 0xFFFF;
const BLE_POLL_INTERVAL_MS = 8_000;
const IS_NATIVE = Capacitor.isNativePlatform();

function sessionDistanceMinutes(session) {
  const now = new Date();
  const targetDay = DAY_ORDER[session.lectureDay] ?? 1;
  const [hh, mm] = String(session.startTime || '').split(':').map((x) => parseInt(x, 10));
  const target = new Date(now);
  target.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0);
  const dayDiff = (targetDay - now.getDay() + 7) % 7;
  target.setDate(target.getDate() + dayDiff);
  return Math.abs((target.getTime() - now.getTime()) / 60000);
}

export default function LecturerDashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('services');
  const [courses, setCourses] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCode, setNewCourseCode] = useState('');
  const [newCourseBatch, setNewCourseBatch] = useState('');
  const [lectureDay, setLectureDay] = useState('MON');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('10:00');
  const [recurring, setRecurring] = useState(true);
  const [rotationEnabled, setRotationEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');

  // BLE broadcasting state (keyed by sessionId string)
  const [bleStates, setBleStates] = useState({});
  const [bleCountdowns, setBleCountdowns] = useState({});
  const [bleBroadcasting, setBleBroadcasting] = useState({});
  const [bleAdErrors, setBleAdErrors] = useState({});
  const pollRefsMap = useRef({});
  // Native: stores true when advertising; web: stores the advertise handle object
  const adHandlesMap = useRef({});

  const loadCourses = useCallback(async () => {
    const resp = await getAdminCourses();
    if (resp.error) { setError(resp.error); return; }
    const all = resp.items || [];
    const enabled = all.filter((c) => c.active);
    const disabled = all.filter((c) => !c.active);
    setCourses([...enabled, ...disabled]);
    setSelectedCourseId((prev) => (prev ? prev : (enabled[0] ? String(enabled[0]._id) : '')));
  }, []);

  const loadSessions = useCallback(async () => {
    const resp = await getAdminAllSessions();
    if (resp.error) { setError(resp.error); return; }
    setSessions(resp.items || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setLoading(true);
      try {
        await Promise.all([loadCourses(), loadSessions()]);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => { cancelled = true; };
  }, [loadCourses, loadSessions]);

  useEffect(() => {
    if (!message) return undefined;
    setToast(message);
    const t = setTimeout(() => setToast(''), 4200);
    return () => clearTimeout(t);
  }, [message]);

  const sortedFilteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    return [...sessions]
      .filter((s) => s.course?.active)
      .filter((s) => {
        const label = `${s.course?.code || ''} ${s.startTime || ''} ${s.endTime || ''} ${s.recurring ? 'recurring' : 'one-time'}`.toLowerCase();
        return !q || label.includes(q);
      })
      .sort((a, b) => sessionDistanceMinutes(a) - sessionDistanceMinutes(b));
  }, [sessionSearch, sessions]);

  const onCreateCourse = async () => {
    setWorking(true);
    setError('');
    setMessage('');
    const batch = newCourseBatch.trim();
    if (!batch) { setError('Batch is required.'); setWorking(false); return; }
    const resp = await createAdminCourse({
      code: newCourseCode.trim(),
      batch,
      name: newCourseName.trim(),
    });
    if (resp.error) setError(resp.error);
    else {
      setMessage('Course added.');
      setNewCourseCode('');
      setNewCourseBatch('');
      setNewCourseName('');
      await loadCourses();
    }
    setWorking(false);
  };

  const onDisableCourse = async (courseId) => {
    setWorking(true);
    setError('');
    const resp = await disableAdminCourse(courseId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Course disabled.');
      await Promise.all([loadCourses(), loadSessions()]);
    }
    setWorking(false);
  };

  const onEnableCourse = async (courseId) => {
    setWorking(true);
    setError('');
    const resp = await enableAdminCourse(courseId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Course enabled.');
      await Promise.all([loadCourses(), loadSessions()]);
    }
    setWorking(false);
  };

  const onDeleteCourse = async (courseId) => {
    const targetCourse = courses.find((c) => String(c._id) === String(courseId));
    const expect = `${targetCourse?.code || ''} ${targetCourse?.batch ?? ''}`.trim();
    const typed = window.prompt(`Type code and batch separated by a space to confirm delete (e.g. "${expect}"):`);
    if (!typed || typed.trim().toUpperCase() !== expect.toUpperCase()) {
      setError('Course delete cancelled: code and batch did not match.');
      return;
    }
    setWorking(true);
    setError('');
    const resp = await deleteAdminCourse(courseId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Course and related sessions/attendance deleted.');
      if (String(selectedCourseId) === String(courseId)) setSelectedCourseId('');
      await Promise.all([loadCourses(), loadSessions()]);
    }
    setWorking(false);
  };

  const onCreateSession = async () => {
    if (!selectedCourseId) { setError('Select a course first.'); return; }
    setWorking(true);
    setError('');
    const resp = await createAdminSession(selectedCourseId, {
      lectureDay, startTime, endTime, recurring, rotationEnabled,
    });
    if (resp.error) setError(resp.error);
    else {
      setMessage('Session created.');
      setLectureDay('MON');
      setStartTime('08:00');
      setEndTime('10:00');
      setRecurring(true);
      setRotationEnabled(false);
      await loadSessions();
    }
    setWorking(false);
  };

  const onActivateSession = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await activateAdminSession(sessionId);
    if (resp.error) setError(resp.error);
    else { setMessage('Session activated.'); await loadSessions(); }
    setWorking(false);
  };

  const onDeactivateSession = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await deactivateAdminSession(sessionId);
    if (resp.error) setError(resp.error);
    else { setMessage('Session deactivated.'); await loadSessions(); }
    setWorking(false);
  };

  const onDeleteSession = async (sessionId) => {
    const ok = window.confirm('Delete this session? Attendance records will be kept for reports.');
    if (!ok) return;
    setWorking(true);
    setError('');
    const resp = await deleteAdminSession(sessionId);
    if (resp.error) setError(resp.error);
    else { setMessage('Session deleted.'); await loadSessions(); }
    setWorking(false);
  };

  const onStartBluetooth = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await startSessionBluetooth(sessionId);
    if (resp.error) setError(resp.error);
    else { setToast('Bluetooth attendance started.'); await loadSessions(); }
    setWorking(false);
  };

  const onStopBluetooth = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await stopSessionBluetooth(sessionId);
    if (resp.error) setError(resp.error);
    else { setToast('Bluetooth attendance stopped.'); await loadSessions(); }
    setWorking(false);
  };

  const pollBleToken = useCallback(async (sessionId) => {
    const sid = String(sessionId);
    const data = await getLecturerBroadcastToken(sid);
    if (data.error) return;
    setBleStates((prev) => ({ ...prev, [sid]: data }));
    if (data.rotatesIn != null) {
      setBleCountdowns((prev) => ({ ...prev, [sid]: data.rotatesIn }));
    }
    const handle = adHandlesMap.current[sid];
    if (handle && data.token) {
      try {
        const tokenBytes = new TextEncoder().encode(data.token);
        if (IS_NATIVE) {
          // Restart native advertising with updated token
          await BleClient.stopAdvertising();
          await BleClient.startAdvertising({
            name: data.deviceName,
            manufacturerData: { [BLE_COMPANY_ID]: tokenBytes },
          });
        } else if (typeof handle.updateData === 'function') {
          await handle.updateData({ manufacturerData: [{ companyIdentifier: BLE_COMPANY_ID, data: tokenBytes }] });
        }
      } catch (err) {
        adHandlesMap.current[sid] = null;
        setBleBroadcasting((prev) => ({ ...prev, [sid]: false }));
        setBleAdErrors((prev) => ({ ...prev, [sid]: 'Broadcast interrupted — token rotated: ' + err.message }));
      }
    }
  }, []);

  useEffect(() => {
    const activeBleSessions = sessions.filter((s) => s.bluetoothEnabled && s.active);
    const activeIds = new Set(activeBleSessions.map((s) => String(s._id)));

    activeBleSessions.forEach((s) => {
      const sid = String(s._id);
      if (!pollRefsMap.current[sid]) {
        pollBleToken(sid);
        pollRefsMap.current[sid] = setInterval(() => pollBleToken(sid), BLE_POLL_INTERVAL_MS);
      }
    });

    Object.keys(pollRefsMap.current).forEach((sid) => {
      if (!activeIds.has(sid)) {
        clearInterval(pollRefsMap.current[sid]);
        delete pollRefsMap.current[sid];
        const handle = adHandlesMap.current[sid];
        if (IS_NATIVE && handle) {
          BleClient.stopAdvertising().catch(() => {});
        } else if (handle && typeof handle.stop === 'function') {
          handle.stop().catch(() => {});
        }
        adHandlesMap.current[sid] = null;
        setBleBroadcasting((prev) => { const n = { ...prev }; delete n[sid]; return n; });
        setBleStates((prev) => { const n = { ...prev }; delete n[sid]; return n; });
        setBleCountdowns((prev) => { const n = { ...prev }; delete n[sid]; return n; });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  useEffect(() => {
    const t = setInterval(() => {
      setBleCountdowns((prev) => {
        const keys = Object.keys(prev);
        if (keys.length === 0) return prev;
        const next = { ...prev };
        let changed = false;
        keys.forEach((sid) => { if (next[sid] > 0) { next[sid] -= 1; changed = true; } });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => {
    Object.values(pollRefsMap.current).forEach(clearInterval);
    const handles = Object.values(adHandlesMap.current).filter(Boolean);
    if (IS_NATIVE && handles.length > 0) {
      BleClient.stopAdvertising().catch(() => {});
    } else {
      handles.forEach((h) => { if (h?.stop) h.stop().catch(() => {}); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartBroadcast = async (sessionId) => {
    const sid = String(sessionId);
    const state = bleStates[sid];
    if (!state?.token || !state?.deviceName) {
      setBleAdErrors((prev) => ({ ...prev, [sid]: 'Enable Bluetooth first to get the broadcast token.' }));
      return;
    }
    setBleAdErrors((prev) => ({ ...prev, [sid]: '' }));
    try {
      const tokenBytes = new TextEncoder().encode(state.token);
      if (IS_NATIVE) {
        await BleClient.initialize();
        await BleClient.startAdvertising({
          name: state.deviceName,
          manufacturerData: { [BLE_COMPANY_ID]: tokenBytes },
        });
        adHandlesMap.current[sid] = true;
      } else {
        if (!navigator.bluetooth?.advertise) {
          setBleAdErrors((prev) => ({
            ...prev,
            [sid]: 'BLE advertising requires the native Android app. In browser, enable "Experimental Web Platform features" at chrome://flags on Android Chrome.',
          }));
          return;
        }
        const handle = await navigator.bluetooth.advertise({
          type: 'manufacturer',
          manufacturerData: [{ companyIdentifier: BLE_COMPANY_ID, data: tokenBytes }],
        });
        adHandlesMap.current[sid] = handle;
      }
      setBleBroadcasting((prev) => ({ ...prev, [sid]: true }));
    } catch (err) {
      setBleAdErrors((prev) => ({ ...prev, [sid]: 'Broadcast failed: ' + err.message }));
    }
  };

  const handleStopBroadcast = async (sessionId) => {
    const sid = String(sessionId);
    const handle = adHandlesMap.current[sid];
    try {
      if (IS_NATIVE) {
        await BleClient.stopAdvertising();
      } else if (handle && typeof handle.stop === 'function') {
        await handle.stop();
      }
    } catch (_) {}
    adHandlesMap.current[sid] = null;
    setBleBroadcasting((prev) => ({ ...prev, [sid]: false }));
  };

  if (loading) {
    return (
      <div className="admin-surface page-fade">
        <div className="admin-surface__inner" style={{ padding: '2.25rem', textAlign: 'center' }}>
          <p className="section-desc" style={{ margin: 0 }}>Loading dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {toast ? <div className="admin-flash" role="status">{toast}</div> : null}
      <div className="admin-surface page-fade">
        <div className="admin-surface__inner">
          {error ? <p className="error">{error}</p> : null}

          <div className="admin-tabs-wrap">
            <div className="admin-tabs">
              <button type="button" className={`tab-btn ${activeTab === 'services' ? 'active' : ''}`} onClick={() => setActiveTab('services')}>Courses</button>
              <button type="button" className={`tab-btn ${activeTab === 'create' ? 'active' : ''}`} onClick={() => setActiveTab('create')}>Create session</button>
              <button type="button" className={`tab-btn ${activeTab === 'sessions' ? 'active' : ''}`} onClick={() => setActiveTab('sessions')}>Sessions</button>
            </div>
          </div>

          {activeTab === 'services' && (
            <div className="tab-panel">
              <header className="section-head">
                <p className="section-kicker">Catalog</p>
                <h2 className="section-title">Your courses</h2>
                <p className="section-desc">Add or manage your courses. Open a course to view the attendance table.</p>
              </header>
              <div className="course-add-stack">
                <div className="course-add-grid">
                  <input className="input" placeholder="Course code" value={newCourseCode} onChange={(e) => setNewCourseCode(e.target.value.toUpperCase())} />
                  <input className="input" placeholder="Batch (required)" value={newCourseBatch} onChange={(e) => setNewCourseBatch(e.target.value)} />
                  <input className="input" placeholder="Course name" value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} />
                  <button className="primary-btn" type="button" onClick={onCreateCourse} disabled={working}>Add course</button>
                </div>
              </div>

              <div className="course-list">
                {courses.map((c) => (
                  <div
                    key={c._id}
                    className={`course-item ${c.active ? 'enabled' : 'disabled'}`}
                    onClick={() => navigate(`/admin/courses/${c._id}/matrix`)}
                    role="button"
                    tabIndex={0}
                    title="Open attendance table"
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/admin/courses/${c._id}/matrix`); }}
                  >
                    <div className="course-item__left">
                      <div className="course-item__meta">
                        <p className="course-code">{c.code}{c.batch ? ` · ${c.batch}` : ''}</p>
                        <p className="course-name">{c.name}</p>
                      </div>
                      <span className="course-item__chevron" aria-hidden>›</span>
                    </div>
                    <div className="course-actions">
                      {c.active ? (
                        <button type="button" className="pill-btn warning" onClick={(e) => { e.stopPropagation(); onDisableCourse(c._id); }} disabled={working}>Disable</button>
                      ) : (
                        <button type="button" className="pill-btn success" onClick={(e) => { e.stopPropagation(); onEnableCourse(c._id); }} disabled={working}>Enable</button>
                      )}
                      <button type="button" className="pill-btn danger" onClick={(e) => { e.stopPropagation(); onDeleteCourse(c._id); }} disabled={working}>Delete</button>
                    </div>
                  </div>
                ))}
                {courses.length === 0 ? (
                  <p className="section-desc" style={{ marginTop: '0.75rem' }}>No courses yet. Add one above.</p>
                ) : null}
              </div>
            </div>
          )}

          {activeTab === 'create' && (
            <div className="tab-panel">
              <header className="section-head">
                <p className="section-kicker">Scheduling</p>
                <h2 className="section-title">Create lecture session</h2>
                <p className="section-desc">Choose a course, set the weekly time slot and recurrence, then create the session.</p>
              </header>

              <div className="form-section">
                <p className="form-section__label">Course</p>
                <select className="input" value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>
                  <option value="">Select course</option>
                  {courses.filter((c) => c.active).map((c) => (
                    <option key={c._id} value={c._id}>{c.code}{c.batch ? ` (${c.batch})` : ''} — {c.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-section">
                <p className="form-section__label">Time window</p>
                <div className="admin-grid admin-grid--schedule">
                  <div>
                    <label className="field-label" htmlFor="daySelect">Day</label>
                    <select id="daySelect" className="input" value={lectureDay} onChange={(e) => setLectureDay(e.target.value)}>
                      {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="startTime">Start</label>
                    <input id="startTime" className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="endTime">End</label>
                    <input id="endTime" className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <p className="form-section__label">Options</p>
                <label className="field-label" htmlFor="recurringSelect">Recurring session</label>
                <select id="recurringSelect" className="input" value={recurring ? 'yes' : 'no'} onChange={(e) => setRecurring(e.target.value === 'yes')}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
                <label className="field-label" htmlFor="rotationSelect" style={{ marginTop: '0.75rem' }}>Enable pin rotation</label>
                <select id="rotationSelect" className="input" value={rotationEnabled ? 'yes' : 'no'} onChange={(e) => setRotationEnabled(e.target.value === 'yes')}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>

              <div className="form-section">
                <button className="primary-btn" type="button" onClick={onCreateSession} disabled={working || !selectedCourseId}>Create session</button>
              </div>
            </div>
          )}

          {activeTab === 'sessions' && (
            <div className="tab-panel">
              <header className="section-head">
                <p className="section-kicker">Operations</p>
                <h2 className="section-title">Session control</h2>
                <p className="section-desc">Activate sessions to allow attendance. Enable Bluetooth to broadcast the BLE token for proximity attendance.</p>
              </header>
              <input
                className="input"
                placeholder="Search by course, time, or type…"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
              />
              <div className="session-list">
                {sortedFilteredSessions.map((s) => (
                  <div key={s._id} className={`session-item ${s.active ? 'state-active' : 'state-inactive'}`}>
                    <div>
                      <p className="session-main">{s.course?.code} — {s.lectureDay} {s.startTime}–{s.endTime}</p>
                      <p className="session-sub">{s.recurring ? 'Recurring' : 'One-time'}</p>
                    </div>
                    <div className="bt-row">
                      {s.bluetoothEnabled ? (
                        <button type="button" className="pill-btn warning" disabled={working} onClick={() => onStopBluetooth(s._id)}>BT off</button>
                      ) : (
                        <button type="button" className="pill-btn" disabled={working} onClick={() => onStartBluetooth(s._id)} title="Enable Bluetooth attendance for this session">📡 BT on</button>
                      )}
                    </div>
                    {s.bluetoothEnabled && bleStates[String(s._id)] && (() => {
                      const sid = String(s._id);
                      const bs = bleStates[sid];
                      const cd = bleCountdowns[sid];
                      return (
                        <div className="ble-panel">
                          <p className="ble-label">Device: <strong>{bs.deviceName}</strong></p>
                          <p className="ble-token">Token: <code>{bs.token}</code></p>
                          <div className="ble-countdown">
                            <div className="countdown-bar" style={{ width: ((cd ?? bs.rotatesIn) / 15) * 100 + '%' }} />
                            <span>{cd ?? bs.rotatesIn}s until next token</span>
                          </div>
                          {bleAdErrors[sid] && <p className="error-text">{bleAdErrors[sid]}</p>}
                          {bleBroadcasting[sid] ? (
                            <>
                              <p className="broadcasting-badge">● Broadcasting</p>
                              <button type="button" className="danger-btn" onClick={() => handleStopBroadcast(sid)}>⏹ Stop Broadcasting</button>
                            </>
                          ) : (
                            <button type="button" className="primary-btn" onClick={() => handleStartBroadcast(sid)}>📡 Start Broadcasting</button>
                          )}
                        </div>
                      );
                    })()}
                    <div className="course-actions">
                      {s.active
                        ? <button type="button" className="pill-btn warning" disabled={working} onClick={() => onDeactivateSession(s._id)}>Deactivate</button>
                        : <button type="button" className="pill-btn success" disabled={working} onClick={() => onActivateSession(s._id)}>Activate</button>}
                      <button type="button" className="pill-btn danger" disabled={working} onClick={() => onDeleteSession(s._id)}>Delete</button>
                    </div>
                  </div>
                ))}
                {sortedFilteredSessions.length === 0 ? (
                  <p className="section-desc" style={{ marginTop: '0.75rem' }}>
                    {sessions.length === 0 ? 'No sessions yet. Create one in the "Create session" tab.' : 'No sessions match your search.'}
                  </p>
                ) : null}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
