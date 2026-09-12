import { useEffect, useState } from 'react';
import type { ManualCodeStatus, StaffSession } from '../../api/types';
import { EmptyState, TextField } from '../../components/Chrome';
import {
  ConfirmDialog,
  LoadMoreRow,
  SessionActionButton,
  SessionMetaChip,
  SessionNotice,
  SessionStatePill,
} from '../../components/StaffChrome';
import {
  bleEnabled,
  isBroadcastingOnServer,
  stageOf,
  type SessionStage,
  type StaffApi,
} from '../../hooks/useStaffDashboard';

export function SessionsTab({ staff }: { staff: StaffApi }) {
  const { state } = staff;
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<StaffSession | null>(null);

  const filtered = state.sessions.filter((s) => {
    const hay = `${s.course?.code} ${s.lectureDay} ${s.startTime} ${s.endTime} ${
      s.recurring === true ? 'recurring' : 'one-time'
    }`;
    return hay.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <div className="stack">
      <TextField
        label="Search sessions"
        value={query}
        onChange={setQuery}
        type="search"
        inputMode="search"
        placeholder="Course, time, or type…"
      />

      {filtered.length === 0 ? (
        <EmptyState icon="🗓️" title="No sessions" text="Create a session to see it here." />
      ) : (
        <>
          {filtered.map((session) => (
            <SessionCard
              key={session._id ?? `${session.course?.code}-${session.startTime}`}
              session={session}
              stage={stageOf(state, session)}
              liveOnServer={isBroadcastingOnServer(state, session)}
              bleOn={bleEnabled(state)}
              manualCode={session._id ? state.manualCodes[session._id] : undefined}
              buildingNames={state.geofences
                .filter((g) => g._id && (session.buildings ?? []).includes(g._id))
                .map((g) => g.name ?? '')
                .filter((n) => n.trim() !== '')}
              onCollect={() => session._id && void staff.collect(session._id)}
              onDeactivate={() => session._id && void staff.deactivate(session._id)}
              onDelete={() => setConfirmDelete(session)}
              onLoadManualCode={() => session._id && void staff.loadManualCode(session._id)}
              onPauseManualCode={() => session._id && void staff.pauseManualCode(session._id)}
              onResumeManualCode={() => session._id && void staff.resumeManualCode(session._id)}
              onRegenerateManualCode={() =>
                session._id && void staff.regenerateManualCode(session._id)
              }
            />
          ))}
          {state.sessionsHasMore && query.trim() === '' && (
            <LoadMoreRow
              loading={state.sessionsLoadingMore}
              onClick={() => void staff.loadMoreSessions()}
            />
          )}
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete session?"
          message={`Delete ${confirmDelete.course?.code ?? 'this session'} on ${
            confirmDelete.lectureDay ?? 'its scheduled day'
          } at ${confirmDelete.startTime ?? 'the scheduled time'}?`}
          confirmLabel="Delete"
          onConfirm={() => {
            if (confirmDelete._id) void staff.deleteSession(confirmDelete._id);
            setConfirmDelete(null);
          }}
          onDismiss={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

/**
 * Mirrors SessionCard in StaffDashboardScreen.kt, minus everything that reads
 * the local radio.
 *
 * Android has a third state here — `liveHere`, "this very device is on the air",
 * read from BroadcastService. On web that is permanently false: no browser can
 * advertise as a BLE peripheral, and this client never claims to (see the staff
 * block in api/client.ts). So the card renders the two remaining states, both of
 * which already exist natively and needed no new copy:
 *
 *   - a colleague's Android phone is broadcasting -> "Broadcasting from another device."
 *   - nobody is                                   -> "Verifying by GPS. No one is broadcasting Bluetooth yet."
 *
 * `Collecting` here means GPS is verifying every student, which is true and
 * unaffected by whether any radio is on — exactly as it is on Android.
 */
function SessionCard({
  session,
  stage,
  liveOnServer,
  bleOn,
  manualCode,
  buildingNames,
  onCollect,
  onDeactivate,
  onDelete,
  onLoadManualCode,
  onPauseManualCode,
  onResumeManualCode,
  onRegenerateManualCode,
}: {
  session: StaffSession;
  stage: SessionStage;
  liveOnServer: boolean;
  bleOn: boolean;
  manualCode?: ManualCodeStatus;
  buildingNames: string[];
  onCollect: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onLoadManualCode: () => void;
  onPauseManualCode: () => void;
  onResumeManualCode: () => void;
  onRegenerateManualCode: () => void;
}) {
  const collecting = stage === 'collecting';
  const liveAnywhere = collecting && liveOnServer;
  const buildingLabel =
    buildingNames.length > 0
      ? buildingNames.join(', ')
      : (session.buildings ?? []).length > 0
        ? `${(session.buildings ?? []).length} buildings`
        : null;

  return (
    <div className={`session-card session-card--${stage}`}>
      <div className="session-card__head">
        <div className={`session-card__icon${collecting ? ' session-card__icon--live' : ''}`}>
          🕘
        </div>
        <div className="session-card__titles">
          <div className="session-card__code">{session.course?.code ?? 'Untitled course'}</div>
          <div className="session-card__meta">
            {[session.course?.name, session.course?.batch].filter(Boolean).join(' · ') ||
              'Course session'}
          </div>
        </div>
        <SessionStatePill stage={stage} />
      </div>

      <div className="session-card__schedule">
        <div className="session-card__when">
          <span aria-hidden="true">📅</span>
          <strong>{session.lectureDay ?? '—'}</strong>
          <span aria-hidden="true">🕘</span>
          <strong>
            {session.startTime ?? '—'} – {session.endTime ?? '—'}
          </strong>
        </div>
        <div className="session-card__chips">
          <SessionMetaChip
            icon={session.recurring === true ? '🔁' : '📅'}
            text={session.recurring === true ? 'Weekly' : 'One-time'}
          />
          {buildingLabel && <SessionMetaChip icon="📍" text={buildingLabel} />}
        </div>
      </div>

      {collecting ? (
        <div className="collecting">
          <div className="collecting__head">
            <span className="collecting__dot" aria-hidden="true" />
            COLLECTING ATTENDANCE
          </div>
          <div className="collecting__body">
            {liveAnywhere
              ? 'Broadcasting from another device.'
              : 'Verifying by GPS. No one is broadcasting Bluetooth yet.'}
          </div>
          <div className="collecting__foot">
            {liveAnywhere || bleOn
              ? 'Deactivate below to stop collecting for everyone.'
              : 'Bluetooth is off system-wide — GPS keeps collecting regardless.'}
          </div>
        </div>
      ) : stage === 'withinSession' ? (
        <SessionNotice
          text={
            bleOn
              ? 'This session is within its scheduled window. Tap Collect below to start collecting attendance.'
              : 'This session is within its scheduled window. Bluetooth is off system-wide — Collect will verify by GPS only.'
          }
        />
      ) : (
        <SessionNotice text="This session is outside its scheduled window. Collect becomes available once it opens." />
      )}

      <ManualCodeSection
        status={manualCode}
        collecting={collecting}
        onLoad={onLoadManualCode}
        onPause={onPauseManualCode}
        onResume={onResumeManualCode}
        onRegenerate={onRegenerateManualCode}
      />

      <hr className="rule" />
      <div className="session-card__actions">
        {/* "Collect" starts collecting (Within-session -> Collecting). Android
            offers "Join" here once someone else is collecting, because joining
            also starts that phone's radio; with no radio to start, joining would
            do nothing, so the button simply reports the state instead. */}
        <SessionActionButton
          text={collecting ? 'Collecting' : 'Collect'}
          icon="▶"
          tone="success"
          disabled={stage !== 'withinSession'}
          onClick={onCollect}
        />
        {collecting ? (
          <SessionActionButton text="Deactivate" icon="⏸" tone="neutral" onClick={onDeactivate} />
        ) : (
          <SessionActionButton text="Delete" icon="🗑" tone="danger" onClick={onDelete} />
        )}
      </div>
    </div>
  );
}

/** Mirrors ManualCodeSection — every session has a code; only rotation is a choice. */
function ManualCodeSection({
  status,
  collecting,
  onLoad,
  onPause,
  onResume,
  onRegenerate,
}: {
  status?: ManualCodeStatus;
  collecting: boolean;
  onLoad: () => void;
  onPause: () => void;
  onResume: () => void;
  onRegenerate: () => void;
}) {
  // Reloads the moment a session enters Collecting, rather than waiting for
  // whatever unrelated re-render happens to come next.
  useEffect(() => {
    onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collecting]);

  return (
    <div className="code-panel">
      <div className="code-panel__head">
        <span aria-hidden="true">🔑</span>
        Attendance code
      </div>
      <p className="hint">Read this out when a student can't be verified automatically.</p>

      {status == null ? (
        <p className="hint">Loading code…</p>
      ) : status.running !== true ? (
        // `running` is the server's isWithinScheduleWindow, which requires the
        // session to be ACTIVE as well as in its window — so this also shows for
        // a session sitting in its window waiting for Collect, where "during the
        // scheduled session window" is untrue and leaves the lecturer waiting for
        // a code that will never appear on its own.
        <p className="hint">The code appears once you tap Collect, inside the session&rsquo;s scheduled window.</p>
      ) : status.code == null ? null : (
        <>
          <div className="code-box">
            <div className="code-box__value">
              <div className="code-box__digits">
                {status.code.slice(0, 4)}&nbsp;&nbsp;{status.code.slice(4)}
              </div>
              <div className={`code-box__status${status.paused === true ? ' code-box__status--paused' : ''}`}>
                {status.paused === true
                  ? 'Rotation paused'
                  : status.rotationMode === 'interval' && status.rotatesIn != null
                    ? `Next rotation in ${status.rotatesIn}s`
                    : 'Current attendance code'}
              </div>
            </div>
            <button
              type="button"
              className="code-box__regen"
              aria-label="New code"
              onClick={onRegenerate}
            >
              🔁
            </button>
          </div>
          {status.rotationMode === 'interval' && (
            <SessionActionButton
              text={status.paused === true ? 'Resume rotation' : 'Pause rotation'}
              icon={status.paused === true ? '▶' : '⏸'}
              tone={status.paused === true ? 'success' : 'neutral'}
              onClick={status.paused === true ? onResume : onPause}
            />
          )}
        </>
      )}
    </div>
  );
}
