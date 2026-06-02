import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import {
  getBluetoothTarget,
  submitBluetoothAttendance,
  getAttendanceStatus,
  getRunningCourses,
} from '../api';
import { readStoredStudent } from '../utils/safeStorage';

const IS_NATIVE = Capacitor.isNativePlatform();

const BT_PHASE_LABEL = {
  fetching: 'Looking up session…',
  requesting: IS_NATIVE ? 'Starting Bluetooth scan…' : 'Select the device in the browser dialog…',
  watching: IS_NATIVE ? 'Scanning for classroom signal…' : 'Receiving Bluetooth signal…',
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
  const abortRef = useRef(null);
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

  // ── Capacitor native BLE path ────────────────────────────────────────────────
  const startBtScanNative = useCallback(async () => {
    setError(null);
    setBtPhase('fetching');

    const target = await getBluetoothTarget(courseId);
    if (target.error) { setError(target.error); setBtPhase('idle'); return; }

    setBtPhase('requesting');
    try {
      // androidNeverForLocation: true → uses BLUETOOTH_SCAN without location
      await BleClient.initialize({ androidNeverForLocation: true });
    } catch (err) {
      setBtPhase('idle');
      setError('Bluetooth initialization failed. Enable Bluetooth and try again.');
      return;
    }

    setBtPhase('watching');
    let tokenFound = false;
    let stopped = false;

    const stopScan = async () => {
      if (stopped) return;
      stopped = true;
      cancelScanRef.current = null;
      try { await BleClient.stopLEScan(); } catch (_) {}
    };
    cancelScanRef.current = stopScan;

    const timeout = setTimeout(async () => {
      if (!tokenFound) {
        await stopScan();
        setBtPhase('idle');
        setError('No Bluetooth signal received in 30 s. Make sure you are near the room and the broadcaster is running.');
      }
    }, 30000);

    try {
      await BleClient.requestLEScan({ name: target.deviceName }, async (scanResult) => {
        if (tokenFound) return;

        // manufacturerData keys vary by platform: '65535', '0xFFFF', 'ffff' …
        const mfMap = scanResult.manufacturerData || {};
        const mfData = Object.entries(mfMap)
          .find(([k]) => {
            const n = k.startsWith('0x') || k.startsWith('0X')
              ? parseInt(k, 16)
              : parseInt(k, 10);
            return n === 0xFFFF;
          })?.[1];
        if (!mfData) return;

        tokenFound = true;
        clearTimeout(timeout);
        await stopScan();

        // Decode manufacturer bytes as UTF-8 string (matches how lecturer encodes the token)
        const token = new TextDecoder().decode(
          mfData.buffer ? new Uint8Array(mfData.buffer) : mfData,
        ).replace(/\0/g, '').trim();

        setBtPhase('submitting');
        const resp = await submitBluetoothAttendance({ courseId, token });
        if (resp.success || resp.duplicate) {
          setRecorded(true);
          setError(null);
        } else {
          setError(resp.error || 'Verification failed. Move closer and try again.');
        }
        setBtPhase('idle');
      });
    } catch (err) {
      clearTimeout(timeout);
      await stopScan();
      setBtPhase('idle');
      setError(err.message || 'Bluetooth scan failed.');
    }
  }, [courseId]);

  // ── Web Bluetooth fallback path (Chrome on Android) ──────────────────────────
  const startBtScanWeb = useCallback(async () => {
    if (!navigator.bluetooth?.requestDevice) {
      setError('Web Bluetooth is not supported on this browser. Please use Chrome on Android.');
      return;
    }

    setError(null);
    setBtPhase('fetching');

    const target = await getBluetoothTarget(courseId);
    if (target.error) { setError(target.error); setBtPhase('idle'); return; }

    setBtPhase('requesting');
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ name: target.deviceName }],
        optionalManufacturerData: [0xFFFF],
      });
    } catch (err) {
      setBtPhase('idle');
      if (err.name === 'NotFoundError') return;
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
    cancelScanRef.current = () => ac.abort();
    let tokenFound = false;

    const timeout = setTimeout(() => {
      if (!tokenFound) {
        ac.abort();
        cancelScanRef.current = null;
        setBtPhase('idle');
        setError('No Bluetooth signal received in 30 s. Make sure you are near the room and the broadcaster is running.');
      }
    }, 30000);

    const handleAdvertisement = async (evt) => {
      if (tokenFound) return;
      const mfData = evt.manufacturerData?.get(0xFFFF);
      if (!mfData) return;

      tokenFound = true;
      clearTimeout(timeout);
      ac.abort();
      cancelScanRef.current = null;

      const token = Array.from(new Uint8Array(mfData.buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

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

  // ── Entry point: pick the right path ─────────────────────────────────────────
  const startBtScan = useCallback(async () => {
    if (!courseId) { setError('Select a course first.'); return; }
    if (IS_NATIVE) return startBtScanNative();
    return startBtScanWeb();
  }, [courseId, startBtScanNative, startBtScanWeb]);

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
