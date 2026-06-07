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
import { extractTokenFromUuids } from '../utils/bleToken';


const BT_PHASE_LABEL = {
  fetching: 'Looking up session…',
  requesting: 'Starting Bluetooth scan…',
  watching: 'Scanning for classroom signal…',
  submitting: 'Verifying attendance…',
};

function runningCourseLabel(item) {
  return `${item.code} – ${item.name}`;
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
  const listboxId = 'running-course-listbox';

  const clearBlurTimer = () => {
    if (blurCloseTimer.current) {
      clearTimeout(blurCloseTimer.current);
      blurCloseTimer.current = null;
    }
  };

  const scheduleCloseMenu = () => {
    blurCloseTimer.current = setTimeout(() => {
      setCourseMenuOpen(false);
    }, 150);
  };

  const openCourseMenu = useCallback(() => {
    clearBlurTimer();
    setCourseMenuOpen(true);
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

  // Cancel any in-progress BT scan on unmount (works for both paths)
  const cancelScanRef = useRef(null);
  useEffect(() => () => { cancelScanRef.current?.(); }, []);
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

  
  // ── Web Bluetooth path (Chrome on Android) ───────────────────────────────────
  // Background scan via requestLEScan — same idea as the native APK central scan:
  // no device picker; match UOPA-prefixed service UUIDs from capacitor-bluetooth.
  // requestLEScan must be the first await (preserves the tap user-gesture).
  const startBtScanWeb = useCallback(async () => {
    const bt = navigator.bluetooth;
    if (!bt?.requestLEScan) {
      setError(
        'Web Bluetooth scanning is not available in this browser. '
        + 'Use Chrome on Android (recent version), enable '
        + 'chrome://flags/#enable-experimental-web-platform-features, '
        + 'or use the native attendance app.',
      );
      return;
    }

    setError(null);
    let tokenFound = false;
    let stopped = false;
    let scan = null;
    let leScanListener = null;

    const stopScan = async () => {
      if (stopped) return;
      stopped = true;
      cancelScanRef.current = null;
      if (leScanListener) {
        try { bt.removeEventListener('advertisementreceived', leScanListener); } catch (_) {}
        leScanListener = null;
      }
      if (scan?.active) {
        try { await scan.stop(); } catch (_) {}
      }
      scan = null;
    };
    cancelScanRef.current = stopScan;

    setBtPhase('requesting');
    try {
      scan = await bt.requestLEScan({ acceptAllAdvertisements: true });
    } catch (err) {
      setBtPhase('idle');
      if (err.name === 'NotFoundError') return;
      setError(
        err.name === 'SecurityError'
          ? 'Bluetooth permission denied. Enable Bluetooth and try again.'
          : err.message || 'Could not start Bluetooth scan.',
      );
      return;
    }

    setBtPhase('fetching');
    const target = await getBluetoothTarget(courseId);
    if (target.error) {
      await stopScan();
      setError(target.error);
      setBtPhase('idle');
      return;
    }

    setBtPhase('watching');
    const timeoutId = setTimeout(async () => {
      if (!tokenFound) {
        await stopScan();
        setBtPhase('idle');
        setError('No Bluetooth signal received in 30 s. Make sure the lecturer APK is broadcasting and you are near the room.');
      }
    }, 30000);

    leScanListener = async (evt) => {
      if (tokenFound || stopped) return;
      const token = extractTokenFromUuids(evt.uuids);
      if (!token) return;
      tokenFound = true;
      clearTimeout(timeoutId);
      await stopScan();
      setBtPhase('submitting');
      const resp = await submitBluetoothAttendance({ courseId, token });
      if (resp.success || resp.duplicate) {
        setRecorded(true);
        setError(null);
      } else {
        setError(resp.error || 'Verification failed. Move closer and try again.');
      }
      setBtPhase('idle');
    };

    bt.addEventListener('advertisementreceived', leScanListener);
  }, [courseId]);

  // ── Entry point: pick the right path ─────────────────────────────────────────
  const startBtScan = useCallback(async () => {
    if (!courseId) { setError('Select a course first.'); return; }
    return startBtScanWeb();
  }, [courseId, startBtScanWeb]);

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
  To use Bluetooth Attendance in Chrome on Android, enable the Experimental Web Platform Features flag at{" "}
  <a
    href="chrome://flags/#enable-experimental-web-platform-features"
    target="_blank"
    rel="noopener noreferrer"
  >
    chrome://flags/#enable-experimental-web-platform-features
  </a>.
</p>
          </>
        )}

        {error && <p className="error">{error}</p>}

        {noRunning ? (
          <div className="student-empty">
            <div className="student-empty__icon" aria-hidden>📅</div>
            <p className="student-empty__title">No lectures running right now</p>
            <p className="student-empty__text">
              When a session is active for your course, it will appear here automatically. This list refreshes every 10 seconds.
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
