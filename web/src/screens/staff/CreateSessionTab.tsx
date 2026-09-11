import { useEffect, useRef, useState } from 'react';
import type { Geofence } from '../../api/types';
import { Card, ErrorBanner, PrimaryButton } from '../../components/Chrome';
import { MapDialog } from '../../components/MapDialog';
import { LabeledSelect, SectionHeader } from '../../components/StaffChrome';
import type { StaffApi } from '../../hooks/useStaffDashboard';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * Mirrors BuildingMultiSelectDropdown in StaffDashboardScreen.kt: a search field
 * that opens a filtered list, plus a removable chip per selection.
 *
 * Only `active !== false` buildings are offered. An archived polygon still gets
 * returned by the geofences endpoint (it is a soft delete), and picking one would
 * create a session GPS can never match against.
 */
function BuildingMultiSelect({
  buildings,
  selectedIds,
  onToggle,
}: {
  buildings: Geofence[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const available = buildings.filter((b) => b.active !== false && b._id != null);
  const filtered = available.filter((b) =>
    (b.name ?? '').toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selected = available.filter((b) => b._id != null && selectedIds.includes(b._id));

  // The native menu dismisses on an outside tap and clears the query with it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="buildings" ref={boxRef}>
      <div className="buildings__head">
        <span className="field__label">Buildings</span>
        {selected.length > 0 && (
          <span className="buildings__count">{selected.length} selected</span>
        )}
      </div>

      <div className="buildings__combo">
        <span className="buildings__search-icon" aria-hidden="true">
          🔍
        </span>
        <input
          className="input buildings__search"
          type="search"
          value={query}
          placeholder="Search and select buildings"
          aria-expanded={open}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        <button
          type="button"
          className="buildings__toggle"
          aria-label={open ? 'Close building list' : 'Open building list'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '▴' : '▾'}
        </button>

        {open && (
          <div className="buildings__menu" role="listbox">
            {filtered.length === 0 ? (
              <p className="buildings__empty">
                {available.length === 0 ? 'No active buildings' : 'No buildings match your search'}
              </p>
            ) : (
              filtered.map((b) => {
                const id = b._id as string;
                const isSelected = selectedIds.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`buildings__option${isSelected ? ' buildings__option--selected' : ''}`}
                    onClick={() => {
                      onToggle(id);
                      setQuery('');
                    }}
                  >
                    <span className="buildings__option-icon" aria-hidden="true">
                      {isSelected ? '✓' : '＋'}
                    </span>
                    <span>
                      <span className="buildings__option-name">
                        {b.name?.trim() ? b.name : 'Unnamed building'}
                      </span>
                      {isSelected && <span className="buildings__option-sub">Selected</span>}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {selected.length === 0 ? (
        <p className="hint">Select one or more buildings for GPS verification.</p>
      ) : (
        <div className="buildings__chips">
          {selected.map((b) => (
            <button
              key={b._id}
              type="button"
              className="buildings__chip"
              aria-label={`Remove ${b.name ?? ''}`}
              onClick={() => b._id && onToggle(b._id)}
            >
              {b.name ?? ''}
              <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [showMap, setShowMap] = useState(false);

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
        <p className="hint hint--spaced">
          Students are checked against these building outlines. At least one is required.{' '}
          <button type="button" className="hint__link" onClick={() => setShowMap(true)}>
            View map
          </button>
        </p>
        {showMap && <MapDialog onDismiss={() => setShowMap(false)} />}
        {state.geofences.length === 0 ? (
          <ErrorBanner message="No buildings have been drawn yet. An administrator needs to add one in the Geofences tool before sessions can be created." />
        ) : (
          <BuildingMultiSelect
            buildings={state.geofences}
            selectedIds={buildingIds}
            onToggle={toggleBuilding}
          />
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
