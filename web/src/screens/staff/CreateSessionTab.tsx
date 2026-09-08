import { useState } from 'react';
import { Card, ErrorBanner, PrimaryButton } from '../../components/Chrome';
import { LabeledSelect, SectionHeader } from '../../components/StaffChrome';
import type { StaffApi } from '../../hooks/useStaffDashboard';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * Mirrors CreateSessionTab in StaffDashboardScreen.kt.
 *
 * There is no verification-mode picker: every session uses Bluetooth and GPS
 * together. Buildings are what the lecturer chooses instead, and they are
 * mandatory — GPS has nothing to measure against without a polygon.
 *
 * Times use `<input type="time">` rather than a hand-built picker: on iOS that
 * is the same native wheel the Compose TimePicker imitates, and it already
 * emits the "HH:MM" the server expects.
 */
export function CreateSessionTab({ staff }: { staff: StaffApi }) {
  const { state } = staff;
  const activeCourses = state.courses.filter((c) => c.active !== false);

  const [courseId, setCourseId] = useState('');
  const [day, setDay] = useState('MON');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [recurring, setRecurring] = useState(true);
  const [buildingIds, setBuildingIds] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // The lecturer's code exists for every session; the only choice is rotation.
  const [codeRotates, setCodeRotates] = useState(false);
  const [codeSeconds, setCodeSeconds] = useState('60');

  const canCreate = courseId !== '' && start !== '' && end !== '' && buildingIds.length > 0;

  const toggleBuilding = (id: string) => {
    setBuildingIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  return (
    <div className="stack">
      <Card>
        <SectionHeader icon="🕘" title="Create session" />

        <LabeledSelect
          label="Course"
          value={courseId}
          placeholder="Choose a course"
          options={activeCourses.map((c) => ({
            id: c._id ?? '',
            label: `${c.code} · ${c.batch} — ${c.name}`,
          }))}
          onSelect={setCourseId}
        />

        <LabeledSelect
          label="Day"
          value={day}
          placeholder="Day"
          options={DAYS.map((d) => ({ id: d, label: d }))}
          onSelect={setDay}
        />

        <div className="field-row">
          <label className="field">
            <span className="field__label">Start</span>
            <input
              className="input"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">End</span>
            <input
              className="input"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
          />
          <span>Recurring (weekly) session</span>
        </label>

        <hr className="rule" />

        <div className="field__label">Where is this lecture?</div>
        <p className="hint">
          Students are checked against these building outlines. At least one is required.
        </p>
        {state.geofences.length === 0 ? (
          <ErrorBanner message="No buildings have been drawn yet. An administrator needs to add one in the Geofences tool before sessions can be created." />
        ) : (
          <div className="building-list">
            {state.geofences.map((g) => (
              <label key={g._id} className="checkbox">
                <input
                  type="checkbox"
                  checked={g._id != null && buildingIds.includes(g._id)}
                  onChange={() => g._id && toggleBuilding(g._id)}
                />
                <span>{g.name ?? 'Unnamed building'}</span>
              </label>
            ))}
          </div>
        )}

        <hr className="rule" />

        <button
          type="button"
          className="disclosure"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <span className="field__label">Advanced settings</span>
          <span aria-hidden="true">{showAdvanced ? '▴' : '▾'}</span>
        </button>

        {showAdvanced && (
          <div className="stack stack--tight">
            <div className="field__label">Attendance code</div>
            <p className="hint">
              Every session gets an 8-digit code you can read out when a student's phone can't
              verify itself. Rotating it limits how far a shared code travels.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={codeRotates}
                onChange={(e) => setCodeRotates(e.target.checked)}
              />
              <span>Rotate automatically</span>
            </label>
            {codeRotates && (
              <div className="seconds-row">
                <input
                  className="input input--narrow"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={codeSeconds}
                  placeholder="60"
                  onChange={(e) => setCodeSeconds(e.target.value.replace(/\D/g, ''))}
                />
                <span className="hint">sec</span>
              </div>
            )}
          </div>
        )}

        <PrimaryButton
          text="Create session"
          disabled={!canCreate}
          onClick={() => {
            const seconds = Number.parseInt(codeSeconds, 10);
            void staff.createSession(
              courseId,
              day,
              start,
              end,
              recurring,
              buildingIds,
              codeRotates ? 'interval' : 'none',
              Number.isFinite(seconds) ? Math.min(3600, Math.max(10, seconds)) : 60,
            );
          }}
        />
      </Card>
    </div>
  );
}
