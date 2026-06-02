import React, { useCallback, useEffect, useRef, useState } from 'react';
import { verifyBlePayload, getAttendanceStatus, getRunningCourses } from '../api';
import { readStoredStudent } from '../utils/safeStorage';

const SCAN_TIMEOUT_MS = 120_000; // 2-minute window
// Manufacturer ID used in the BLE advertisement (must match the value in BleSessionPage)
const BLE_MANUFACTURER_ID = 0x004c;

function runningCourseLabel(item) {
  return `${item.code} – ${item.name}`;
}

export default function LectureEntry() {
  const [user, setUser] = useState(null);
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | scanning | found | submitting | done | error
  const [statusMsg, setStatusMsg] = useState('');
  const [attendance, setAttendance] = useState(null);
  const [bleSupported] = useState(() => typeof navigator !== 'undefined' && 'bluetooth' in navigator);
  const scanRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const stored = readStoredStudent();
    if (stored) setUser(stored);
  }, []);

  const loadCourses = useCallback(async () => {
    const data = await getRunningCourses();
    setCourses(data.items || []);
  }, []);

  useEffect(() => { loadCourses(); }, [loadCourses]);

  // Check if already attended when course selection changes
  useEffect(() => {
    if (!selectedCourse) return;
    getAttendanceStatus(selectedCourse).then((s) => {
      if (s.attended) {
        setPhase('done');
        setStatusMsg('Attendance already recorded for this session.');
      } else {
        setPhase('idle');
        setStatusMsg('');
      }
    });
  }, [selectedCourse]);

  const stopScan = useCallback(() => {
    if (scanRef.current) {
      try { scanRef.current.stop(); } catch (_) {}
      scanRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopScan(), [stopScan]);

  const handleAdvertisement = useCallback(async (event) => {
    // Extract manufacturer data
    const mfData = event.manufacturerData?.get(BLE_MANUFACTURER_ID);
    if (!mfData) return;

    const decoder = new TextDecoder();
    const payload = decoder.decode(mfData).trim().replace(/\0/g, '');
    if (!payload) return;

    stopScan();
    setPhase('found');
    setStatusMsg('BLE signal detected. Verifying with server…');

    setPhase('submitting');
    const result = await verifyBlePayload(selectedCourse, payload);
    if (result.error) {
      setPhase('error');
      setStatusMsg(result.error);
      return;
    }
    setPhase('done');
    setAttendance(result.attendance);
    setStatusMsg('Attendance marked successfully!');
  }, [selectedCourse, stopScan]);

  const startScan = useCallback(async () => {
    if (!bleSupported) return;
    if (!selectedCourse) { setStatusMsg('Please select your course first.'); return; }

    setPhase('scanning');
    setStatusMsg('Scanning for lecturer BLE broadcast…');

    try {
      const scan = await navigator.bluetooth.requestLEScan({
        filters: [{ manufacturerData: [{ companyIdentifier: BLE_MANUFACTURER_ID }] }],
        keepRepeatedDevices: true,
      });
      scanRef.current = scan;

      navigator.bluetooth.addEventListener('advertisementreceived', handleAdvertisement);

      // Auto-stop after 2-minute window
      timerRef.current = setTimeout(() => {
        stopScan();
        setPhase('error');
        setStatusMsg('No BLE signal detected within 2 minutes. Make sure you are in the lecture room and the lecturer has started broadcasting.');
      }, SCAN_TIMEOUT_MS);
    } catch (err) {
      setPhase('error');
      if (err.name === 'NotSupportedError') {
        setStatusMsg('BLE scanning is not supported on this browser. Please use Chrome on Android.');
      } else if (err.name === 'NotAllowedError') {
        setStatusMsg('Bluetooth permission denied. Please allow Bluetooth access and try again.');
      } else {
        setStatusMsg(`Scan failed: ${err.message}`);
      }
    }
  }, [bleSupported, selectedCourse, handleAdvertisement, stopScan]);

  const handleCancel = () => {
    stopScan();
    setPhase('idle');
    setStatusMsg('');
  };

  if (!bleSupported) {
    return (
      <div className="lecture-entry lecture-entry--unsupported">
        <div className="lecture-entry__card">
          <h2>Bluetooth Not Supported</h2>
          <p>This feature requires <strong>Chrome on Android</strong> with Bluetooth enabled.</p>
          <p>Please open this page in Chrome on your Android device to mark attendance.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lecture-entry">
      <div className="lecture-entry__card">
        <h2 className="lecture-entry__title">Mark Attendance</h2>

        {user && (
          <p className="lecture-entry__user">
            Signed in as <strong>{user.studentId || user.email}</strong>
          </p>
        )}

        <label className="lecture-entry__label" htmlFor="course-select">Select your course</label>
        <select
          id="course-select"
          className="lecture-entry__select"
          value={selectedCourse}
          onChange={(e) => setSelectedCourse(e.target.value)}
          disabled={phase === 'scanning' || phase === 'submitting'}
        >
          <option value="">— choose a course —</option>
          {courses.map((c) => (
            <option key={c._id} value={c._id}>{runningCourseLabel(c)}</option>
          ))}
        </select>

        {phase === 'idle' && selectedCourse && (
          <button type="button" className="lecture-entry__btn lecture-entry__btn--primary" onClick={startScan}>
            Scan for BLE Signal
          </button>
        )}

        {phase === 'scanning' && (
          <div className="lecture-entry__scanning">
            <div className="lecture-entry__spinner" aria-label="Scanning" />
            <p>{statusMsg}</p>
            <button type="button" className="lecture-entry__btn lecture-entry__btn--secondary" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        )}

        {phase === 'found' || phase === 'submitting' ? (
          <div className="lecture-entry__scanning">
            <div className="lecture-entry__spinner" aria-label="Verifying" />
            <p>{statusMsg}</p>
          </div>
        ) : null}

        {phase === 'done' && (
          <div className="lecture-entry__success">
            <p className="lecture-entry__success-msg">{statusMsg}</p>
            {attendance && (
              <p className="lecture-entry__meta">
                Recorded at {new Date(attendance.timestamp).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}

        {phase === 'error' && (
          <div className="lecture-entry__error">
            <p>{statusMsg}</p>
            <button type="button" className="lecture-entry__btn lecture-entry__btn--primary" onClick={() => { setPhase('idle'); setStatusMsg(''); }}>
              Try Again
            </button>
          </div>
        )}

        {courses.length === 0 && phase === 'idle' && (
          <p className="lecture-entry__hint">No active lecture sessions found right now.</p>
        )}
      </div>
    </div>
  );
}
