import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  verifyLecturePin,
  recordAttendance,
  getAttendanceStatus,
  getRunningCourses,
} from '../api';
import { readStoredStudent } from '../utils/safeStorage';

const LOCATION_PHASE_MS = 180_000;
const LOCATION_SAMPLE_MS = 5_000;

function runningCourseLabel(item) {
  return `${item.code} — ${item.name}`;
}

export default function LectureEntry() {
  const [code, setCode] = useState('');
  const [courseId, setCourseId] = useState('');
  const [courses, setCourses] = useState([]);
  const [courseQuery, setCourseQuery] = useState('');
  const [courseMenuOpen, setCourseMenuOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [locationPhase, setLocationPhase] = useState('idle');
  const blurCloseTimer = useRef(null);
  const comboboxRef = useRef(null);
  const listboxId = 'running-course-listbox';
  const locationPhaseRef = useRef({ active: false, courseId: '', code: '' });
  const locationIntervalRef = useRef(null);
  const locationDeadlineRef = useRef(null);

  const stopLocationPhase = useCallback((opts = {}) => {
    const { silent } = opts;
    locationPhaseRef.current = { active: false, courseId: '', code: '' };
    if (locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current);
      locationIntervalRef.current = null;
    }
    if (locationDeadlineRef.current) {
      clearTimeout(locationDeadlineRef.current);
      locationDeadlineRef.current = null;
    }
    setLocationPhase((prev) => {
      if (prev === 'idle' && silent) return prev;
      return 'idle';
    });
  }, []);

  const startLocationPhase = useCallback(
    (phaseCourseId, lectureCode) => {
      stopLocationPhase({ silent: true });
      locationPhaseRef.current = {
        active: true,
        courseId: phaseCourseId,
        code: lectureCode,
      };
      setLocationPhase('checking');

      const runSample = () => {
        if (!locationPhaseRef.current.active) return;
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            if (!locationPhaseRef.current.active) return;
            const { courseId: cid, code } = locationPhaseRef.current;
            const { latitude, longitude, accuracy } = pos.coords;
            try {
              const record = await recordAttendance({
                courseId: cid,
                lectureCode: code,
                method: 'google',
                lat: latitude,
                lng: longitude,
                accuracy,
              });
              if (!locationPhaseRef.current.active) return;
              if (record.success || record.duplicate) {
                stopLocationPhase();
                setRecorded(true);
                setCode('');
                setError(null);
              }
            } catch {
              /* keep sampling until deadline */
            }
          },
          () => {
            /* GPS denied or timeout; next interval retries */
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
        );
      };

      runSample();
      locationIntervalRef.current = setInterval(runSample, LOCATION_SAMPLE_MS);
      locationDeadlineRef.current = setTimeout(() => {
        if (!locationPhaseRef.current.active) return;
        stopLocationPhase();
        setError(
          'Could not verify your location inside the allowed area in time. Try again when you are on campus.',
        );
      }, LOCATION_PHASE_MS);
    },
    [stopLocationPhase],
  );

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
        if (!cancelled) {
          setError(err?.message || 'Could not load running courses. Check your connection.');
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(loadCourses, 10000);
        }
      }
    }
    loadCourses();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

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
    if (!typed) {
      setCourseId('');
      return;
    }
    const match = courses.find((item) => {
      const label = runningCourseLabel(item).toLowerCase();
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
      const student = readStoredStudent();
      if (!student.studentId) {
        setError('Not signed in. Please sign in again.');
        setRecorded(false);
        return;
      }

      setCheckingStatus(true);
      setError(null);
      try {
        const status = await getAttendanceStatus(courseId);
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

  useEffect(() => {
    return () => clearBlurTimer();
  }, []);

  useEffect(() => {
    if (!courseMenuOpen) return;
    setHighlightIndex((i) => {
      const max = filteredCourses.length - 1;
      if (max < 0) return -1;
      if (i < 0) return 0;
      return Math.min(i, max);
    });
  }, [courseMenuOpen, filteredCourses.length]);

  useEffect(() => {
    if (recorded && locationPhaseRef.current.active) {
      stopLocationPhase({ silent: true });
    }
  }, [recorded, stopLocationPhase]);

  useEffect(() => {
    if (!locationPhaseRef.current.active) return;
    if (locationPhaseRef.current.courseId !== courseId) {
      stopLocationPhase();
      setError('Course changed; location check was cancelled.');
    }
  }, [courseId, stopLocationPhase]);

  useEffect(() => () => stopLocationPhase(), [stopLocationPhase]);

  const handleCourseKeyDown = (e) => {
    if (!courseMenuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && courses.length > 0) {
      e.preventDefault();
      openCourseMenu();
      setHighlightIndex(0);
      return;
    }
    if (!courseMenuOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setCourseMenuOpen(false);
      setHighlightIndex(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => {
        const next = i < 0 ? 0 : i + 1;
        return next >= filteredCourses.length ? filteredCourses.length - 1 : next;
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => {
        const next = i <= 0 ? 0 : i - 1;
        return next;
      });
      return;
    }
    if (e.key === 'Enter' && highlightIndex >= 0 && filteredCourses[highlightIndex]) {
      e.preventDefault();
      pickCourse(filteredCourses[highlightIndex]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || locationPhase === 'checking') return;
    setError(null);
    if (!courseId) {
      setError('Choose a course from the suggestions or type the full course code.');
      return;
    }
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Enter the lecture pin.');
      return;
    }

    setSubmitting(true);
    try {
      const verify = await verifyLecturePin({ courseId, lectureCode: trimmed });
      if (!verify.success) {
        setError(verify.error || 'Lecture verification failed');
        return;
      }
      startLocationPhase(courseId, trimmed);
    } catch (err) {
      setError(err?.message || 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const noRunning = courses.length === 0 && !error;
  const isCheckingLocation = locationPhase === 'checking';
  const formLocked = submitting || checkingStatus || isCheckingLocation;

  return (
    <form className="student-panel page-fade" onSubmit={handleSubmit}>
      <div className="card-content">
        {!recorded && (
          <>
            <h2 className="card-title">Lecture attendance</h2>
            <p className="card-subtitle">
              Select a running course and enter the pin from class. After the pin is accepted, we confirm you are on campus using your location for up to a few minutes—allow location when prompted.
            </p>
          </>
        )}
        {error && <p className="error">{error}</p>}
        {recorded && (
          <div className="status-wrap">
            <div className="success-icon">✓</div>
            <h2 className="card-title">Attendance recorded</h2>
            <p className="card-subtitle">Your attendance was saved for this session.</p>
          </div>
        )}

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
                onChange={(e) => {
                  setCourseQuery(e.target.value);
                  openCourseMenu();
                }}
                onFocus={() => {
                  clearBlurTimer();
                  openCourseMenu();
                }}
                onBlur={scheduleCloseMenu}
                onKeyDown={handleCourseKeyDown}
                disabled={formLocked}
                required
              />
              {courseMenuOpen && filteredCourses.length > 0 ? (
                <ul
                  id={listboxId}
                  className="course-combobox__menu"
                  role="listbox"
                >
                  {filteredCourses.map((item, idx) => (
                    <li key={item._id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        className="course-combobox__option"
                        aria-selected={idx === highlightIndex}
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          pickCourse(item);
                        }}
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
                <label className="field-label" htmlFor="lectureCode" style={{ marginTop: '0.85rem' }}>Pin code</label>
                <input
                  id="lectureCode"
                  className="input"
                  type="text"
                  placeholder="Code from lecturer"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={formLocked}
                  required
                />
                <button
                  className={`primary-btn${isCheckingLocation ? ' primary-btn--location-check' : ''}`}
                  type="submit"
                  disabled={formLocked}
                >
                  {isCheckingLocation
                    ? 'Checking location…'
                    : submitting
                      ? 'Submitting…'
                      : 'Submit attendance'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </form>
  );
}
