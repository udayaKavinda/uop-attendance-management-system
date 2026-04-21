import React, { useEffect, useState } from 'react';
import { verifyLecture, recordAttendance, getAttendanceStatus } from '../api';

const COURSE_CODES = ['EE669', 'EM2020', 'EM503', 'EM526', 'EM1050', 'EM527', 'EM524'];
const MAX_COURSE_ITEMS = 10;
const VISIBLE_COURSE_CODES = COURSE_CODES.slice(0, MAX_COURSE_ITEMS);

export default function LectureEntry() {
  const [code, setCode] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [logoMissing, setLogoMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function syncStatus() {
      if (!courseCode) {
        setRecorded(false);
        setCode('');
        return;
      }
      const student = JSON.parse(localStorage.getItem('student') || '{}');
      if (!student.studentId) {
        setError('Not signed in. Please sign in again.');
        setRecorded(false);
        return;
      }

      setCheckingStatus(true);
      setError(null);
      try {
        const status = await getAttendanceStatus(student.studentId, courseCode);
        if (cancelled) return;
        if (status.error) {
          setError(status.error);
          setRecorded(false);
        } else {
          setRecorded(Boolean(status.attended));
          if (status.attended) setCode('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to check attendance status');
          setRecorded(false);
        }
      }
      setCheckingStatus(false);
    }

    syncStatus();
    return () => {
      cancelled = true;
    };
  }, [courseCode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (!VISIBLE_COURSE_CODES.includes(courseCode)) {
      setError('Please choose a valid course code from the list.');
      return;
    }
    setSubmitting(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const trimmed = code.trim();
          const verify = await verifyLecture({
            courseCode,
            lectureCode: trimmed,
            lat: latitude,
            lng: longitude,
          });
          if (verify.success) {
            const student = JSON.parse(localStorage.getItem('student') || '{}');
            const method = 'google';
            const record = await recordAttendance({
              studentId: student.studentId,
              courseCode,
              lectureCode: trimmed,
              method,
              lat: latitude,
              lng: longitude,
            });
            if (record.success) {
              setRecorded(true);
              setCode('');
            } else {
              setError(record.error || 'Failed to record attendance');
            }
          } else {
            setError(verify.error || 'Lecture verification failed');
          }
        } catch (err) {
          setError(err.message);
        } finally {
          setSubmitting(false);
        }
      },
      (err) => {
        setError('Unable to get location: ' + err.message);
        setSubmitting(false);
      },
    );
  };

  return (
    <div className="app-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="card-content">
          <div className="brand-row">
            {!logoMissing ? (
              <img
                src="/uop-logo.png"
                alt="University of Peradeniya logo"
                className="brand-logo"
                onError={() => setLogoMissing(true)}
              />
            ) : (
              <span className="brand-fallback">UOP</span>
            )}
            <div>
              <p className="brand-title">University of Peradeniya</p>
              <p className="brand-subtitle">Attendance Management System</p>
            </div>
          </div>
          {!recorded && (
            <>
              <h2 className="card-title">Enter Lecture Code</h2>
              <p className="card-subtitle">Location access is required to mark attendance.</p>
            </>
          )}
          {error && <p className="error">{error}</p>}
          {recorded && (
            <div className="status-wrap">
              <h2 className="card-title">Attendance Recorded</h2>
              <p className="card-subtitle">Your attendance is recorded successfully.</p>
            </div>
          )}
          <label className="field-label" htmlFor="courseCode">Course Code</label>
          <input
            id="courseCode"
            className="input"
            type="text"
            list="courseCodeOptions"
            placeholder="Search or select a course code"
            value={courseCode}
            onChange={(e) => setCourseCode(e.target.value.toUpperCase().trim())}
            required
          />
          <datalist id="courseCodeOptions">
            {VISIBLE_COURSE_CODES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </datalist>
          {!recorded && (
            <>
              <label className="field-label" htmlFor="lectureCode" style={{ marginTop: '0.8rem' }}>Lecture Code</label>
              <input
                id="lectureCode"
                className="input"
                type="text"
                placeholder="8-digit lecture code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <button className="primary-btn" type="submit" disabled={submitting || checkingStatus}>
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
