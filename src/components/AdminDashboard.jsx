import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polygon, useMapEvents } from 'react-leaflet';
import {
  getAdminCourses,
  createAdminCourse,
  deleteAdminCourse,
  disableAdminCourse,
  enableAdminCourse,
  createAdminSession,
  getAdminAttendanceMatrix,
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
  const [activeTab, setActiveTab] = useState('services');
  const [courses, setCourses] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');
  const [matrix, setMatrix] = useState(null);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCode, setNewCourseCode] = useState('');
  const [sessionName, setSessionName] = useState('');
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
    if (!selectedCourseId && enabled[0]) setSelectedCourseId(String(enabled[0]._id));
  }, [selectedCourseId, studentId]);

  const loadSessions = useCallback(async () => {
    const resp = await getAdminAllSessions(studentId);
    if (resp.error) {
      setError(resp.error);
      return;
    }
    setSessions(resp.items || []);
  }, [studentId]);

  const loadMatrix = useCallback(async (courseId) => {
    if (!courseId) {
      setMatrix(null);
      return;
    }
    const resp = await getAdminAttendanceMatrix(studentId, courseId);
    if (resp.error) setError(resp.error);
    else setMatrix(resp);
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

  useEffect(() => {
    loadMatrix(selectedCourseId);
  }, [loadMatrix, selectedCourseId]);

  const selectedCourse = courses.find((c) => String(c._id) === String(selectedCourseId));

  const sortedFilteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    return [...sessions]
      .filter((s) => s.course?.active)
      .filter((s) => {
        const label = `${s.course?.code || ''} ${s.startTime || ''} ${s.endTime || ''} ${s.recurring ? 'recurring' : 'one-time'} ${s.name || ''}`.toLowerCase();
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

  const onCreateCourse = async () => {
    setWorking(true);
    setError('');
    setMessage('');
    const resp = await createAdminCourse(studentId, { code: newCourseCode.trim(), name: newCourseName.trim() });
    if (resp.error) setError(resp.error);
    else {
      setMessage('Course added.');
      setNewCourseCode('');
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
    const typed = window.prompt(`Type course code "${targetCourse?.code || ''}" to confirm delete:`);
    if (!typed || typed.trim().toUpperCase() !== String(targetCourse?.code || '').toUpperCase()) {
      setError('Course delete cancelled: course code did not match.');
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
      name: sessionName.trim(),
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
      setSessionName('');
      setLectureDay('MON');
      setStartTime('08:00');
      setEndTime('10:00');
      setRecurring(true);
      setRotationEnabled(false);
      setPolygons([[]]);
      setActivePolygonIndex(0);
      await loadSessions();
      await loadMatrix(selectedCourseId);
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
      await Promise.all([loadSessions(), loadMatrix(selectedCourseId)]);
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

  if (loading) return <div className="app-shell"><div className="auth-card"><div className="card-content">Loading admin dashboard...</div></div></div>;

  return (
    <div className="app-shell">
      <div className="auth-card admin-card admin-pro">
        <div className="card-content">
          <h2 className="card-title">Admin Services</h2>
          {error && <p className="error">{error}</p>}
          {message && <p className="card-subtitle">{message}</p>}

          <div className="admin-tabs">
            <button type="button" className={`tab-btn ${activeTab === 'services' ? 'active' : ''}`} onClick={() => setActiveTab('services')}>Admin Services</button>
            <button type="button" className={`tab-btn ${activeTab === 'create' ? 'active' : ''}`} onClick={() => setActiveTab('create')}>Create Session</button>
            <button type="button" className={`tab-btn ${activeTab === 'sessions' ? 'active' : ''}`} onClick={() => setActiveTab('sessions')}>Sessions</button>
          </div>

          {activeTab === 'services' && (
            <div className="tab-panel">
              <div className="course-add-grid">
                <input className="input" placeholder="Course code" value={newCourseCode} onChange={(e) => setNewCourseCode(e.target.value.toUpperCase())} />
                <input className="input" placeholder="Course name" value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} />
                <button className="primary-btn" type="button" onClick={onCreateCourse} disabled={working}>Add Course</button>
              </div>

              <div className="course-list">
                {courses.map((c) => (
                  <div
                    key={c._id}
                    className={`course-item ${c.active ? 'enabled' : 'disabled'} ${String(selectedCourseId) === String(c._id) ? 'selected' : ''}`}
                    onClick={() => setSelectedCourseId(String(c._id))}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedCourseId(String(c._id)); }}
                  >
                    <div>
                      <p className="course-code">{c.code}</p>
                      <p className="course-name">{c.name}</p>
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

              <h3 className="card-title" style={{ marginTop: 14 }}>Attendance Matrix {selectedCourse ? `- ${selectedCourse.code}` : ''}</h3>
              {matrix && matrix.sessions?.length > 0 ? (
                <div className="matrix-wrap">
                  <table className="matrix-table">
                    <thead>
                      <tr>
                        <th>Student ID</th>
                        {matrix.sessions.map((s) => <th key={s._id}>{s.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.rows.map((row) => (
                        <tr key={`${row.studentId}-${row.email}`}>
                          <td>{row.studentId}</td>
                          {matrix.sessions.map((s) => <td key={`${row.studentId}-${s._id}`}>{row.attendance?.[s._id] ? 'P' : '-'}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="card-subtitle">Select a course to view attendance matrix.</p>}
            </div>
          )}

          {activeTab === 'create' && (
            <div className="tab-panel">
              <label className="field-label" htmlFor="sessionCourseSelect">Course</label>
              <select id="sessionCourseSelect" className="input" value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>
                <option value="">Select course</option>
                {courses.filter((c) => c.active).map((c) => <option key={c._id} value={c._id}>{c.code} - {c.name}</option>)}
              </select>
              <div className="admin-grid">
                <input className="input" placeholder="Session name (optional)" value={sessionName} onChange={(e) => setSessionName(e.target.value)} />
                <select className="input" value={lectureDay} onChange={(e) => setLectureDay(e.target.value)}>
                  {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
              <label className="field-label" htmlFor="recurringSelect">Recurring Session</label>
              <select id="recurringSelect" className="input" value={recurring ? 'yes' : 'no'} onChange={(e) => setRecurring(e.target.value === 'yes')}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
              <label className="field-label" htmlFor="rotationSelect">Enable code rotation?</label>
              <select id="rotationSelect" className="input" value={rotationEnabled ? 'yes' : 'no'} onChange={(e) => setRotationEnabled(e.target.value === 'yes')}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>

              <div className="polygon-tools">
                <label className="field-label">Map Polygons</label>
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
                    <Polygon key={`drawn-poly-${idx}`} positions={poly.map((p) => [p.lat, p.lng])} pathOptions={{ color: idx === activePolygonIndex ? '#7a1414' : '#2563eb' }} />
                  ) : null))}
                </MapContainer>
              </div>
              <button className="primary-btn" type="button" onClick={onCreateSession} disabled={working || !selectedCourseId}>Create Session</button>
            </div>
          )}

          {activeTab === 'sessions' && (
            <div className="tab-panel">
              <input
                className="input"
                placeholder="Search by course, time, session type..."
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
              />
              <div className="session-list">
                {sortedFilteredSessions.map((s) => (
                  <div key={s._id} className={`session-item ${s.active ? 'state-active' : 'state-inactive'} ${s.course?.active ? '' : 'state-course-disabled'} ${runningSessionCodes[String(s._id)] ? 'state-running' : ''}`}>
                    <div>
                      <p className="session-main">{s.course?.code} - {s.lectureDay} {s.startTime}-{s.endTime}</p>
                      <p className="session-sub">{s.recurring ? 'Recurring' : 'Non-recurring'} {s.name ? `| ${s.name}` : ''}</p>
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
                          <p className="session-sub" style={{ color: '#065f46', fontWeight: 700, margin: 0 }}>
                            Live code: {runningSessionCodes[String(s._id)].code}
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
    </div>
  );
}
