import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Polygon, useMapEvents } from 'react-leaflet';
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
  getAdminCurrentSessionCodes,
  startAdminSessionRotation,
  stopAdminSessionRotation,
} from '../api';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_ORDER = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const MAP_CENTER = [7.2548, 80.5974];

function MapClickCapture({ onAddPoint }) {
  useMapEvents({
    click(e) {
      onAddPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

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

export default function AdminDashboard() {
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
  const [polygons, setPolygons] = useState([[]]);
  const [activePolygonIndex, setActivePolygonIndex] = useState(0);
  const [runningSessionCodes, setRunningSessionCodes] = useState({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');

  const student = useMemo(() => JSON.parse(localStorage.getItem('student') || '{}'), []);
  const studentId = student?.studentId || '';

  const loadCourses = useCallback(async () => {
    const resp = await getAdminCourses(studentId);
    if (resp.error) {
      setError(resp.error);
      return;
    }
    const all = resp.items || [];
    const enabled = all.filter((c) => c.active);
    const disabled = all.filter((c) => !c.active);
    const ordered = [...enabled, ...disabled];
    setCourses(ordered);
    setSelectedCourseId((prev) => (prev ? prev : (enabled[0] ? String(enabled[0]._id) : '')));
  }, [studentId]);

  const loadSessions = useCallback(async () => {
    const resp = await getAdminAllSessions(studentId);
    if (resp.error) {
      setError(resp.error);
      return;
    }
    setSessions(resp.items || []);
  }, [studentId]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setLoading(true);
      await Promise.all([loadCourses(), loadSessions()]);
      if (!cancelled) setLoading(false);
    }
    bootstrap();
    return () => { cancelled = true; };
  }, [loadCourses, loadSessions]);

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

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function refreshRunningCodes() {
      if (activeTab !== 'sessions') return;
      const resp = await getAdminCurrentSessionCodes(studentId);
      if (cancelled) return;
      if (!resp.error) {
        const next = {};
        (resp.items || []).forEach((item) => {
          next[String(item.sessionId)] = item;
        });
        setRunningSessionCodes(next);
      }
      timer = setTimeout(refreshRunningCodes, 1000);
    }
    refreshRunningCodes();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeTab, studentId]);

  useEffect(() => {
    if (!message) return undefined;
    setToast(message);
    const t = setTimeout(() => setToast(''), 4200);
    return () => clearTimeout(t);
  }, [message]);

  const onCreateCourse = async () => {
    setWorking(true);
    setError('');
    setMessage('');
    const batch = newCourseBatch.trim();
    if (!batch) {
      setError('Batch is required.');
      setWorking(false);
      return;
    }
    const resp = await createAdminCourse(studentId, {
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
    const resp = await disableAdminCourse(studentId, courseId);
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
    const resp = await enableAdminCourse(studentId, courseId);
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
    const resp = await deleteAdminCourse(studentId, courseId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Course and related sessions/attendance deleted.');
      if (String(selectedCourseId) === String(courseId)) setSelectedCourseId('');
      await Promise.all([loadCourses(), loadSessions()]);
    }
    setWorking(false);
  };

  const addPoint = (point) => {
    setPolygons((prev) => prev.map((poly, idx) => (idx === activePolygonIndex ? [...poly, point] : poly)));
  };

  const undoPoint = () => {
    setPolygons((prev) => prev.map((poly, idx) => (idx === activePolygonIndex ? poly.slice(0, -1) : poly)));
  };

  const clearCurrentPolygon = () => {
    setPolygons((prev) => prev.map((poly, idx) => (idx === activePolygonIndex ? [] : poly)));
  };

  const addNewPolygon = () => {
    setPolygons((prev) => [...prev, []]);
    setActivePolygonIndex(polygons.length);
  };

  const onCreateSession = async () => {
    if (!selectedCourseId) {
      setError('Select a course first.');
      return;
    }
    const normalizedPolygons = polygons.filter((p) => p.length >= 3);
    if (normalizedPolygons.length === 0) {
      setError('Draw at least one polygon with 3 or more points.');
      return;
    }
    setWorking(true);
    setError('');
    const resp = await createAdminSession(studentId, selectedCourseId, {
      lectureDay,
      startTime,
      endTime,
      recurring,
      rotationEnabled,
      polygons: normalizedPolygons,
    });
    if (resp.error) setError(resp.error);
    else {
      setMessage('Session created.');
      setLectureDay('MON');
      setStartTime('08:00');
      setEndTime('10:00');
      setRecurring(true);
      setRotationEnabled(false);
      setPolygons([[]]);
      setActivePolygonIndex(0);
      await loadSessions();
    }
    setWorking(false);
  };

  const onActivateSession = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await activateAdminSession(studentId, sessionId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Session activated.');
      await loadSessions();
    }
    setWorking(false);
  };

  const onDeactivateSession = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await deactivateAdminSession(studentId, sessionId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Session deactivated.');
      await loadSessions();
    }
    setWorking(false);
  };

  const onDeleteSession = async (sessionId) => {
    const ok = window.confirm('Delete this session? Attendance records will be kept for reports.');
    if (!ok) return;
    setWorking(true);
    setError('');
    const resp = await deleteAdminSession(studentId, sessionId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Session deleted.');
      await loadSessions();
    }
    setWorking(false);
  };

  const onStartRotation = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await startAdminSessionRotation(studentId, sessionId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Code rotation started.');
      await loadSessions();
    }
    setWorking(false);
  };

  const onStopRotation = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await stopAdminSessionRotation(studentId, sessionId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Code rotation paused.');
      await loadSessions();
    }
    setWorking(false);
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
                <h2 className="section-title">Courses &amp; attendance table</h2>
                <p className="section-desc">Add or manage courses. Open a course to view the attendance table (student × sessions) in a dedicated report.</p>
              </header>
              <div className="course-add-stack">
                <div className="course-add-grid">
                  <input className="input" placeholder="Course code" value={newCourseCode} onChange={(e) => setNewCourseCode(e.target.value.toUpperCase())} />
                  <input className="input" placeholder="Batch (required)" value={newCourseBatch} onChange={(e) => setNewCourseBatch(e.target.value)} />
                  <button className="primary-btn" type="button" onClick={onCreateCourse} disabled={working}>Add course</button>
                </div>
                <input className="input" placeholder="Course name" value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} />
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
                        <p className="course-item__hint">Open attendance table</p>
                      </div>
                      <span className="course-item__chevron" aria-hidden>›</span>
                    </div>
                    <div className="course-actions">
                      {c.active ? (
                        <button type="button" className="pill-btn warning" onClick={(e) => { e.stopPropagation(); onDisableCourse(c._id); }}>Disable</button>
                      ) : (
                        <button type="button" className="pill-btn success" onClick={(e) => { e.stopPropagation(); onEnableCourse(c._id); }}>Enable</button>
                      )}
                      <button type="button" className="pill-btn danger" onClick={(e) => { e.stopPropagation(); onDeleteCourse(c._id); }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          )}

          {activeTab === 'create' && (
            <div className="tab-panel">
              <header className="section-head">
                <p className="section-kicker">Scheduling</p>
                <h2 className="section-title">Create lecture session</h2>
                <p className="section-desc">Choose course, weekly slot, recurrence, and draw one or more attendance geofences on the map.</p>
              </header>

              <div className="form-section">
                <p className="form-section__label">Course</p>
                <select id="sessionCourseSelect" className="input" value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>
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
                <label className="field-label" htmlFor="rotationSelect" style={{ marginTop: '0.75rem' }}>Enable code rotation?</label>
                <select id="rotationSelect" className="input" value={rotationEnabled ? 'yes' : 'no'} onChange={(e) => setRotationEnabled(e.target.value === 'yes')}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>

              <div className="form-section">
                <p className="form-section__label">Geofence</p>
                <div className="polygon-tools">
                  <label className="field-label">Map polygons</label>
                  <select className="input" value={activePolygonIndex} onChange={(e) => setActivePolygonIndex(parseInt(e.target.value, 10))}>
                    {polygons.map((_, idx) => <option key={`poly-${idx}`} value={idx}>Polygon {idx + 1}</option>)}
                  </select>
                  <div className="tool-row">
                    <button type="button" className="pill-btn" onClick={addNewPolygon}>New Polygon</button>
                    <button type="button" className="pill-btn warning" onClick={undoPoint}>Undo Point</button>
                    <button type="button" className="pill-btn danger" onClick={clearCurrentPolygon}>Clear Polygon</button>
                  </div>
                </div>
                <div className="map-wrap">
                  <MapContainer center={MAP_CENTER} zoom={16} scrollWheelZoom style={{ height: 320, width: '100%' }}>
                    <TileLayer
                      attribution="&copy; OpenStreetMap contributors"
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapClickCapture onAddPoint={addPoint} />
                    {polygons.map((poly, idx) => (poly.length >= 3 ? (
                      <Polygon key={`drawn-poly-${idx}`} positions={poly.map((p) => [p.lat, p.lng])} pathOptions={{ color: idx === activePolygonIndex ? '#7b61ff' : '#2563eb' }} />
                    ) : null))}
                  </MapContainer>
                </div>
                <button className="primary-btn" type="button" onClick={onCreateSession} disabled={working || !selectedCourseId}>Create session</button>
              </div>
            </div>
          )}

          {activeTab === 'sessions' && (
            <div className="tab-panel">
              <header className="section-head">
                <p className="section-kicker">Operations</p>
                <h2 className="section-title">Session control</h2>
                <p className="section-desc">Search sessions, toggle activation, manage rotation during live lectures, or soft-delete while keeping attendance history.</p>
              </header>
              <input
                className="input"
                placeholder="Search by course, time, or type…"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
              />
              <div className="session-list">
                {sortedFilteredSessions.map((s) => (
                  <div key={s._id} className={`session-item ${s.active ? 'state-active' : 'state-inactive'} ${s.course?.active ? '' : 'state-course-disabled'} ${runningSessionCodes[String(s._id)] ? 'state-running' : ''}`}>
                    <div>
                      <div className="session-item__head">
                        <p className="session-main">{s.course?.code} — {s.lectureDay} {s.startTime}–{s.endTime}</p>
                        {runningSessionCodes[String(s._id)] ? <span className="session-live-badge">Live</span> : null}
                      </div>
                      <p className="session-sub">{s.recurring ? 'Recurring' : 'One-time'}</p>
                      {runningSessionCodes[String(s._id)] && (
                        <div className="live-code-row">
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => (runningSessionCodes[String(s._id)].rotationPaused ? onStartRotation(s._id) : onStopRotation(s._id))}
                            title={runningSessionCodes[String(s._id)].rotationPaused ? 'Start code rotation' : 'Pause code rotation'}
                          >
                            {runningSessionCodes[String(s._id)].rotationPaused ? '⟳' : '⏸'}
                          </button>
                          <p className="session-sub" style={{ color: '#4c1d95', fontWeight: 700, margin: 0 }}>
                            Code: {runningSessionCodes[String(s._id)].code}
                            {runningSessionCodes[String(s._id)].rotationPaused
                              ? ' (Paused)'
                              : ` (${runningSessionCodes[String(s._id)].secondsRemaining}s)`}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="course-actions">
                      {s.active
                        ? <button type="button" className="pill-btn warning" onClick={() => onDeactivateSession(s._id)}>Deactivate</button>
                        : <button type="button" className="pill-btn success" onClick={() => onActivateSession(s._id)}>Activate</button>}
                      <button type="button" className="pill-btn danger" onClick={() => onDeleteSession(s._id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

