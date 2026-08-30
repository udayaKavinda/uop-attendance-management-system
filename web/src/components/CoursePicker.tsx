import { useState } from 'react';
import type { RunningCourse } from '../api/types';
import { TextField } from './Chrome';

/** CourseRow in LectureEntryScreen.kt. */
function CourseRow({
  course,
  selected,
  disabled,
  onClick,
}: {
  course: RunningCourse;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`course${selected ? ' course--selected' : ''}`}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="course__code">{course.code}</span>
        <br />
        <span className="course__meta">{course.name}</span>
        <br />
        <span className="course__meta course__meta--batch">{course.batch}</span>
      </span>
      <span className="course__tick" aria-hidden="true">
        {selected ? '✓' : ''}
      </span>
    </button>
  );
}

/**
 * Search-as-you-type picker over currently-running sessions only — the
 * campus-wide list has no enrolment filter, so this keeps it usable when many
 * courses are live at once instead of scrolling a plain list.
 */
export function CoursePicker({
  courses,
  selectedId,
  disabled,
  onSelect,
}: {
  courses: RunningCourse[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (courseId: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const selected = courses.find((c) => c._id === selectedId);

  if (selected) {
    return (
      <CourseRow
        course={selected}
        selected
        disabled={disabled}
        onClick={() => {
          onSelect(null);
          setQuery('');
        }}
      />
    );
  }

  const trimmed = query.trim();
  const matches = trimmed
    ? courses.filter((c) =>
        `${c.code} ${c.name} ${c.batch}`.toLowerCase().includes(trimmed.toLowerCase()),
      )
    : [];

  return (
    <>
      <TextField
        label="Search your lecture"
        value={query}
        onChange={setQuery}
        disabled={disabled}
        placeholder="Course code or name…"
        type="search"
        inputMode="search"
      />
      {/* A true dropdown: nothing shows until the student actually searches,
          rather than dumping the whole running-courses list under the field. */}
      {trimmed &&
        (matches.length === 0 ? (
          <p className="course__none">No running lecture matches “{trimmed}”.</p>
        ) : (
          <div style={{ marginTop: 8 }}>
            {matches.slice(0, 20).map((course) => (
              <CourseRow
                key={course._id}
                course={course}
                selected={false}
                disabled={disabled}
                onClick={() => {
                  onSelect(course._id);
                  setQuery('');
                }}
              />
            ))}
          </div>
        ))}
    </>
  );
}
