import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAdminCourses,
  createAdminCourse,
  deleteAdminCourse,
  disableAdminCourse,
  enableAdminCourse,
  createAdminSession,
  getAdminAllSessions,
  getAdminRunningSessions,
  activateAdminSession,
  deactivateAdminSession,
  deleteAdminSession,
  patchAdminSessionAttendancePaused,
  patchCourseAssignLecturer,
  getAdminLecturers,
  createAdminLecturer,
  deleteAdminLecturer,
  startSessionBluetooth,
  stopSessionBluetooth,
  getLecturerBroadcastToken,
} from '../api';
import { readStoredStudent } from '../utils/safeStorage';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_ORDER = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const BLE_COMPANY_ID = 0xFFFF;
const BLE_POLL_INTERVAL_MS = 8_000;
const OWNER_ALL_LABEL = 'All lecturers — show every course';
const OWNER_LISTBOX_ID = 'admin-catalog-owner-listbox';
const MAX_COURSE_LECTURERS = 5;
const ASSIGN_OWNER_SEARCH_LIMIT = 8;


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
  const assignOwnerPanelRef = useRef(null);

  // BLE broadcasting state (keyed by sessionId string)
  const [bleStates, setBleStates] = useState({});       // { [sid]: { deviceName, token, rotatesIn } }
  const [bleCountdowns, setBleCountdowns] = useState({}); // { [sid]: number }
  const [bleBroadcasting, setBleBroadcasting] = useState({}); // { [sid]: boolean }
  const [bleAdErrors, setBleAdErrors] = useState({});    // { [sid]: string }
  const pollRefsMap = useRef({});   // { [sid]: intervalId }
  const adHandlesMap = useRef({});  // { [sid]: BLE advertise handle }

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

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setLoading(true);
      try {
        const tasks = [loadCourses(), loadSessions()];
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
  }, [loadCourses, loadSessions, loadLecturers, loadLecturerDirectory, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => { loadLecturers(); }, 300);
    return () => clearTimeout(t);
  }, [lecturerSearch, isAdmin, loadLecturers]);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'lecturers') loadLecturers();
  }, [activeTab, isAdmin, loadLecturers]);

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
        const resp = await getAdminRunningSessions();
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
          // Temporary network issues should not crash the whole admin screen.
          setError((prev) => (prev ? prev : 'Live session updates are temporarily unavailable. Retrying...'));
        }
      } finally {
        if (!cancelled) timer = setTimeout(refreshRunningCodes, 5000);
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

  useEffect(() => {
    if (!assignOwnerCourseId) return undefined;
    function handlePointerDown(event) {
      const el = assignOwnerPanelRef.current;
      if (el && !el.contains(event.target)) {
        setAssignOwnerCourseId('');
        setAssignOwnerQuery('');
      }
    }
    function handleEscape(event) {
      if (event.key === 'Escape') {
        setAssignOwnerCourseId('');
        setAssignOwnerQuery('');
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [assignOwnerCourseId]);

  const onCreateSession = async () => {
    if (!selectedCourseId) {
      setError('Select a course first.');
      return;
    }
    setWorking(true);
    setError('');
    const resp = await createAdminSession(selectedCourseId, {
      lectureDay,
      startTime,
      endTime,
      recurring,
    });
    if (resp.error) setError(resp.error);
    else {
      setMessage('Session created.');
      setLectureDay('MON');
      setStartTime('08:00');
      setEndTime('10:00');
      setRecurring(true);
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

  // BLE token polling — called on interval for each BLE-enabled active session
  const pollBleToken = useCallback(async (sessionId) => {
    const sid = String(sessionId);
    const data = await getLecturerBroadcastToken(sid);
    if (data.error) return;
    setBleStates((prev) => ({ ...prev, [sid]: data }));
    if (data.rotatesIn != null) {
      setBleCountdowns((prev) => ({ ...prev, [sid]: data.rotatesIn }));
    }
    // Update advertisement data if currently broadcasting
    const handle = adHandlesMap.current[sid];
    if (handle && typeof handle.updateData === 'function' && data.token) {
      try {
        const tokenBytes = new TextEncoder().encode(data.token);
        await handle.updateData({ manufacturerData: [{ companyIdentifier: BLE_COMPANY_ID, data: tokenBytes }] });
      } catch (err) {
        adHandlesMap.current[sid] = null;
        setBleBroadcasting((prev) => ({ ...prev, [sid]: false }));
        setBleAdErrors((prev) => ({ ...prev, [sid]: 'Broadcast interrupted — token rotated: ' + err.message }));
      }
    }
  }, []);

  // Start/stop polling when sessions list changes (tracks which sessions have BLE enabled + active)
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
        if (handle && typeof handle.stop === 'function') handle.stop().catch(() => {});
        adHandlesMap.current[sid] = null;
        setBleBroadcasting((prev) => { const n = { ...prev }; delete n[sid]; return n; });
        setBleStates((prev) => { const n = { ...prev }; delete n[sid]; return n; });
        setBleCountdowns((prev) => { const n = { ...prev }; delete n[sid]; return n; });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  // Single countdown tick for all active BLE sessions
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

  // Cleanup all BLE state on unmount
  useEffect(() => () => {
    Object.values(pollRefsMap.current).forEach(clearInterval);
    Object.values(adHandlesMap.current).forEach((h) => { if (h?.stop) h.stop().catch(() => {}); });
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
    if (!navigator.bluetooth?.advertise) {
      setBleAdErrors((prev) => ({
        ...prev,
        [sid]: 'BLE advertising is not supported in this browser. On Android Chrome, enable "Experimental Web Platform features" at chrome://flags.',
      }));
      return;
    }
    try {
      const tokenBytes = new TextEncoder().encode(state.token);
      const handle = await navigator.bluetooth.advertise({
        type: 'manufacturer',
        manufacturerData: [{ companyIdentifier: BLE_COMPANY_ID, data: tokenBytes }],
      });
      adHandlesMap.current[sid] = handle;
      setBleBroadcasting((prev) => ({ ...prev, [sid]: true }));
    } catch (err) {
      setBleAdErrors((prev) => ({ ...prev, [sid]: 'Broadcast failed: ' + err.message }));
    }
  };

  const handleStopBroadcast = async (sessionId) => {
    const sid = String(sessionId);
    const handle = adHandlesMap.current[sid];
    if (handle && typeof handle.stop === 'function') {
      try { await handle.stop(); } catch (_) {}
    }
    adHandlesMap.current[sid] = null;
    setBleBroadcasting((prev) => ({ ...prev, [sid]: false }));
  };

  const onStartBluetooth = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await startSessionBluetooth(sessionId);
    if (resp.error) setError(resp.error);
    else {
      setToast('Bluetooth attendance started.');
      await loadSessions();
    }
    setWorking(false);
  };

  const onStopBluetooth = async (sessionId) => {
    setWorking(true);
    setError('');
    const resp = await stopSessionBluetooth(sessionId);
    if (resp.error) setError(resp.error);
    else {
      setToast('Bluetooth attendance stopped.');
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
                <button type="button" className={`tab-btn ${activeTab === 'lecturers' ? 'active' : ''}`} onClick={() => setActiveTab('lecturers')}>Lecturers</button>
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
                            <div className="course-owner-picker__panel" ref={assignOwnerPanelRef}>
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
                  Choose a course, set the weekly time slot and recurrence, then create the session.
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
                <p className="section-desc">Search sessions, toggle activation, or click the blinking Live badge to pause or resume student attendance. Enable Bluetooth to broadcast the rotating BLE token. Deactivate or soft-delete as needed.</p>
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
                    </div>
                    <div className="bt-row">
                      {s.bluetoothEnabled ? (
                        <button
                          type="button"
                          className="pill-btn warning"
                          disabled={working}
                          onClick={() => onStopBluetooth(s._id)}
                        >
                          BT off
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="pill-btn"
                          disabled={working}
                          onClick={() => onStartBluetooth(s._id)}
                          title="Enable Bluetooth attendance for this session"
                        >
                          📡 BT on
                        </button>
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

        </div>
      </div>
    </>
  );
}

