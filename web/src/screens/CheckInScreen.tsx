import { Card, EmptyState, ErrorBanner, Screen, TopBar } from '../components/Chrome';
import { CoursePicker } from '../components/CoursePicker';
import { HelpCodeDialog } from '../components/HelpCodeDialog';
import { WINDOW_SECONDS, useCheckIn } from '../hooks/useCheckIn';
import type { CheckInState } from '../hooks/useCheckIn';

/**
 * One screen, one job: get this student marked present.
 *
 * The layout follows the attempt rather than the menu — pick a course, press one
 * button, watch a single progress bar, and land on exactly one of three
 * outcomes. The lecturer's code is deliberately not on the first screen: it only
 * appears once the automatic attempt has actually failed.
 */
export function CheckInScreen({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const checkIn = useCheckIn();
  const { state } = checkIn;

  return (
    <>
      <Screen top={<TopBar email={email} onSignOut={onSignOut} />}>
        <Card>
          {state.outcome === 'present' ? (
            <Outcome
              variant="present"
              emoji="✅"
              title="You're marked present"
              body="Your attendance for this lecture is recorded."
              onDone={checkIn.markAnotherCourse}
            />
          ) : state.outcome === 'flagged' ? (
            <Outcome
              variant="flagged"
              emoji="🕓"
              title="Not confirmed"
              body="We couldn't verify you were in the room. Speak to your lecturer if you think that's a mistake."
              onDone={checkIn.markAnotherCourse}
            />
          ) : state.courses.length === 0 ? (
            <NoLecturesRunning error={state.error} />
          ) : (
            <CheckInBody checkIn={checkIn} />
          )}
        </Card>
      </Screen>

      {state.helpDialogOpen && (
        <HelpCodeDialog
          submitting={state.helpSubmitting}
          error={state.helpError}
          onDismiss={checkIn.dismissHelp}
          onSubmit={checkIn.submitHelpCode}
        />
      )}
    </>
  );
}

function CheckInBody({ checkIn }: { checkIn: ReturnType<typeof useCheckIn> }) {
  const { state, running, busy } = checkIn;

  return (
    <>
      <h1 className="title">Mark your attendance</h1>
      <p className="subtitle">
        Choose your lecture and hold still for a moment while we confirm you're in the room.
      </p>

      {state.error && (
        <div style={{ marginTop: 14 }}>
          <ErrorBanner message={state.error} />
        </div>
      )}

      <p className="label" style={{ marginTop: 18 }}>
        Your running lectures
      </p>

      <CoursePicker
        courses={state.courses}
        selectedId={state.selectedCourseId}
        disabled={busy}
        onSelect={checkIn.selectCourse}
      />

      <div style={{ marginTop: 10 }}>
        {running ? (
          <RunningPanel state={state} onCancel={checkIn.cancelCheckIn} />
        ) : state.needsHelp ? (
          <NeedsHelpPanel
            onTryAgain={() => {
              checkIn.tryAgain();
              checkIn.startCheckIn();
            }}
            onGetHelp={checkIn.openHelp}
          />
        ) : (
          <button
            type="button"
            className="button button--bluetooth"
            disabled={!state.selectedCourseId || busy}
            onClick={checkIn.startCheckIn}
          >
            Check me in
          </button>
        )}
      </div>
    </>
  );
}

/** The single progress surface for the whole 90-second window. */
function RunningPanel({ state, onCancel }: { state: CheckInState; onCancel: () => void }) {
  const elapsed = WINDOW_SECONDS - state.secondsLeft;
  const progress = Math.min(Math.max(elapsed, 0), WINDOW_SECONDS) / WINDOW_SECONDS;

  return (
    <div className="running">
      <div className="dot" aria-hidden="true">
        <div className="dot__inner" />
      </div>
      <div className="running__title">
        {state.phase === 'preparing' ? 'Getting ready…' : "Confirming you're in the room"}
      </div>
      <div className="running__hint">
        Stay where you are. This takes up to {WINDOW_SECONDS} seconds.
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={WINDOW_SECONDS}
        aria-valuenow={elapsed}
      >
        <div className="progress__fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="running__remaining">{state.secondsLeft}s remaining</div>
      <button type="button" className="button--link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/**
 * Shown only after a full window failed. Two ways forward and no explanation of
 * *why* it failed — the app genuinely does not know, and guessing out loud would
 * tell a cheat how far off they are.
 */
function NeedsHelpPanel({
  onTryAgain,
  onGetHelp,
}: {
  onTryAgain: () => void;
  onGetHelp: () => void;
}) {
  return (
    <div className="needshelp">
      <div style={{ fontSize: 28 }} aria-hidden="true">
        🤔
      </div>
      <div className="needshelp__title">We couldn't confirm you're in the lecture</div>
      <div className="needshelp__body">
        Move further inside the room and try once more, or ask your lecturer for the attendance
        code.
      </div>
      <div className="stack">
        <button type="button" className="button button--bluetooth" onClick={onTryAgain}>
          Try again
        </button>
        <button type="button" className="button button--plain" onClick={onGetHelp}>
          Get help
        </button>
      </div>
    </div>
  );
}

function Outcome({
  variant,
  emoji,
  title,
  body,
  onDone,
}: {
  variant: 'present' | 'flagged';
  emoji: string;
  title: string;
  body: string;
  onDone: () => void;
}) {
  return (
    <div className="outcome">
      <div className={`outcome__badge outcome__badge--${variant}`} aria-hidden="true">
        {emoji}
      </div>
      <h1 className="outcome__title">{title}</h1>
      <p className={`outcome__body outcome__body--${variant}`}>{body}</p>
      <button type="button" className="button" onClick={onDone}>
        Mark another lecture
      </button>
    </div>
  );
}

function NoLecturesRunning({ error }: { error: string | null }) {
  return (
    <div>
      {error && (
        <div style={{ marginBottom: 12 }}>
          <ErrorBanner message={error} />
        </div>
      )}
      <EmptyState
        icon="📅"
        title="No lectures running right now"
        text="When one of your sessions starts it appears here automatically. This list refreshes every 10 seconds."
      />
    </div>
  );
}
