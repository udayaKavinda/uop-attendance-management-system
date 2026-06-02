import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  getBluetoothTarget,
  submitBluetoothAttendance,
  getAttendanceStatus,
  getRunningCourses,
} from '../api';
import { readStoredStudent } from '../utils/safeStorage';

const BT_PHASE_LABEL = {
  fetching: 'Looking up session…',
  requesting: 'Select the device in the browser dialog…',
  watching: 'Receiving Bluetooth signal…',
  submitting: 'Verifying attendance…',
};

function runningCourseLabel(item) {
  return `${item.code} — ${item.name}`;
}

export default function LectureEntry() {
  const [courseId, setCourseId] = useState('');
  const [courseQuery, setCourseQuery] = useState('');
  const [courseMenuOpen, setCourseMenuOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [courses, setCourses] = useState([]);
  const [error, setError] = useState(null);
  const [btPhase, setBtPhase] = useState('idle');
  const [recorded, setRecorded] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const blurCloseTimer = useRef(null);
  const comboboxRef = useRef(null);
  const abortRef = useRef(null);
  const listboxId = 'running-course-listbox';

  const clearBlurTimer = () => {
    if (blurCloseTimer.current) {
      clearTimeout(blurCloseTimer.current);
      blurCloseTimer.current = null;
    }
  };

  const openCourseMenu = useCallback(() => {
    clearBlurTimer();
    setCourseMenuOpen(true);
  }, []);

  const scheduleCloseMenu = useCallback(() => {
    clearBlurTimer();
    blurCloseTimer.current = setTimeout(() => {
      setCourseMenuOpen(false);
      setHighlightIndex(-1);
    }, 200);
  }, []);

  // Poll running courses every 10 s
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function loadCourses() {
      try {
        const resp = await getRunningCourses();
        if (cancelled) return;
        if (resp.error) {
          setError(resp.error);
        } else {
          setError(null);
          setCourses(resp.items || []);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load running courses.');
      } finally {
        if (!cancelled) timer = setTimeout(loadCourses, 10000);
      }
    }
    loadCourses();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Drop selection if the course is no longer running
  useEffect(() => {
    if (!courseId) return;
    if (!courses.some((c) => c._id === courseId)) {
      setCourseId('');
      setCourseQuery('');
    }
  }, [courses, courseId]);

  const filteredCourses = useMemo(() => {
    const q = courseQuery.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((item) =>
      `${item.code} ${item.name}`.toLowerCase().includes(q),
    );
  }, [courses, courseQuery]);

  const pickCourse = useCallback((item) => {
    setCourseQuery(runningCourseLabel(item));
    setCourseId(item._id);
    setCourseMenuOpen(false);
    setHighlightIndex(-1);
  }, []);

  useEffect(() => {
    const typed = courseQuery.trim().toLowerCase();
    if (!typed) { setCourseId(''); return; }
    const match = courses.find((item) => {
      const label = runningCourseLabel(item).toLowerCase();
      return label === typed || item.code.toLowerCase() === typed;
    });
    setCourseId(match ? match._id : '');
  }, [courseQuery, courses]);

  // Check if attendance already recorded when course selected
  useEffect(() => {
    let cancelled = false;
    async function syncStatus() {
      if (!courseId) { setRecorded(false); return; }
      const student = readStoredStudent();
      if (!student?.studentId) { setError('Not signed in. Please sign in again.'); return; }
      setCheckingStatus(true);
      setError(null);
      try {
        const status = await getAttendanceStatus(courseId);
        if (cancelled) return;
        if (status.error) { setError(status.error); setRecorded(false); }
        else { setRecorded(Boolean(status.attended)); }
      } catch (err) {
        if (!cancelled) { setError(err?.message || 'Failed to check status'); setRecorded(false); }
      }
      setCheckingStatus(false);
    }
    syncStatus();
    return () => { cancelled = true; };
  }, [courseId]);

  useEffect(() => {
    if (!courseMenuOpen) return;
    setHighlightIndex((i) => {
      const max = filteredCourses.length - 1;
      if (max < 0) return -1;
      if (i < 0) return 0;
      return Math.min(i, max);
    });
  }, [courseMenuOpen, filteredCourses.length]);

  // Abort BT watch on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);
  useEffect(() => () => clearBlurTimer(), []);

  const handleCourseKeyDown = (e) => {
    if (!courseMenuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && courses.length > 0) {
      e.preventDefault();
      openCourseMenu();
      setHighlightIndex(0);
      return;
    }
    if (!courseMenuOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); setCourseMenuOpen(false); setHighlightIndex(-1); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i < 0 ? 0 : i + 1, filteredCourses.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i <= 0 ? 0 : i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && highlightIndex >= 0 && filteredCourses[highlightIndex]) {
      e.preventDefault();
      pickCourse(filteredCourses[highlightIndex]);
    }
  };

  const startBtScan = useCallback(async () => {
    if (!courseId) { setError('Select a course first.'); return; }

    if (!navigator.bluetooth?.requestDevice) {
      setError('Web Bluetooth is not supported on this browser. Please use Chrome on Android.');
      return;
    }

    setError(null);
    setBtPhase('fetching');

    const target = await getBluetoothTarget(courseId);
    if (target.error) {
      setError(target.error);
      setBtPhase('idle');
      return;
    }

    setBtPhase('requesting');
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ name: target.deviceName }],
        optionalManufacturerData: [0xFFFF],
      });
    } catch (err) {
      setBtPhase('idle');
      if (err.name === 'NotFoundError') return; // user cancelled picker — no error shown
      setError(
        err.name === 'SecurityError'
          ? 'Bluetooth permission denied. Enable Bluetooth and try again.'
          : err.message || 'Could not open Bluetooth scanner.',
      );
      return;
    }

    setBtPhase('watching');
    const ac = new AbortController();
    abortRef.current = ac;
    let tokenFound = false;

    const timeout = setTimeout(() => {
      if (!tokenFound) {
        ac.abort();
        setBtPhase('idle');
        setError('No Bluetooth signal received in 30 s. Make sure you are near the room and the broadcaster is running.');
      }
    }, 30000);

    const handleAdvertisement = async (evt) => {
      if (tokenFound) return;
      const mfData = evt.manufacturerData?.get(0xFFFF);
      if (!mfData) return; // wait for a packet that carries our manufacturer data

      tokenFound = true;
      clearTimeout(timeout);
      ac.abort();

      const token = Array.from(new Uint8Array(mfData.buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      setBtPhase('submitting');
      const result = await submitBluetoothAttendance({ courseId, token });
      if (result.success || result.duplicate) {
        setRecorded(true);
        setError(null);
      } else {
        setError(result.error || 'Verification failed. Move closer and try again.');
      }
      setBtPhase('idle');
    };

    device.addEventListener('advertisementreceived', handleAdvertisement);

    try {
      await device.watchAdvertisements({ signal: ac.signal });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') return;
      setBtPhase('idle');
      setError(err.message || 'Bluetooth watch failed.');
    }
  }, [courseId]);

  const scanning = btPhase !== 'idle';
  const noRunning = courses.length === 0 && !error;
  const busy = scanning || checkingStatus;

  return (
    <div className="student-panel page-fade">
      <div className="card-content">
        {recorded ? (
          <div className="status-wrap">
            <div className="success-icon">✓</div>
            <h2 className="card-title">Attendance recorded</h2>
            <p className="card-subtitle">Your Bluetooth attendance was saved for this session.</p>
          </div>
        ) : (
          <>
            <h2 className="card-title">Lecture attendance</h2>
            <p className="card-subtitle">
              Select your running course, then scan for the classroom Bluetooth signal.
            </p>
          </>
        )}

        {error && <p className="error">{error}</p>}

        {noRunning ? (
          <div className="student-empty">
            <div className="student-empty__icon" aria-hidden>📅</div>
            <p className="student-empty__title">No lectures running right now</p>
            <p className="student-empty__text">
              When a session is active for your course, it will appear here automatically. This list refreshes every few seconds.
            </p>
          </div>
        ) : (
          <>
            <label className="field-label" htmlFor="courseSearch">Course</label>
            <div className="course-combobox" ref={comboboxRef}>
              <input
                id="courseSearch"
                className="input"
                type="text"
                autoComplete="off"
                placeholder="Type course code"
                value={courseQuery}
                role="combobox"
                aria-expanded={courseMenuOpen}
                aria-controls={listboxId}
                aria-autocomplete="list"
                onChange={(e) => { setCourseQuery(e.target.value); openCourseMenu(); }}
                onFocus={() => { clearBlurTimer(); openCourseMenu(); }}
                onBlur={scheduleCloseMenu}
                onKeyDown={handleCourseKeyDown}
                disabled={busy}
                required
              />
              {courseMenuOpen && filteredCourses.length > 0 ? (
                <ul id={listboxId} className="course-combobox__menu" role="listbox">
                  {filteredCourses.map((item, idx) => (
                    <li key={item._id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        className="course-combobox__option"
                        aria-selected={idx === highlightIndex}
                        onMouseDown={(ev) => { ev.preventDefault(); pickCourse(item); }}
                        onMouseEnter={() => setHighlightIndex(idx)}
                      >
                        <span className="course-combobox__code">{item.code}</span>
                        <span className="course-combobox__name">{item.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {!recorded && (
              <>
                {scanning && (
                  <div className="bt-scan-status">
                    <div className="bt-scan-icon" aria-hidden>📶</div>
                    <p className="bt-scan-label">{BT_PHASE_LABEL[btPhase]}</p>
                  </div>
                )}
                <button
                  className="primary-btn primary-btn--bt"
                  type="button"
                  onClick={startBtScan}
                  disabled={busy || !courseId}
                >
                  {scanning ? BT_PHASE_LABEL[btPhase] : '📡  Scan for Bluetooth Attendance'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
