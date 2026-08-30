import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { GpsFix, RunningCourse } from '../api/types';
import { LocationUnavailableError, watchFixes } from '../geo/watchFixes';
import { keepScreenAwake } from '../platform/wakeLock';
import type { ScreenLock } from '../platform/wakeLock';

/** Where the student is in the single check-in attempt. */
export type CheckInPhase = 'idle' | 'preparing' | 'checking';

/** The server's verdict, as far as the student is allowed to know it. */
export type Outcome = 'none' | 'present' | 'flagged';

export const WINDOW_SECONDS = 90;

export interface CheckInState {
  courses: RunningCourse[];
  selectedCourseId: string | null;
  phase: CheckInPhase;
  outcome: Outcome;
  /** Countdown shown during the window, purely cosmetic. */
  secondsLeft: number;
  /** True once the window elapsed without a pass: offer Try again / Get help. */
  needsHelp: boolean;
  helpDialogOpen: boolean;
  helpSubmitting: boolean;
  helpError: string | null;
  error: string | null;
  checkingStatus: boolean;
  /** Courses this student registered ahead of time — see useCourseRegistration usage in CoursePicker. */
  registeredIds: Set<string>;
}

const INITIAL: CheckInState = {
  courses: [],
  selectedCourseId: null,
  phase: 'idle',
  outcome: 'none',
  secondsLeft: 0,
  needsHelp: false,
  helpDialogOpen: false,
  helpSubmitting: false,
  helpError: null,
  error: null,
  checkingStatus: false,
  registeredIds: new Set(),
};

const outcomeOf = (status: string | undefined): Outcome => {
  switch (status) {
    case 'present':
    case 'accepted':
      return 'present';
    case 'flagged':
      return 'flagged';
    default:
      return 'none';
  }
};

const COURSE_POLL_MS = 10_000;

/**
 * One attempt = one 90-second window streaming GPS fixes. The client never
 * learns *why* it failed — the server answers "collecting" for both "still
 * gathering fixes" and "gathered enough but you are too far away" — so all this
 * can conclude when the window ends is "not verified", and offer the lecturer's
 * code as the way out.
 *
 * The native app runs Bluetooth alongside GPS and either can win. No iOS browser
 * can read a BLE beacon, so here GPS is the only automatic path; everything else
 * about the attempt — its length, its states, and what the student is told —
 * is deliberately identical.
 */
