import React, { useEffect, useState } from 'react';
import {
  verifyLecture,
  recordAttendance,
  getAttendanceStatus,
  getRunningCourses,
} from '../api';

export default function LectureEntry() {
  const [code, setCode] = useState('');
  const [courseId, setCourseId] = useState('');
  const [courses, setCourses] = useState([]);
  const [courseQuery, setCourseQuery] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [logoMissing, setLogoMissing] = useState(false);
  const courseLabel = (item) => `${item.code} - ${item.name}`;

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function loadCourses() {
      const resp = await getRunningCourses();
      if (cancelled) return;
      if (resp.error) {
        setError(resp.error);
      } else {
        const next = resp.items || [];
        setCourses(next);
        setCourseId((prev) => {
          const kept = prev && next.find((c) => c._id === prev);
          if (kept) {
            setCourseQuery(courseLabel(kept));
            return prev;
          }
          if (next[0]) {
            setCourseQuery(courseLabel(next[0]));
            return next[0]._id;
          }
          setCourseQuery('');
          return '';
        });
      }
      timer = setTimeout(loadCourses, 10000);
    }
    loadCourses();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const visibleCourses = courses.filter((item) => {
    const q = courseQuery.trim().toLowerCase();
    if (!q) return true;
    return `${item.code} ${item.name}`.toLowerCase().includes(q);
  });

  useEffect(() => {
    const typed = courseQuery.trim().toLowerCase();
    if (!typed) {
      setCourseId('');
      return;
    }
    const match = courses.find((item) => {
      const label = courseLabel(item).toLowerCase();
      return label === typed || item.code.toLowerCase() === typed;
    });
    setCourseId(match ? match._id : '');
  }, [courseQuery, courses]);

  useEffect(() => {
    let cancelled = false;

    async function syncStatus() {
      if (!courseId) {
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
        const status = await getAttendanceStatus(student.studentId, courseId);
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
  }, [courseId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (!courseId) {
      setError('Please choose a course from the list.');
      return;
    }
    setSubmitting(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const trimmed = code.trim();
          const verify = await verifyLecture({
            courseId,
            lectureCode: trimmed,
            lat: latitude,
            lng: longitude,
          });
          if (verify.success) {
            const student = JSON.parse(localStorage.getItem('student') || '{}');
            const method = 'google';
            const record = await recordAttendance({
              studentId: student.studentId,
              courseId,
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
          <label className="field-label" htmlFor="courseSearch">Course</label>
          <input
            id="courseSearch"
            className="input"
            type="text"
            list="runningCourseOptions"
            placeholder="Search/select running course"
            value={courseQuery}
            onChange={(e) => setCourseQuery(e.target.value)}
            required
          />
          <datalist id="runningCourseOptions">
            {visibleCourses.map((item) => (
              <option key={item._id} value={courseLabel(item)} />
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
