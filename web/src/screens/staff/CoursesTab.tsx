import { useState } from 'react';
import type { Course, Lecturer } from '../../api/types';
import { Card, EmptyState, ListLoading, PrimaryButton, TextField } from '../../components/Chrome';
import {
  LoadMoreRow,
  PillButton,
  SectionHeader,
  StatusBadge,
} from '../../components/StaffChrome';
import type { StaffApi } from '../../hooks/useStaffDashboard';

/** Course code: capital letters and numbers only, typed lowercase becomes capital. */
function sanitizeCourseCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const BATCH_RE = /^E\d{2}$/;

/**
 * Continuous multi-batch entry, re-derived from the whole field on every
 * keystroke — a direct port of formatBatchStream in StaffDashboardScreen.kt.
 *
 * A group starts on a comma/space, on a second `E` after digits (an explicit new
 * group even with no delimiter), or once the current group already has 2 digits
 * and another digit arrives (auto-chunking plain continuous digits, e.g. "2324"
 * -> "E23 , E24"). Being a pure function of the current text rather than an
 * incremental commit-and-clear, backspace and mid-string editing just re-derive
 * from the shorter or changed text.
 */
function formatBatchStream(raw: string): string {
  const groups: string[] = [];
  let digits = '';
  let groupStarted = false;

  const flushGroup = () => {
    if (groupStarted) groups.push(digits);
    digits = '';
    groupStarted = false;
  };

  for (const ch of raw.toUpperCase()) {
    if (ch === ',' || ch === ' ') {
      flushGroup();
    } else if (ch === 'E') {
      if (groupStarted && digits.length > 0) flushGroup();
      groupStarted = true;
    } else if (ch >= '0' && ch <= '9') {
      if (digits.length >= 2) flushGroup();
      groupStarted = true;
      digits += ch;
    }
  }
  flushGroup();

  return groups.map((g) => `E${g}`).join(' , ');
}

/** Parses the field's text into the complete + valid `EXX` batches for submission. */
function parseBatches(fieldText: string): string[] {
  const seen = fieldText
    .split(',')
    .map((s) => s.trim())
    .filter((s) => BATCH_RE.test(s));
  return Array.from(new Set(seen));
}

/**
 * True if any comma-separated group is non-empty but not a complete `EXX` batch
 * (e.g. a trailing "E2" with one digit) — [parseBatches] silently drops exactly
 * these, which would otherwise let a course get created missing a batch the user
 * thought they had typed.
 */
function hasIncompleteBatch(fieldText: string): boolean {
  return fieldText
    .split(',')
    .map((s) => s.trim())
    .some((s) => s.length > 0 && !BATCH_RE.test(s));
}

// Archived (disabled) courses fall to the bottom, active ones stay code/batch ordered.
function sortedForDisplay(courses: Course[]): Course[] {
  return [...courses].sort((a, b) => {
    const archived = Number(a.active === false) - Number(b.active === false);
    if (archived !== 0) return archived;
    const code = (a.code ?? '').localeCompare(b.code ?? '');
    if (code !== 0) return code;
    return (a.batch ?? '').localeCompare(b.batch ?? '');
  });
}

export function CoursesTab({
  staff,
  onOpenMatrix,
}: {
  staff: StaffApi;
  onOpenMatrix: (courseId: string) => void;
}) {
  const { state } = staff;
  const [code, setCode] = useState('');
  const [batchText, setBatchText] = useState('');
  const [name, setName] = useState('');
  const [ownersFor, setOwnersFor] = useState<Course | null>(null);

  const batches = parseBatches(batchText);
  const batchIncomplete = hasIncompleteBatch(batchText);
  const visibleCourses = sortedForDisplay(state.courses);

  return (
    <div className="stack">
      <Card>
        <SectionHeader icon="🎓" title="Add course" />
        <TextField
          label="Course code"
          value={code}
          onChange={(v) => setCode(sanitizeCourseCode(v))}
          placeholder="CS101"
        />
        <TextField
          label="Batch"
          value={batchText}
          onChange={(v) => setBatchText(formatBatchStream(v))}
          placeholder="E23 , E24"
        />
        {batchIncomplete && (
          <p className="hint hint--warn">
            Finish or remove the incomplete batch — each one needs two digits.
          </p>
        )}
        <TextField
          label="Course name"
          value={name}
          onChange={setName}
          placeholder="Intro to Computing"
        />
        <PrimaryButton
          text="Add course"
          disabled={batches.length === 0 || batchIncomplete}
          onClick={() => {
            void staff.createCourse(code, batches, name);
            setCode('');
            setBatchText('');
            setName('');
          }}
        />
      </Card>

      {visibleCourses.length === 0 && state.loading ? (
        <ListLoading text="Loading courses…" />
      ) : visibleCourses.length === 0 ? (
        <EmptyState icon="📚" title="No courses" text="Add a course above to get started." />
      ) : (
        <>
          {visibleCourses.map((course) => (
            <CourseCard
              key={course._id ?? `${course.code}-${course.batch}`}
              course={course}
              onOpen={() => course._id && onOpenMatrix(course._id)}
              onOwners={() => setOwnersFor(course)}
              onArchiveToggle={() => {
                if (!course._id) return;
                if (course.active === false) void staff.enableCourse(course._id);
                else void staff.disableCourse(course._id);
              }}
            />
          ))}
          {state.coursesHasMore && (
            <LoadMoreRow loading={state.coursesLoadingMore} onClick={() => void staff.loadMoreCourses()} />
          )}
        </>
      )}

      {ownersFor && (
        <OwnersDialog
          course={ownersFor}
          staff={staff}
          onSave={(ids) => {
            if (ownersFor._id) void staff.assignLecturers(ownersFor._id, ids);
            setOwnersFor(null);
          }}
          onDismiss={() => setOwnersFor(null)}
        />
      )}
    </div>
  );
}

