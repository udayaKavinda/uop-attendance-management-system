import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CourseSummary } from '../api/types';
import { Card, ErrorBanner, LoadingGate, Screen, TextField } from '../components/Chrome';

/**
 * Optional: picking courses ahead of time so they pin to the top of the
 * check-in search while running, without typing. Lists every unarchived
 * course campus-wide — unlike the check-in picker, session state plays no
 * part here.
 *
 * Mirrors ui/student/CourseRegistrationScreen.kt.
 */
export function CourseRegistrationScreen({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [registeredIds, setRegisteredIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [catalogRes, registeredRes] = await Promise.all([
        api.courseCatalog(),
        api.registeredCourses(),
      ]);
      if (cancelled) return;
      if (!catalogRes.ok) {
        setError(catalogRes.message);
        setLoading(false);
        return;
      }
      setCourses(catalogRes.data.items ?? []);
      setRegisteredIds(new Set(registeredRes.ok ? registeredRes.data.items ?? [] : []));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // At rest (no query), only registered courses show — this screen is for
  // managing that set, not for browsing the whole catalog. Searching looks
  // across every unarchived course, registered or not, so a course can
  // actually be added.
  const trimmed = query.trim();
  const visible = trimmed
    ? courses.filter((c) =>
        `${c.code} ${c.name} ${c.batch}`.toLowerCase().includes(trimmed.toLowerCase()),
      )
    : courses.filter((c) => registeredIds.has(c._id));

  const toggle = async (course: CourseSummary) => {
    if (pendingId) return;
    const isRegistered = registeredIds.has(course._id);
    setPendingId(course._id);
    setError(null);
    const res = isRegistered
      ? await api.unregisterCourse(course._id)
      : await api.registerCourse(course._id);
    setPendingId(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setRegisteredIds((prev) => {
      const next = new Set(prev);
      if (isRegistered) next.delete(course._id);
      else next.add(course._id);
      return next;
    });
  };

  return (
    <Screen>
      <Card>
        <button
          type="button"
          className="button--link"
          style={{ marginTop: 0, marginLeft: -12 }}
          onClick={onBack}
        >
          ← Back
        </button>
        <h1 className="title">Register for courses</h1>
        <p className="subtitle">Optional. Register for your courses to easily find them.</p>

        {error && (
          <div style={{ marginTop: 14 }}>
            <ErrorBanner message={error} />
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <TextField
            label="Search all courses"
            value={query}
            onChange={setQuery}
            placeholder="Course code or name…"
            type="search"
            inputMode="search"
          />
        </div>

        <div style={{ marginTop: 12 }}>
          {loading ? (
            <LoadingGate message="Loading courses…" />
          ) : visible.length === 0 ? (
            <p className="course__none">
              {trimmed
                ? `No course matches “${trimmed}”.`
                : "You haven't registered any courses yet. Search to add one."}
            </p>
          ) : (
            visible.map((course) => (
              <CourseToggleRow
                key={course._id}
                course={course}
                registered={registeredIds.has(course._id)}
                pending={pendingId === course._id}
                onToggle={() => void toggle(course)}
              />
            ))
          )}
        </div>
      </Card>
    </Screen>
  );
}

function CourseToggleRow({
  course,
  registered,
  pending,
  onToggle,
}: {
  course: CourseSummary;
  registered: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`course${registered ? ' course--selected' : ''}`}
      disabled={pending}
      aria-pressed={registered}
      onClick={onToggle}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="course__code">{course.code}</span>
        <br />
        <span className="course__meta">{course.name}</span>
        <br />
        <span className="course__meta course__meta--batch">{course.batch}</span>
      </span>
      <span className="course__tick" aria-hidden="true">
        {pending ? '…' : registered ? '✓' : ''}
      </span>
    </button>
  );
}
