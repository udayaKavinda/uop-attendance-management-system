import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AttendanceMatrixRes } from '../../api/types';
import { Card, EmptyState, ErrorBanner, LoadingGate, Screen } from '../../components/Chrome';
import { SectionHeader } from '../../components/StaffChrome';

/**
 * Mirrors ui/staff/AttendanceMatrixScreen.kt.
 *
 * The native screen downloads the .xlsx and hands it to a share sheet; a browser
 * has a better answer — a plain link to the same endpoint, which streams the
 * file straight to the user's downloads with the session cookie attached.
 */
export function AttendanceMatrixScreen({
  courseId,
  onBack,
}: {
  courseId: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<AttendanceMatrixRes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.attendanceMatrix(courseId).then((res) => {
      if (cancelled) return;
      if (res.ok) setData(res.data);
      else setError(res.message);
    });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const course = data?.course;
  const sessions = data?.sessions ?? [];
  const rows = data?.rows ?? [];

  return (
    <Screen
      top={
        <div className="topbar">
          <button type="button" className="topbar__back" onClick={onBack}>
            ← Dashboard
          </button>
          <div className="topbar__titles">
            <div className="topbar__title">Course report</div>
            <div className="topbar__subtitle">
              {course
                ? `${course.code}${course.batch ? ` · ${course.batch}` : ''} · ${course.name}`
                : ''}
            </div>
          </div>
          <a
            className="topbar__signout"
            href={`/api/admin/courses/${encodeURIComponent(courseId)}/attendance-matrix.xlsx`}
          >
            Excel
          </a>
        </div>
      }
    >
      {error && <ErrorBanner message={error} />}

      {!data && !error && (
        <Card>
          <LoadingGate message="Fetching attendance data." />
        </Card>
      )}

      {data && rows.length === 0 && (
        <EmptyState
          icon="▦"
          title="No attendance data yet"
          text="Records appear here once students start checking in."
        />
      )}

      {data && rows.length > 0 && (
        <Card>
          <SectionHeader icon="▦" title="Attendance table" />
          <div className="matrix-scroll">
            <table className="matrix">
              <thead>
                <tr>
                  <th scope="col">Student ID</th>
                  {sessions.map((s) => (
                    <th key={s._id} scope="col">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.email ?? row.displayId}>
                    <th scope="row">{row.displayId ?? row.email}</th>
                    {sessions.map((s) => {
                      const status = s._id ? row.attendance?.[s._id] : undefined;
                      return (
                        <td key={s._id} className={status ? `matrix__cell--${status}` : undefined}>
                          {status === 'present' ? '●' : status === 'flagged' ? '▲' : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Screen>
  );
}