function CourseCard({
  course,
  onOpen,
  onOwners,
  onArchiveToggle,
}: {
  course: Course;
  onOpen: () => void;
  onOwners: () => void;
  onArchiveToggle: () => void;
}) {
  const archived = course.active === false;
  const owners = (course.lecturers ?? [])
    .map((l) => l.name || l.email)
    .filter(Boolean)
    .join(', ');

  return (
    <div className={`course-card${archived ? ' course-card--archived' : ''}`}>
      <button type="button" className="course-card__head" onClick={onOpen}>
        <div className="course-card__title-row">
          <span className="course-card__title">
            {course.code ?? ''} &nbsp;·&nbsp; {course.batch ?? ''}
          </span>
          {archived && <StatusBadge text="Archived" tone="warning" />}
        </div>
        <div className="course-card__name">{course.name ?? ''}</div>
        {owners && <div className="course-card__owners">Owners: {owners}</div>}
      </button>
      <div className="course-card__actions">
        {/* A course only ever appears here for an owning lecturer or an admin —
            both may add and remove owners. */}
        <PillButton text="Owners" tone="accent" onClick={onOwners} />
        <PillButton
          text={archived ? 'Unarchive' : 'Archive'}
          tone={archived ? 'success' : 'warning'}
          onClick={onArchiveToggle}
        />
      </div>
    </div>
  );
}

function OwnersDialog({
  course,
  staff,
  onSave,
  onDismiss,
}: {
  course: Course;
  staff: StaffApi;
  onSave: (lecturerIds: string[]) => void;
  onDismiss: () => void;
}) {
  const [owners, setOwners] = useState<Lecturer[]>(course.lecturers ?? []);
  const [query, setQuery] = useState('');
  const { lecturerSearchResults, lecturerSearchLoading } = staff.state;

  const add = (lecturer: Lecturer) => {
    if (!lecturer._id || owners.some((o) => o._id === lecturer._id)) return;
    setOwners([...owners, lecturer]);
    setQuery('');
    staff.searchLecturers('');
  };

  return (
    <div className="dialog__scrim" role="presentation" onClick={onDismiss}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Course owners"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__title">Owners</div>
        <p className="dialog__body">
          {course.code} · {course.batch}
        </p>

        <div className="owner-list">
          {owners.length === 0 && <p className="hint">No owners yet.</p>}
          {owners.map((o) => (
            <div key={o._id} className="owner-row">
              <span className="owner-row__name">{o.name || o.email}</span>
              <button
                type="button"
                className="owner-row__remove"
                aria-label={`Remove ${o.name || o.email}`}
                onClick={() => setOwners(owners.filter((x) => x._id !== o._id))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <TextField
          label="Add owner"
          value={query}
          type="search"
          inputMode="search"
          placeholder="Search by name or email…"
          onChange={(v) => {
            setQuery(v);
            staff.searchLecturers(v);
          }}
        />
        {lecturerSearchLoading && <p className="hint">Searching…</p>}
        {lecturerSearchResults.length > 0 && (
          <div className="search-results">
            {lecturerSearchResults.map((l) => (
              <button key={l._id} type="button" className="search-result" onClick={() => add(l)}>
                <span className="search-result__name">{l.name || '—'}</span>
                <span className="search-result__email">{l.email}</span>
              </button>
            ))}
          </div>
        )}

        <div className="dialog__actions">
          <button type="button" className="dialog__action dialog__action--muted" onClick={onDismiss}>
            Cancel
          </button>
          <button
            type="button"
            className="dialog__action"
            onClick={() => onSave(owners.map((o) => o._id).filter((id): id is string => !!id))}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
