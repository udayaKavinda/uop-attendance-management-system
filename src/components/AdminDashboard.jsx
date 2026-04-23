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
  patchCourseAssignLecturer,
  getAdminLecturers,
  createAdminLecturer,
  deleteAdminLecturer,
  getPolygonPresets,
  createPolygonPreset,
  deletePolygonPreset,
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
  const [lecturers, setLecturers] = useState([]);
  const [lecturerSearch, setLecturerSearch] = useState('');
  const [newLecturerName, setNewLecturerName] = useState('');
  const [newLecturerEmail, setNewLecturerEmail] = useState('');
  const [newLecturerPhone, setNewLecturerPhone] = useState('');
  const [newCourseLecturerId, setNewCourseLecturerId] = useState('');
  const [polygonPresets, setPolygonPresets] = useState([]);
  const [presetPickerId, setPresetPickerId] = useState('');
  const [presetTabName, setPresetTabName] = useState('');
  const [presetDrawPolygons, setPresetDrawPolygons] = useState([[]]);
  const [presetDrawActiveIdx, setPresetDrawActiveIdx] = useState(0);

  const student = useMemo(() => JSON.parse(localStorage.getItem('student') || '{}'), []);
  const studentId = student?.studentId || '';
  const isAdmin = student?.role === 'admin';

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

  const loadLecturers = useCallback(async () => {
    if (!isAdmin) return;
    const resp = await getAdminLecturers(studentId, lecturerSearch.trim());
    if (resp.error) {
      setError(resp.error);
      return;
    }
    setLecturers(resp.items || []);
  }, [studentId, lecturerSearch, isAdmin]);

  const loadPolygonPresets = useCallback(async () => {
    const resp = await getPolygonPresets(studentId);
    if (resp.error) {
      setError(resp.error);
      return;
    }
    setPolygonPresets(resp.items || []);
  }, [studentId]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setLoading(true);
      const tasks = [loadCourses(), loadSessions(), loadPolygonPresets()];
      if (isAdmin) tasks.push(loadLecturers());
      await Promise.all(tasks);
      if (!cancelled) setLoading(false);
    }
    bootstrap();
    return () => { cancelled = true; };
  }, [loadCourses, loadSessions, loadPolygonPresets, loadLecturers, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => { loadLecturers(); }, 300);
    return () => clearTimeout(t);
  }, [lecturerSearch, isAdmin, loadLecturers]);

  useEffect(() => {
    if (!isAdmin || lecturers.length === 0) return;
    setNewCourseLecturerId((prev) => (prev ? prev : String(lecturers[0]._id)));
  }, [isAdmin, lecturers]);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'lecturers') loadLecturers();
    if (activeTab === 'presets') loadPolygonPresets();
  }, [activeTab, isAdmin, loadLecturers, loadPolygonPresets]);

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
    const payload = {
      code: newCourseCode.trim(),
      batch,
      name: newCourseName.trim(),
    };
    if (isAdmin) {
      if (!newCourseLecturerId) {
        setError('Select a lecturer for this course.');
        setWorking(false);
        return;
      }
      payload.lecturerId = newCourseLecturerId;
    }
    const resp = await createAdminCourse(studentId, payload);
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
    setPolygons((prev) => {
      const next = [...prev, []];
      setActivePolygonIndex(next.length - 1);
      return next;
    });
  };

  /** Discard every ring (e.g. after merging a preset you do not want) and draw from scratch on the map. */
  const resetAllPolygons = () => {
    setPolygons([[]]);
    setActivePolygonIndex(0);
    setError('');
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

  const onAssignLecturer = async (courseId, lecturerId) => {
    setWorking(true);
    setError('');
    const resp = await patchCourseAssignLecturer(studentId, courseId, lecturerId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Course owner updated.');
      await loadCourses();
    }
    setWorking(false);
  };

  const mergePresetPolygons = () => {
    const preset = polygonPresets.find((p) => String(p._id) === presetPickerId);
    if (!preset || !Array.isArray(preset.polygons) || preset.polygons.length === 0) {
      setError('Choose a preset that includes at least one polygon.');
      return;
    }
    setError('');
    const rings = preset.polygons.map((poly) => poly.map((pt) => ({ lat: Number(pt.lat), lng: Number(pt.lng) }))
      .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng)));
    const validRings = rings.filter((r) => r.length >= 3);
    if (validRings.length === 0) {
      setError('That preset has no valid polygons.');
      return;
    }
    setPolygons((prev) => {
      const kept = prev.filter((p) => p.length > 0);
      const next = [...kept, ...validRings];
      const idx = Math.max(0, next.length - 1);
      setActivePolygonIndex(idx);
      return next.length ? next : [[]];
    });
  };

  const onCreateLecturer = async () => {
    setWorking(true);
    setError('');
    setMessage('');
    const resp = await createAdminLecturer(studentId, {
      name: newLecturerName.trim(),
      email: newLecturerEmail.trim(),
      phone: newLecturerPhone.trim(),
    });
    if (resp.error) setError(resp.error);
    else {
      setMessage('Lecturer created.');
      setNewLecturerName('');
      setNewLecturerEmail('');
      setNewLecturerPhone('');
      await loadLecturers();
    }
    setWorking(false);
  };

  const onDeleteLecturer = async (lecturerId) => {
    const ok = window.confirm('Remove this lecturer? Their Google account will sign in as a student until re-added.');
    if (!ok) return;
    setWorking(true);
    setError('');
    const resp = await deleteAdminLecturer(studentId, lecturerId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Lecturer removed.');
      await loadLecturers();
      await loadCourses();
    }
    setWorking(false);
  };

  const onDeletePreset = async (presetId) => {
    const ok = window.confirm('Delete this polygon preset?');
    if (!ok) return;
    setWorking(true);
    setError('');
    const resp = await deletePolygonPreset(studentId, presetId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Preset deleted.');
      await loadPolygonPresets();
    }
    setWorking(false);
  };

  const presetDrawAddPoint = (point) => {
    setPresetDrawPolygons((prev) => prev.map((poly, idx) => (idx === presetDrawActiveIdx ? [...poly, point] : poly)));
  };

  const presetDrawUndo = () => {
    setPresetDrawPolygons((prev) => prev.map((poly, idx) => (idx === presetDrawActiveIdx ? poly.slice(0, -1) : poly)));
  };

  const presetDrawClearRing = () => {
    setPresetDrawPolygons((prev) => prev.map((poly, idx) => (idx === presetDrawActiveIdx ? [] : poly)));
  };

  const presetDrawNewRing = () => {
    setPresetDrawPolygons((prev) => {
      const next = [...prev, []];
      setPresetDrawActiveIdx(next.length - 1);
      return next;
    });
  };

  const presetDrawResetAll = () => {
    setPresetDrawPolygons([[]]);
    setPresetDrawActiveIdx(0);
    setError('');
  };

  const onSavePresetFromTab = async () => {
    const name = presetTabName.trim();
    if (!name) {
      setError('Enter a preset name.');
      return;
    }
    const rings = presetDrawPolygons.filter((p) => p.length >= 3);
    if (rings.length === 0) {
      setError('Draw at least one polygon with 3 or more points.');
      return;
    }
    setWorking(true);
    setError('');
    const resp = await createPolygonPreset(studentId, { name, polygons: rings });
    if (resp.error) setError(resp.error);
    else {
      setMessage('Preset created.');
      setPresetTabName('');
      setPresetDrawPolygons([[]]);
      setPresetDrawActiveIdx(0);
      await loadPolygonPresets();
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
              {isAdmin ? (
                <>
                  <button type="button" className={`tab-btn ${activeTab === 'lecturers' ? 'active' : ''}`} onClick={() => setActiveTab('lecturers')}>Lecturers</button>
                  <button type="button" className={`tab-btn ${activeTab === 'presets' ? 'active' : ''}`} onClick={() => setActiveTab('presets')}>Presets</button>
                </>
              ) : null}
            </div>
          </div>

          {activeTab === 'services' && (
            <div className="tab-panel">
              <header className="section-head">
                <p className="section-kicker">Catalog</p>
                <h2 className="section-title">Courses &amp; attendance table</h2>
                <p className="section-desc">Add or manage courses. Open a course to view the attendance table in a dedicated report.</p>
              </header>
              <div className="course-add-stack">
                <div className="course-add-grid">
                  <input className="input" placeholder="Course code" value={newCourseCode} onChange={(e) => setNewCourseCode(e.target.value.toUpperCase())} />
                  <input className="input" placeholder="Batch (required)" value={newCourseBatch} onChange={(e) => setNewCourseBatch(e.target.value)} />
                  <button className="primary-btn" type="button" onClick={onCreateCourse} disabled={working}>Add course</button>
                </div>
                <input className="input" placeholder="Course name" value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} />
                {isAdmin ? (
                  <div className="form-section" style={{ marginTop: '0.5rem' }}>
                    <label className="field-label" htmlFor="newCourseLecturer">Lecturer (owner)</label>
                    <select id="newCourseLecturer" className="input" value={newCourseLecturerId} onChange={(e) => setNewCourseLecturerId(e.target.value)}>
                      <option value="">Select lecturer</option>
                      {lecturers.map((lec) => (
                        <option key={lec._id} value={lec._id}>{lec.name} ({lec.email})</option>
                      ))}
                    </select>
                  </div>
                ) : null}
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
                        <p className="course-item__hint">
                          {c.lecturer?.name ? `Owner: ${c.lecturer.name}` : ''}
                        </p>
                      </div>
                      <span className="course-item__chevron" aria-hidden>›</span>
                    </div>
                    <div className="course-actions">
                      {isAdmin ? (
                        <select
                          className="input"
                          style={{ maxWidth: 180 }}
                          value={String(c.lecturer?._id || '')}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => { e.stopPropagation(); onAssignLecturer(c._id, e.target.value); }}
                          aria-label="Assign course owner"
                        >
                          {lecturers.map((lec) => (
                            <option key={lec._id} value={lec._id}>{lec.name}</option>
                          ))}
                        </select>
                      ) : null}
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
                <p className="section-desc">
                  You can create a session by choosing a course, selecting the weekly time slot and recurrence, then creating geofences by clicking on the map or using preset geofences for labs and lecture halls.
                </p>
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
                <label className="field-label" htmlFor="rotationSelect" style={{ marginTop: '0.75rem' }}>Enable pin rotation</label>
                <select id="rotationSelect" className="input" value={rotationEnabled ? 'yes' : 'no'} onChange={(e) => setRotationEnabled(e.target.value === 'yes')}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>

              <div className="form-section">
                <p className="form-section__label">Geofence</p>
                <p className="section-desc" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                  Click the map to place corners for the selected polygon. You do not have to use a preset—draw your own area whenever you like.
                </p>
                {polygonPresets.length > 0 ? (
                  <div className="polygon-tools" style={{ marginBottom: '0.75rem' }}>
                    <label className="field-label" htmlFor="presetPick">Optional polygon preset</label>
                    <p className="section-desc" style={{ marginTop: '0.25rem', marginBottom: '0.5rem', fontSize: '0.9em' }}>
                      Merge a saved outline as a starting point, or ignore this and draw only on the map.
                    </p>
                    <div className="tool-row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                      <select id="presetPick" className="input" style={{ flex: '1 1 200px' }} value={presetPickerId} onChange={(e) => setPresetPickerId(e.target.value)}>
                        <option value="">Select preset…</option>
                        {polygonPresets.map((pr) => (
                          <option key={pr._id} value={pr._id}>{pr.name}</option>
                        ))}
                      </select>
                      <button type="button" className="pill-btn" onClick={mergePresetPolygons}>Merge preset into map</button>
                    </div>
                  </div>
                ) : null}
                <div className="polygon-tools">
                  <label className="field-label">Draw on map (manual polygons)</label>
                  <select className="input" value={activePolygonIndex} onChange={(e) => setActivePolygonIndex(parseInt(e.target.value, 10))}>
                    {polygons.map((_, idx) => <option key={`poly-${idx}`} value={idx}>Polygon {idx + 1}</option>)}
                  </select>
                  <div className="tool-row">
                    <button type="button" className="pill-btn" onClick={addNewPolygon}>New Polygon</button>
                    <button type="button" className="pill-btn warning" onClick={undoPoint}>Undo Point</button>
                    <button type="button" className="pill-btn danger" onClick={clearCurrentPolygon}>Clear Polygon</button>
                    <button type="button" className="pill-btn" onClick={resetAllPolygons} title="Remove every ring and start drawing from scratch">Reset all polygons</button>
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
                <p className="section-desc">Search sessions, toggle activation, manage pin rotation during live lectures, or soft-delete while keeping attendance history.</p>
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

          {activeTab === 'lecturers' && isAdmin && (
            <div className="tab-panel">
              <header className="section-head">
                <p className="section-kicker">Directory</p>
                <h2 className="section-title">Lecturers</h2>
                <p className="section-desc">
                  Add people who may run courses and sessions. Use the same email as their Google sign-in.
                  Removing a lecturer turns that account back into a student until you add them again.
                </p>
              </header>
              <div className="form-section">
                <label className="field-label" htmlFor="lecturerSearch">Search</label>
                <input
                  id="lecturerSearch"
                  className="input"
                  placeholder="Name, email, or telephone…"
                  value={lecturerSearch}
                  onChange={(e) => setLecturerSearch(e.target.value)}
                />
              </div>
              <div className="course-add-stack" style={{ marginTop: '1rem' }}>
                <p className="form-section__label">Add lecturer</p>
                <div className="course-add-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                  <input className="input" placeholder="Full name" value={newLecturerName} onChange={(e) => setNewLecturerName(e.target.value)} />
                  <input className="input" placeholder="Email" type="email" autoComplete="off" value={newLecturerEmail} onChange={(e) => setNewLecturerEmail(e.target.value)} />
                  <input className="input" placeholder="Telephone" value={newLecturerPhone} onChange={(e) => setNewLecturerPhone(e.target.value)} />
                  <button className="primary-btn" type="button" onClick={onCreateLecturer} disabled={working}>Add lecturer</button>
                </div>
              </div>
              <div className="course-list" style={{ marginTop: '1.25rem' }}>
                {lecturers.length === 0 ? (
                  <p className="section-desc" style={{ margin: 0 }}>No lecturers match this search.</p>
                ) : (
                  lecturers.map((lec) => (
                    <div key={lec._id} className="course-item enabled">
                      <div className="course-item__left">
                        <div className="course-item__meta">
                          <p className="course-code">{lec.name}</p>
                          <p className="course-name">{lec.email}</p>
                          <p className="course-item__hint">{lec.phone || 'No telephone on file'}</p>
                        </div>
                      </div>
                      <div className="course-actions">
                        <button type="button" className="pill-btn danger" onClick={() => onDeleteLecturer(lec._id)} disabled={working}>Remove</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'presets' && isAdmin && (
            <div className="tab-panel">
              <header className="section-head">
                <p className="section-kicker">Campus maps</p>
                <h2 className="section-title">Polygon presets</h2>
                <p className="section-desc">
                  Save reusable geofences (for example a lab outline). Lecturers can merge these when creating a session or draw their own polygons instead.
                </p>
              </header>

              <div className="form-section">
                <p className="form-section__label">Existing presets</p>
                <button type="button" className="pill-btn" onClick={() => loadPolygonPresets()} disabled={working}>Refresh list</button>
                <div className="course-list" style={{ marginTop: '0.75rem' }}>
                  {polygonPresets.length === 0 ? (
                    <p className="section-desc" style={{ margin: 0 }}>No presets yet. Create one below.</p>
                  ) : (
                    polygonPresets.map((pr) => (
                      <div key={pr._id} className="course-item enabled">
                        <div className="course-item__left">
                          <div className="course-item__meta">
                            <p className="course-code">{pr.name}</p>
                            <p className="course-name">{(pr.polygons || []).length} polygon ring(s)</p>
                          </div>
                        </div>
                        <div className="course-actions">
                          <button type="button" className="pill-btn danger" onClick={() => onDeletePreset(pr._id)} disabled={working}>Delete</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="form-section">
                <p className="form-section__label">New preset</p>
                <input className="input" placeholder="Preset name (e.g. Lab 1)" value={presetTabName} onChange={(e) => setPresetTabName(e.target.value)} style={{ maxWidth: 420, marginBottom: '0.75rem' }} />
                <div className="polygon-tools">
                  <label className="field-label">Draw on map</label>
                  <select className="input" value={presetDrawActiveIdx} onChange={(e) => setPresetDrawActiveIdx(parseInt(e.target.value, 10))}>
                    {presetDrawPolygons.map((_, idx) => <option key={`preset-poly-${idx}`} value={idx}>Polygon {idx + 1}</option>)}
                  </select>
                  <div className="tool-row">
                    <button type="button" className="pill-btn" onClick={presetDrawNewRing}>New polygon</button>
                    <button type="button" className="pill-btn warning" onClick={presetDrawUndo}>Undo point</button>
                    <button type="button" className="pill-btn danger" onClick={presetDrawClearRing}>Clear polygon</button>
                    <button type="button" className="pill-btn" onClick={presetDrawResetAll}>Reset all</button>
                  </div>
                </div>
                <div className="map-wrap">
                  <MapContainer center={MAP_CENTER} zoom={16} scrollWheelZoom style={{ height: 320, width: '100%' }}>
                    <TileLayer
                      attribution="&copy; OpenStreetMap contributors"
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapClickCapture onAddPoint={presetDrawAddPoint} />
                    {presetDrawPolygons.map((poly, idx) => (poly.length >= 3 ? (
                      <Polygon key={`preset-draw-${idx}`} positions={poly.map((p) => [p.lat, p.lng])} pathOptions={{ color: idx === presetDrawActiveIdx ? '#7b61ff' : '#2563eb' }} />
                    ) : null))}
                  </MapContainer>
                </div>
                <button className="primary-btn" type="button" onClick={onSavePresetFromTab} disabled={working}>Save preset</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

