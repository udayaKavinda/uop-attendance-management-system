import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Polygon, useMapEvents, LayersControl } from 'react-leaflet';
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
  patchAdminSessionAttendancePaused,
  patchCourseAssignLecturer,
  getAdminLecturers,
  createAdminLecturer,
  deleteAdminLecturer,
  getPolygonPresets,
  createPolygonPreset,
  deletePolygonPreset,
} from '../api';
import { readStoredStudent } from '../utils/safeStorage';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_ORDER = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const MAP_CENTER = [7.2548, 80.5974];
const OWNER_ALL_LABEL = 'All lecturers — show every course';
const OWNER_LISTBOX_ID = 'admin-catalog-owner-listbox';
const MAX_COURSE_LECTURERS = 5;
const ASSIGN_OWNER_SEARCH_LIMIT = 8;

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Esri World Imagery — use per Esri terms of service for your deployment. */
const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION = 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

function BasemapLayerControl() {
  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer checked name="Street map">
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Satellite">
        <TileLayer attribution={SATELLITE_ATTRIBUTION} url={SATELLITE_TILE_URL} />
      </LayersControl.BaseLayer>
    </LayersControl>
  );
}

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
  const [selectedPresetIds, setSelectedPresetIds] = useState([]);
  const [runningSessionCodes, setRunningSessionCodes] = useState({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');
  const [lecturers, setLecturers] = useState([]);
  /** Full lecturer list for catalog owner picker & per-course assign (not filtered by Lecturers-tab search). */
  const [lecturerDirectory, setLecturerDirectory] = useState([]);
  const [lecturerSearch, setLecturerSearch] = useState('');
  const [newLecturerName, setNewLecturerName] = useState('');
  const [newLecturerEmail, setNewLecturerEmail] = useState('');
  const [newLecturerPhone, setNewLecturerPhone] = useState('');
  const [newCourseLecturerId, setNewCourseLecturerId] = useState('');
  const [assignOwnerCourseId, setAssignOwnerCourseId] = useState('');
  const [assignOwnerQuery, setAssignOwnerQuery] = useState('');
  const [ownerLecturerQuery, setOwnerLecturerQuery] = useState(OWNER_ALL_LABEL);
  const [ownerLecturerMenuOpen, setOwnerLecturerMenuOpen] = useState(false);
  const [ownerLecturerHighlight, setOwnerLecturerHighlight] = useState(-1);
  const ownerLecturerBlurTimer = useRef(null);
  const ownerLecturerComboboxRef = useRef(null);
  const [polygonPresets, setPolygonPresets] = useState([]);
  const [presetTabName, setPresetTabName] = useState('');
  const [presetDrawPolygons, setPresetDrawPolygons] = useState([[]]);
  const [presetDrawActiveIdx, setPresetDrawActiveIdx] = useState(0);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [presetPickerLoading, setPresetPickerLoading] = useState(false);
  const [presetPickerError, setPresetPickerError] = useState('');
  const presetDropdownRef = useRef(null);

  const student = useMemo(() => readStoredStudent(), []);
  const isAdmin = student?.role === 'admin';

  const loadCourses = useCallback(async () => {
    const resp = await getAdminCourses();
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
  }, []);

  const loadSessions = useCallback(async () => {
    const resp = await getAdminAllSessions();
    if (resp.error) {
      setError(resp.error);
      return;
    }
    setSessions(resp.items || []);
  }, []);

  const loadLecturerDirectory = useCallback(async () => {
    if (!isAdmin) return;
    const resp = await getAdminLecturers('');
    if (resp.error) {
      setError(resp.error);
      return;
    }
    setLecturerDirectory(resp.items || []);
  }, [isAdmin]);

  const loadLecturers = useCallback(async () => {
    if (!isAdmin) return;
    const resp = await getAdminLecturers(lecturerSearch.trim());
    if (resp.error) {
      setError(resp.error);
      return;
    }
    setLecturers(resp.items || []);
  }, [lecturerSearch, isAdmin]);

  const loadPolygonPresets = useCallback(async () => {
    const resp = await getPolygonPresets();
    if (resp.error) {
      setError(resp.error);
      return;
    }
    setPolygonPresets(resp.items || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setLoading(true);
      try {
        const tasks = [loadCourses(), loadSessions(), loadPolygonPresets()];
        if (isAdmin) {
          tasks.push(loadLecturers());
          tasks.push(loadLecturerDirectory());
        }
        await Promise.all(tasks);
      } catch (err) {
        if (!cancelled) {
          setError((prev) => prev || err?.message || 'Could not load the dashboard. Check your connection.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => { cancelled = true; };
  }, [loadCourses, loadSessions, loadPolygonPresets, loadLecturers, loadLecturerDirectory, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => { loadLecturers(); }, 300);
    return () => clearTimeout(t);
  }, [lecturerSearch, isAdmin, loadLecturers]);

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

  /** Admin: catalog + session wizard list only courses owned by the selected lecturer. Empty selection = all courses. Lecturers already receive a server-filtered list. */
  const coursesFilteredByOwner = useMemo(() => {
    if (!isAdmin || !newCourseLecturerId) return courses;
    return courses.filter((c) => (c.lecturers || []).some((lec) => String(lec?._id || lec) === String(newCourseLecturerId)));
  }, [courses, isAdmin, newCourseLecturerId]);

  const ownerPickerRows = useMemo(() => {
    const q = ownerLecturerQuery.trim().toLowerCase();
    const lecFiltered = lecturerDirectory.filter((lec) =>
      !q || `${lec.name || ''} ${lec.email || ''}`.toLowerCase().includes(q),
    );
    return [
      { type: 'all', key: '__all', label: OWNER_ALL_LABEL },
      ...lecFiltered.map((lec) => ({ type: 'lec', key: String(lec._id), ...lec })),
    ];
  }, [ownerLecturerQuery, lecturerDirectory]);

  const clearOwnerLecturerBlur = useCallback(() => {
    if (ownerLecturerBlurTimer.current) {
      clearTimeout(ownerLecturerBlurTimer.current);
      ownerLecturerBlurTimer.current = null;
    }
  }, []);

  const openOwnerLecturerMenu = useCallback(() => {
    clearOwnerLecturerBlur();
    setOwnerLecturerMenuOpen(true);
  }, [clearOwnerLecturerBlur]);

  const scheduleCloseOwnerLecturerMenu = useCallback(() => {
    clearOwnerLecturerBlur();
    ownerLecturerBlurTimer.current = setTimeout(() => {
      setOwnerLecturerMenuOpen(false);
      setOwnerLecturerHighlight(-1);
    }, 200);
  }, [clearOwnerLecturerBlur]);

  const pickOwnerLecturerRow = useCallback((row) => {
    if (row.type === 'all') {
      setNewCourseLecturerId('');
      setOwnerLecturerQuery(OWNER_ALL_LABEL);
    } else {
      setNewCourseLecturerId(String(row._id));
      setOwnerLecturerQuery(`${row.email}`);
    }
    setOwnerLecturerMenuOpen(false);
    setOwnerLecturerHighlight(-1);
    clearOwnerLecturerBlur();
  }, [clearOwnerLecturerBlur]);

  useEffect(() => {
    if (!ownerLecturerMenuOpen) return;
    setOwnerLecturerHighlight((i) => {
      const max = ownerPickerRows.length - 1;
      if (max < 0) return -1;
      if (i < 0) return 0;
      return Math.min(i, max);
    });
  }, [ownerLecturerMenuOpen, ownerPickerRows.length]);

  useEffect(() => () => clearOwnerLecturerBlur(), [clearOwnerLecturerBlur]);

  const handleOwnerLecturerKeyDown = (e) => {
    if (!isAdmin) return;
    if (!ownerLecturerMenuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      openOwnerLecturerMenu();
      setOwnerLecturerHighlight(0);
      return;
    }
    if (!ownerLecturerMenuOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOwnerLecturerMenuOpen(false);
      setOwnerLecturerHighlight(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOwnerLecturerHighlight((i) => {
        const next = i < 0 ? 0 : i + 1;
        return next >= ownerPickerRows.length ? Math.max(0, ownerPickerRows.length - 1) : next;
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOwnerLecturerHighlight((i) => {
        const next = i <= 0 ? 0 : i - 1;
        return next;
      });
      return;
    }
    if (e.key === 'Enter' && ownerLecturerHighlight >= 0 && ownerPickerRows[ownerLecturerHighlight]) {
      e.preventDefault();
      pickOwnerLecturerRow(ownerPickerRows[ownerLecturerHighlight]);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    const pool = newCourseLecturerId
      ? courses.filter((c) => (c.lecturers || []).some((lec) => String(lec?._id || lec) === String(newCourseLecturerId)))
      : courses;
    setSelectedCourseId((prev) => {
      if (prev && pool.some((c) => String(c._id) === prev && c.active)) return prev;
      const firstActive = pool.find((c) => c.active);
      return firstActive ? String(firstActive._id) : '';
    });
  }, [isAdmin, newCourseLecturerId, courses]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function refreshRunningCodes() {
      if (activeTab !== 'sessions') return;
      try {
        const resp = await getAdminCurrentSessionCodes();
        if (cancelled) return;
        if (!resp.error) {
          const next = {};
          (resp.items || []).forEach((item) => {
            next[String(item.sessionId)] = item;
          });
          setRunningSessionCodes(next);
        }
      } catch (err) {
        if (!cancelled) {
          // Temporary network/tunnel issues should not crash the whole admin screen.
          setError((prev) => (prev ? prev : 'Live pin updates are temporarily unavailable. Retrying...'));
        }
      } finally {
        if (!cancelled) timer = setTimeout(refreshRunningCodes, 1000);
      }
    }
    refreshRunningCodes();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeTab]);

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
      payload.lecturerIds = [newCourseLecturerId];
    }
    const resp = await createAdminCourse(payload);
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

  const openProjectorView = (sessionRecord) => {
    const id = String(sessionRecord._id);
    const label = `${sessionRecord.course?.code || 'Course'} · ${sessionRecord.lectureDay || ''} ${sessionRecord.startTime || ''}–${sessionRecord.endTime || ''}`;
    const path = `/admin/present/session/${id}?${new URLSearchParams({ label }).toString()}`;
    window.open(`${window.location.origin}${path}`, '_blank', 'noopener,noreferrer');
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

  const selectedPresetPolygons = useMemo(() => {
    if (!Array.isArray(selectedPresetIds) || selectedPresetIds.length === 0) return [];
    const selected = polygonPresets.filter((p) => selectedPresetIds.includes(String(p._id)));
    return selected
      .flatMap((preset) => (preset.polygons || []))
      .map((poly) => poly
        .map((pt) => ({ lat: Number(pt.lat), lng: Number(pt.lng) }))
        .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng)))
      .filter((poly) => poly.length >= 3);
  }, [polygonPresets, selectedPresetIds]);

  const togglePresetSelection = (presetId) => {
    const id = String(presetId);
    setSelectedPresetIds((prev) => (prev.includes(id)
      ? prev.filter((x) => x !== id)
      : [...prev, id]));
  };

  useEffect(() => {
    if (!presetMenuOpen) return undefined;
    function handlePointerDown(event) {
      const el = presetDropdownRef.current;
      if (el && !el.contains(event.target)) {
        setPresetMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [presetMenuOpen]);

  const onTogglePresetMenu = async () => {
    const nextOpen = !presetMenuOpen;
    setPresetMenuOpen(nextOpen);
    if (nextOpen) {
      setPresetPickerError('');
      setPresetPickerLoading(true);
      try {
        const resp = await getPolygonPresets();
        if (resp.error) {
          setPresetPickerError(String(resp.error));
        } else {
          setPolygonPresets(resp.items || []);
        }
      } catch (err) {
        setPresetPickerError(err?.message || 'Failed to load presets');
      } finally {
        setPresetPickerLoading(false);
      }
    } else {
      setPresetPickerError('');
    }
  };

  const onCreateSession = async () => {
    if (!selectedCourseId) {
      setError('Select a course first.');
      return;
    }
    if (selectedPresetIds.length === 0) {
      setError('Select at least one polygon preset.');
      return;
    }
    if (selectedPresetPolygons.length === 0) {
      setError('Selected preset(s) do not contain valid polygons.');
      return;
    }
    setWorking(true);
    setError('');
    const resp = await createAdminSession(selectedCourseId, {
      lectureDay,
      startTime,
      endTime,
      recurring,
      rotationEnabled,
      polygons: selectedPresetPolygons,
    });
    if (resp.error) setError(resp.error);
    else {
      setMessage('Session created.');
      setLectureDay('MON');
      setStartTime('08:00');
      setEndTime('10:00');
      setRecurring(true);
      setRotationEnabled(false);
      setSelectedPresetIds([]);
      await loadSessions();
    }
    setWorking(false);
  };

  const onActivateSession = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await activateAdminSession(sessionId);
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
    const resp = await deactivateAdminSession(sessionId);
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
    const resp = await deleteAdminSession(sessionId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Session deleted.');
      await loadSessions();
    }
    setWorking(false);
  };

  const onToggleAttendancePaused = async (sessionId) => {
    const sid = String(sessionId);
    const rc = runningSessionCodes[sid];
    const nextPaused = !rc?.attendancePaused;
    setWorking(true);
    setError('');
    const resp = await patchAdminSessionAttendancePaused(sessionId, nextPaused);
    if (resp.error) setError(resp.error);
    else {
      setMessage(nextPaused ? 'Student attendance paused for this session.' : 'Student attendance resumed.');
      setRunningSessionCodes((prev) => (
        prev[sid] ? { ...prev, [sid]: { ...prev[sid], attendancePaused: nextPaused } } : prev
      ));
      await loadSessions();
    }
    setWorking(false);
  };

  const onStartRotation = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await startAdminSessionRotation(sessionId);
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
    const resp = await stopAdminSessionRotation(sessionId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Code rotation paused.');
      await loadSessions();
    }
    setWorking(false);
  };

  const onAssignLecturer = async (courseId, lecturerIds) => {
    setWorking(true);
    setError('');
    const resp = await patchCourseAssignLecturer(courseId, lecturerIds);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Course owners updated.');
      await loadCourses();
    }
    setWorking(false);
  };

  const onCreateLecturer = async () => {
    setWorking(true);
    setError('');
    setMessage('');
    const resp = await createAdminLecturer({
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
      await loadLecturerDirectory();
    }
    setWorking(false);
  };

  const onDeleteLecturer = async (lecturerId) => {
    const ok = window.confirm('Remove this lecturer? Their Google account will sign in as a student until re-added.');
    if (!ok) return;
    setWorking(true);
    setError('');
    const resp = await deleteAdminLecturer(lecturerId);
    if (resp.error) setError(resp.error);
    else {
      setMessage('Lecturer removed.');
      await loadLecturers();
      await loadLecturerDirectory();
      await loadCourses();
    }
    setWorking(false);
  };

  const onDeletePreset = async (presetId) => {
    const ok = window.confirm('Delete this polygon preset?');
    if (!ok) return;
    setWorking(true);
    setError('');
    const resp = await deletePolygonPreset(presetId);
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
    const resp = await createPolygonPreset({ name, polygons: rings });
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

  const assignOwnerRows = useMemo(() => {
    const q = assignOwnerQuery.trim().toLowerCase();
    return lecturerDirectory
      .filter((lec) => !q || `${lec.email || ''} ${lec.name || ''}`.toLowerCase().includes(q))
      .slice(0, ASSIGN_OWNER_SEARCH_LIMIT);
  }, [assignOwnerQuery, lecturerDirectory]);

  const assignableLecturerIdSet = useMemo(
    () => new Set(lecturerDirectory.map((lec) => String(lec._id))),
    [lecturerDirectory],
  );

  const onToggleCourseLecturer = async (course, lecturerId) => {
    // Drop stale owner IDs (e.g. deleted lecturers) before sending updates.
    const selected = (course.lecturers || [])
      .map((lec) => String(lec?._id || lec))
      .filter((id) => assignableLecturerIdSet.has(id));
    const targetId = String(lecturerId);
    const alreadySelected = selected.includes(targetId);
    let next;
    if (alreadySelected) {
      next = selected.filter((id) => id !== targetId);
      if (next.length === 0) {
        setError('At least one lecturer must be assigned to a course.');
        return;
      }
    } else {
      if (selected.length >= MAX_COURSE_LECTURERS) {
        setError(`You can assign up to ${MAX_COURSE_LECTURERS} lecturers per course.`);
        return;
      }
      next = [...selected, targetId];
    }
    await onAssignLecturer(course._id, next);
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
                {isAdmin ? (
                  <div className="form-section" style={{ marginBottom: '0.65rem' }}>
                    <label className="field-label" htmlFor="catalogOwnerSearch">Lecturer (owner)</label>
                    <div className="course-combobox" ref={ownerLecturerComboboxRef}>
                      <input
                        id="catalogOwnerSearch"
                        className="input"
                        type="text"
                        autoComplete="off"
                        placeholder="Search name or email, or show all courses"
                        value={ownerLecturerQuery}
                        role="combobox"
                        aria-expanded={ownerLecturerMenuOpen}
                        aria-controls={OWNER_LISTBOX_ID}
                        aria-autocomplete="list"
                        onChange={(e) => {
                          const v = e.target.value;
                          setOwnerLecturerQuery(v);
                          openOwnerLecturerMenu();
                          if (newCourseLecturerId) {
                            const lec = lecturerDirectory.find((l) => String(l._id) === String(newCourseLecturerId));
                            const canonical = lec ? `${lec.email}` : '';
                            if (!canonical || v !== canonical) setNewCourseLecturerId('');
                          }
                        }}
                        onFocus={() => {
                          clearOwnerLecturerBlur();
                          openOwnerLecturerMenu();
                        }}
                        onBlur={scheduleCloseOwnerLecturerMenu}
                        onKeyDown={handleOwnerLecturerKeyDown}
                      />
                      {ownerLecturerMenuOpen && ownerPickerRows.length > 0 ? (
                        <ul id={OWNER_LISTBOX_ID} className="course-combobox__menu" role="listbox">
                          {ownerPickerRows.map((row, idx) => (
                            <li key={row.key} role="presentation">
                              <button
                                type="button"
                                role="option"
                                className="course-combobox__option"
                                aria-selected={idx === ownerLecturerHighlight}
                                onMouseDown={(ev) => {
                                  ev.preventDefault();
                                  pickOwnerLecturerRow(row);
                                }}
                                onMouseEnter={() => setOwnerLecturerHighlight(idx)}
                              >
                                {row.type === 'all' ? (
                                  <span className="course-combobox__code">All lecturers</span>
                                ) : (
                                  <>
                                    <span className="course-combobox__code">{row.email}</span>
                                    <span className="course-combobox__name">{row.name}</span>
                                  </>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <p className="section-desc" style={{ marginTop: '0.35rem', marginBottom: 0, fontSize: '0.88rem' }}>
                      Filter the catalog and Create session list by owner. Choose All lecturers for every course.
                    </p>
                  </div>
                ) : null}
                <div className="course-add-grid">
                  <input className="input" placeholder="Course code" value={newCourseCode} onChange={(e) => setNewCourseCode(e.target.value.toUpperCase())} />
                  <input className="input" placeholder="Batch (required)" value={newCourseBatch} onChange={(e) => setNewCourseBatch(e.target.value)} />
                  <input className="input" placeholder="Course name" value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} />
                  <button className="primary-btn" type="button" onClick={onCreateCourse} disabled={working}>Add course</button>
                </div>
              </div>

              <div className="course-list">
                {coursesFilteredByOwner.map((c) => (
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
                          {Array.isArray(c.lecturers) && c.lecturers.length > 0
                            ? `Owners: ${c.lecturers.map((lec) => lec?.email).filter(Boolean).join(', ')}`
                            : ''}
                        </p>
                      </div>
                      <span className="course-item__chevron" aria-hidden>›</span>
                    </div>
                    <div className="course-actions">
                      {isAdmin ? (
                        <div className="course-owner-picker" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="pill-btn"
                            onClick={() => {
                              if (assignOwnerCourseId === String(c._id)) {
                                setAssignOwnerCourseId('');
                                setAssignOwnerQuery('');
                              } else {
                                setAssignOwnerCourseId(String(c._id));
                                setAssignOwnerQuery('');
                              }
                            }}
                          >
                            Owners ({(c.lecturers || []).length}/{MAX_COURSE_LECTURERS})
                          </button>
                          {assignOwnerCourseId === String(c._id) ? (
                            <div className="course-owner-picker__panel">
                              <input
                                className="input"
                                placeholder="Search lecturer email..."
                                value={assignOwnerQuery}
                                onChange={(e) => setAssignOwnerQuery(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div className="course-owner-picker__list">
                                {assignOwnerRows.map((lec) => {
                                  const selectedIds = new Set((c.lecturers || []).map((x) => String(x?._id || x)));
                                  const selected = selectedIds.has(String(lec._id));
                                  return (
                                    <button
                                      key={lec._id}
                                      type="button"
                                      className={`course-owner-picker__option ${selected ? 'is-selected' : ''}`}
                                      onClick={() => onToggleCourseLecturer(c, lec._id)}
                                      disabled={working}
                                    >
                                      <span className="course-owner-picker__option-main">{lec.email}</span>
                                      <span className="course-owner-picker__option-sub">{lec.name || 'Lecturer'}</span>
                                      <span className="course-owner-picker__option-icon" aria-hidden>{selected ? '✓' : '+'}</span>
                                    </button>
                                  );
                                })}
                                {assignOwnerRows.length === 0 ? (
                                  <p className="course-owner-picker__empty">No lecturers match this search.</p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
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
                {coursesFilteredByOwner.length === 0 ? (
                  <p className="section-desc" style={{ marginTop: '0.75rem' }}>
                    {courses.length === 0
                      ? 'No courses yet. Add one above.'
                      : isAdmin && newCourseLecturerId
                        ? 'No courses assigned to this lecturer. Choose another owner or select "All lecturers".'
                        : 'No courses to show.'}
                  </p>
                ) : null}
              </div>

            </div>
          )}

          {activeTab === 'create' && (
            <div className="tab-panel">
              <header className="section-head">
                <p className="section-kicker">Scheduling</p>
                <h2 className="section-title">Create lecture session</h2>
                <p className="section-desc">
                  You can create a session by choosing a course, selecting the weekly time slot and recurrence, then selecting one or more preset geofences for labs and lecture halls.
                </p>
              </header>

              <div className="form-section">
                <p className="form-section__label">Course</p>
                <select id="sessionCourseSelect" className="input" value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>
                  <option value="">Select course</option>
                  {coursesFilteredByOwner.filter((c) => c.active).map((c) => (
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
                  Select one or more polygon presets. Selected preset polygons are shown automatically on the map.
                </p>
                <div className="polygon-tools preset-dropdown-anchor" style={{ marginBottom: '0.75rem' }}>
                  <label className="field-label" htmlFor="presetPickerBtn">Polygon presets</label>
                  <p className="section-desc" style={{ marginTop: '0.25rem', marginBottom: '0.5rem', fontSize: '0.9em' }}>
                    Open the dropdown and click the + icon to add a preset to the map.
                  </p>
                  <div className="preset-dropdown-host" ref={presetDropdownRef}>
                    <div className="tool-row" style={{ marginBottom: 6 }}>
                      <button
                        id="presetPickerBtn"
                        type="button"
                        className="input"
                        style={{ flex: '1 1 auto', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                        onClick={onTogglePresetMenu}
                      >
                        <span>{selectedPresetIds.length > 0 ? `${selectedPresetIds.length} preset(s) selected` : 'Choose preset(s)…'}</span>
                        <span aria-hidden>{presetMenuOpen ? '▲' : '▼'}</span>
                      </button>
                    </div>
                    {presetMenuOpen ? (
                      <div
                        className="preset-dropdown-panel"
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 6px)',
                          left: 0,
                          right: 0,
                          maxWidth: 520,
                          background: '#fff',
                          border: '1px solid #dbe3f0',
                          borderRadius: 10,
                          boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
                          maxHeight: 260,
                          overflowY: 'auto',
                          padding: 6,
                        }}
                      >
                        {presetPickerLoading ? (
                          <p style={{ margin: 0, padding: 10, color: '#64748b' }}>Loading presets…</p>
                        ) : null}
                        {!presetPickerLoading && presetPickerError ? (
                          <p style={{ margin: 0, padding: 10, color: '#b91c1c', fontSize: 13, lineHeight: 1.45 }}>
                            <strong>Could not load presets</strong>
                            <br />
                            {presetPickerError}
                            <br />
                            <span style={{ color: '#64748b' }}>If you use a tunnel, try again when the connection is stable. The admin Presets tab uses the same API.</span>
                          </p>
                        ) : null}
                        {!presetPickerLoading && !presetPickerError && polygonPresets.length === 0 ? (
                          <p style={{ margin: 0, padding: 10, color: '#64748b' }}>No polygon presets in the system yet. Ask an admin to add them under the Presets tab.</p>
                        ) : null}
                        {!presetPickerLoading && !presetPickerError && polygonPresets.length > 0 ? polygonPresets.map((pr) => {
                          const isSelected = selectedPresetIds.includes(String(pr._id));
                          return (
                            <div
                              key={pr._id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                                padding: '8px 10px',
                                borderRadius: 8,
                                marginBottom: 4,
                                background: isSelected ? '#dcfce7' : '#f8fafc',
                                border: isSelected ? '1px solid #22c55e' : '1px solid transparent',
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <p style={{ margin: 0, fontWeight: 700, color: isSelected ? '#166534' : '#0f172a' }}>{pr.name}</p>
                              </div>
                              <button
                                type="button"
                                className="pill-btn"
                                title={isSelected ? 'Remove from map' : 'Add to map'}
                                onClick={() => togglePresetSelection(pr._id)}
                                style={{
                                  minWidth: 36,
                                  padding: '0.35rem 0.5rem',
                                  background: isSelected ? '#16a34a' : '#2563eb',
                                  color: '#fff',
                                }}
                              >
                                {isSelected ? '✓' : '+'}
                              </button>
                            </div>
                          );
                        }) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="map-wrap map-wrap--below-preset-dropdown">
                  <MapContainer center={MAP_CENTER} zoom={16} scrollWheelZoom style={{ height: 320, width: '100%' }}>
                    <BasemapLayerControl />
                    {selectedPresetPolygons.map((poly, idx) => (poly.length >= 3 ? (
                      <Polygon key={`selected-preset-poly-${idx}`} positions={poly.map((p) => [p.lat, p.lng])} pathOptions={{ color: idx % 2 === 0 ? '#2563eb' : '#7b61ff' }} />
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
                <p className="section-desc">Search sessions, toggle activation, or click the blinking Live badge to pause or resume student attendance. Use ↻ beside the code for PIN rotation. Deactivate or soft-delete as needed.</p>
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
                        {runningSessionCodes[String(s._id)] ? (() => {
                          const rc = runningSessionCodes[String(s._id)];
                          return (
                            <button
                              type="button"
                              className={`session-live-badge ${rc.attendancePaused ? 'session-live-badge--attendance-paused' : 'session-live-badge--blink'}`}
                              disabled={working}
                              onClick={() => onToggleAttendancePaused(s._id)}
                              title={rc.attendancePaused ? 'Click to resume student attendance' : 'Click to pause student attendance'}
                            >
                              {rc.attendancePaused ? 'Paused' : 'Live'}
                            </button>
                          );
                        })() : null}
                      </div>
                      <p className="session-sub">{s.recurring ? 'Recurring' : 'One-time'}</p>
                      {runningSessionCodes[String(s._id)] && (() => {
                        const rc = runningSessionCodes[String(s._id)];
                        const suffix = rc.attendancePaused
                          ? (rc.rotationPaused ? ' (attendance paused · rotation paused)' : ' (attendance paused)')
                          : rc.rotationPaused
                            ? ' (rotation paused)'
                            : ` (${rc.secondsRemaining}s)`;
                        return (
                        <div className="live-code-row">
                          <button
                            type="button"
                            className="icon-btn"
                            disabled={working}
                            onClick={() => (rc.rotationPaused ? onStartRotation(s._id) : onStopRotation(s._id))}
                            title={rc.rotationPaused ? 'Resume PIN rotation' : 'Pause PIN rotation'}
                          >
                            {rc.rotationPaused ? '⟳' : '↻'}
                          </button>
                          <button
                            type="button"
                            className="live-code-display-btn"
                            onClick={() => openProjectorView(s)}
                            title="Open PIN in a new tab for projector (large text + timer + rotation controls)"
                          >
                            <span className="live-code-display-btn__prefix">Code:</span>
                            <span className="live-code-display-btn__digits">{rc.code}</span>
                            <span className="live-code-display-btn__suffix">{suffix}</span>
                            <span className="live-code-display-btn__hint" aria-hidden>⛶</span>
                          </button>
                        </div>
                        );
                      })()}
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
                    <BasemapLayerControl />
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

