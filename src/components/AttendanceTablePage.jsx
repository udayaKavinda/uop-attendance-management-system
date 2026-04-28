import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdminAttendanceMatrix } from '../api';
import { downloadAttendanceTableExcel } from '../utils/matrixExcel';

export default function AttendanceTablePage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!courseId) {
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const resp = await getAdminAttendanceMatrix(courseId);
        if (cancelled) return;
        if (resp.error) {
          setError(resp.error);
          setData(null);
        } else {
          setData(resp);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Could not load this table.');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [courseId]);

  if (loading) {
    return (
      <div className="report-shell page-fade">
        <div className="report-toolbar">
          <div>
            <h1 className="report-title">Attendance table</h1>
            <p className="report-sub">Loading…</p>
          </div>
        </div>
        <div className="report-body">
          <p className="section-desc" style={{ margin: 0 }}>Fetching attendance data.</p>
        </div>
      </div>
    );
  }

  const hasTable = !error && data && data.sessions?.length > 0;

  return (
    <div className="report-shell page-fade">
      <div className="report-toolbar">
        <div>
          <h1 className="report-title">Attendance table</h1>
          <p className="report-sub">
            {data?.course
              ? `${data.course.code}${data.course.batch ? ` · ${data.course.batch}` : ''} · ${data.course.name}`
              : 'Course report'}
          </p>
        </div>
        <div className="matrix-page-header" style={{ margin: 0 }}>
          <button type="button" className="pill-btn" onClick={() => navigate('/admin')}>
            ← Dashboard
          </button>
          {hasTable ? (
            <button
              type="button"
              className="primary-btn primary-btn--inline"
              onClick={() => {
                try {
                  downloadAttendanceTableExcel(data);
                } catch (err) {
                  console.warn('Excel export failed:', err);
                }
              }}
            >
              Download Excel
            </button>
          ) : null}
        </div>
      </div>

      <div className="report-body">
        {error ? <p className="error">{error}</p> : null}

        {hasTable ? (
          <div className="matrix-scroll-hint">
            <div className="matrix-wrap">
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th>Student ID</th>
                    {data.sessions.map((s) => <th key={s._id}>{s.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={`${row.studentId}-${row.email}`}>
                      <td>{row.studentId}</td>
                      {data.sessions.map((s) => (
                        <td key={`${row.studentId}-${s._id}`}>
                          {row.attendance?.[String(s._id)] ? (
                            <span className="matrix-cell-present">P</span>
                          ) : (
                            <span className="matrix-cell-absent">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : !error ? (
          <div className="matrix-empty">
            <div className="matrix-empty__icon" aria-hidden>▦</div>
            <p className="student-empty__title" style={{ marginBottom: '0.35rem' }}>No attendance data yet</p>
            <p className="section-desc" style={{ margin: '0 auto', maxWidth: '36ch' }}>
              After students mark attendance for this course, columns (date and session hours) appear here.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