export function useCheckIn() {
  const [state, setState] = useState<CheckInState>(INITIAL);

  // The window's teardown handles, kept in refs so the async loops below can be
  // cancelled from anywhere without being part of React's render cycle.
  const watchRef = useRef<{ stop: () => void } | null>(null);
  const tickerRef = useRef<number | null>(null);
  const screenLockRef = useRef<ScreenLock | null>(null);
  const settledRef = useRef(false);
  const attemptIdRef = useRef(0);

  const patch = useCallback((next: Partial<CheckInState>) => {
    setState((s) => ({ ...s, ...next }));
  }, []);

  const stopWindow = useCallback(() => {
    attemptIdRef.current += 1;
    watchRef.current?.stop();
    watchRef.current = null;
    if (tickerRef.current !== null) window.clearInterval(tickerRef.current);
    tickerRef.current = null;
    screenLockRef.current?.release();
    screenLockRef.current = null;
  }, []);

  // ── Course list ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const res = await api.runningCourses();
      if (cancelled) return;
      if (!res.ok) {
        setState((s) => ({ ...s, error: res.message }));
        return;
      }
      setState((s) => {
        const items = res.data.items ?? [];
        const stillRunning =
          s.selectedCourseId === null || items.some((c) => c._id === s.selectedCourseId);
        return {
          ...s,
          courses: items,
          error: null,
          selectedCourseId: stillRunning ? s.selectedCourseId : null,
          outcome: stillRunning ? s.outcome : 'none',
          needsHelp: stillRunning ? s.needsHelp : false,
        };
      });
    };

    void poll();
    const id = window.setInterval(poll, COURSE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ── Course registration ────────────────────────────────────────────────────
  // Registration is edited on a separate screen (CourseRegistrationScreen), so
  // this hook only needs to (re)fetch the set — once on mount, and again
  // whenever the student returns from that screen.

  const refreshRegistered = useCallback(async () => {
    const res = await api.registeredCourses();
    if (res.ok) {
      setState((s) => ({ ...s, registeredIds: new Set(res.data.items ?? []) }));
    }
  }, []);

  useEffect(() => {
    void refreshRegistered();
  }, [refreshRegistered]);

  // ── Selection ──────────────────────────────────────────────────────────────

  /** Picks up a record made earlier — including one already marked flagged. */
  const refreshStatus = useCallback(
    async (courseId: string) => {
      patch({ checkingStatus: true });
      const res = await api.attendanceStatus(courseId);
      if (res.ok) {
        patch({ outcome: outcomeOf(res.data.status), checkingStatus: false });
      } else {
        patch({ error: res.message, checkingStatus: false });
      }
    },
    [patch],
  );

  const selectCourse = useCallback(
    (courseId: string | null) => {
      stopWindow();
      settledRef.current = false;
      setState((s) => ({
        ...s,
        selectedCourseId: courseId,
        phase: 'idle',
        outcome: 'none',
        needsHelp: false,
        error: null,
        helpError: null,
        secondsLeft: 0,
      }));
      if (courseId) void refreshStatus(courseId);
    },
    [refreshStatus, stopWindow],
  );

  // ── The 90-second window ───────────────────────────────────────────────────

  const onAccepted = useCallback(() => {
    settledRef.current = true;
    stopWindow();
    setState((s) => ({
      ...s,
      phase: 'idle',
      outcome: 'present',
      needsHelp: false,
      helpDialogOpen: false,
      error: null,
      secondsLeft: 0,
    }));
  }, [stopWindow]);

  const startCheckIn = useCallback(() => {
    const courseId = state.selectedCourseId;
    if (!courseId) {
      patch({ error: 'Select your course first.' });
      return;
    }
    if (state.phase !== 'idle') return;

    stopWindow();
    settledRef.current = false;
    const attemptId = attemptIdRef.current;
    const isCurrent = () => attemptIdRef.current === attemptId && !settledRef.current;

    setState((s) => ({
      ...s,
      phase: 'preparing',
      error: null,
      needsHelp: false,
      secondsLeft: WINDOW_SECONDS,
    }));

    /**
     * Anything other than "accepted" is treated as "keep trying" — including the
     * server's deliberately ambiguous "collecting". Transport errors are ignored
     * for the same reason: the window, not any single request, decides.
     */
    const submitFix = async (fix: GpsFix) => {
      if (!isCurrent()) return;
      // The first fix arriving is what turns "getting ready" into "confirming":
      // before that, iOS is still showing its permission sheet or warming up.
      setState((s) => (s.phase === 'preparing' ? { ...s, phase: 'checking' } : s));
      const res = await api.recordAttendance({ courseId, fix, canAdvertise: false });
      if (!isCurrent()) return;
      if (res.ok && res.data.status === 'accepted') onAccepted();
    };

    watchRef.current = watchFixes(
      (fix) => void submitFix(fix),
      (error: LocationUnavailableError) => {
        if (!isCurrent()) return;
        // Location is the only automatic path this client has, so losing it ends
        // the attempt immediately rather than running out a silent 90 seconds.
        stopWindow();
        setState((s) => ({
          ...s,
          phase: 'idle',
          needsHelp: true,
          secondsLeft: 0,
          error: `${error.message} Ask your lecturer for the code.`,
        }));
      },
    );

    // iOS suspends timers whenever the screen locks or the tab goes to the
    // background, so a self-decrementing counter would drift and a lone
    // setTimeout could fire long after the window should have closed. Both the
    // countdown and the deadline are therefore derived from wall-clock time,
    // which self-corrects the moment the page is resumed.
    const endsAt = Date.now() + WINDOW_SECONDS * 1000;
    tickerRef.current = window.setInterval(() => {
      if (!isCurrent()) return;
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (remaining > 0) {
        setState((s) => (s.secondsLeft === remaining ? s : { ...s, secondsLeft: remaining }));
        return;
      }
      stopWindow();
      setState((s) => ({ ...s, phase: 'idle', needsHelp: true, secondsLeft: 0 }));
    }, 500);

    // The window depends on geolocation callbacks, which stop arriving the
    // moment the screen sleeps — exactly the false failure the native app
    // avoids by holding the display on.
    screenLockRef.current = keepScreenAwake();
  }, [onAccepted, patch, state.phase, state.selectedCourseId, stopWindow]);

  const cancelCheckIn = useCallback(() => {
    stopWindow();
    setState((s) =>
      s.phase === 'idle' ? s : { ...s, phase: 'idle', secondsLeft: 0 },
    );
  }, [stopWindow]);

  const tryAgain = useCallback(() => {
    patch({ needsHelp: false, error: null });
  }, [patch]);

  // ── "Get help": the lecturer's code ────────────────────────────────────────

  const openHelp = useCallback(() => patch({ helpDialogOpen: true, helpError: null }), [patch]);
  const dismissHelp = useCallback(() => patch({ helpDialogOpen: false, helpError: null }), [patch]);

  const submitHelpCode = useCallback(
    async (code: string) => {
      const courseId = state.selectedCourseId;
      if (!courseId) return;
      const trimmed = code.trim();
      if (!/^[0-9]{8}$/.test(trimmed)) {
        patch({ helpError: 'Enter the 8-digit code your lecturer read out.' });
        return;
      }
      stopWindow();
      patch({ helpSubmitting: true, helpError: null });

      const res = await api.recordAttendance({ courseId, code: trimmed, canAdvertise: false });
      if (!res.ok) {
        patch({ helpSubmitting: false, helpError: res.message });
        return;
      }
      const outcome = outcomeOf(res.data.status);
      settledRef.current = outcome !== 'none';
      setState((s) => ({
        ...s,
        helpSubmitting: false,
        helpDialogOpen: outcome === 'none',
        helpError: outcome === 'none' ? 'That code was not accepted.' : null,
        outcome,
        needsHelp: outcome === 'none',
        phase: 'idle',
        secondsLeft: 0,
      }));
    },
    [patch, state.selectedCourseId, stopWindow],
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  const markAnotherCourse = useCallback(() => {
    stopWindow();
    settledRef.current = false;
    setState((s) => ({ ...s, ...INITIAL, courses: s.courses }));
  }, [stopWindow]);

  const dismissError = useCallback(() => patch({ error: null }), [patch]);

  useEffect(() => stopWindow, [stopWindow]);

  const running = state.phase === 'preparing' || state.phase === 'checking';
  const busy = running || state.checkingStatus;

  return {
    state,
    running,
    busy,
    startCheckIn,
    cancelCheckIn,
    selectCourse,
    tryAgain,
    openHelp,
    dismissHelp,
    submitHelpCode,
    markAnotherCourse,
    dismissError,
    refreshRegistered,
  };
}
