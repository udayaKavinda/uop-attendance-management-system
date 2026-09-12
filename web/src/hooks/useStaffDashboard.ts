import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type {
  Course,
  Geofence,
  Lecturer,
  ManualCodeConfigReq,
  ManualCodeStatus,
  RunningSession,
  Settings,
  StaffSession,
} from '../api/types';

/**
 * Web counterpart of ui/staff/StaffViewModel.kt, ported state-for-state so the
 * two dashboards behave identically.
 *
 * The one deliberate omission is the whole broadcast half — `startBroadcast`,
 * `reconcileBroadcast`, `broadcastReady`, and the `broadcast` field that mirrors
 * BroadcastService. A browser has no BLE peripheral role, so this client never
 * claims one; see the long note on the staff block in api/client.ts for why
 * claiming it anyway would be actively harmful rather than merely useless.
 *
 * `broadcasting` is still *read* — from the session and running-set payloads —
 * so a lecturer here sees when a colleague's Android phone is on the air.
 */

/**
 * The three session-card stages: `inactive` (out of the scheduled window,
 * regardless of `active`), `withinSession` (in window, nobody has tapped Collect
 * yet), and `collecting` (in window and active — GPS is verifying every student
 * regardless of Bluetooth).
 */
export type SessionStage = 'inactive' | 'withinSession' | 'collecting';

export interface StaffState {
  courses: Course[];
  coursesPage: number;
  coursesHasMore: boolean;
  coursesLoadingMore: boolean;
  sessions: StaffSession[];
  sessionsPage: number;
  sessionsHasMore: boolean;
  sessionsLoadingMore: boolean;
  /** sessionId -> running entry, refreshed every ~10s. */
  running: Record<string, RunningSession>;
  loading: boolean;
  error: string | null;
  flash: string | null;
  /** Per-session code status, fetched on demand when a card renders. */
  manualCodes: Record<string, ManualCodeStatus>;
  /** Global policy; only `bleEnabled` is read, to word the session card. */
  settings: Settings | null;
  /** Building list for the session builder. Read-only on web. */
  geofences: Geofence[];
  lecturerSearchResults: Lecturer[];
  lecturerSearchLoading: boolean;
}

const INITIAL: StaffState = {
  courses: [],
  coursesPage: 1,
  coursesHasMore: false,
  coursesLoadingMore: false,
  sessions: [],
  sessionsPage: 1,
  sessionsHasMore: false,
  sessionsLoadingMore: false,
  running: {},
  loading: false,
  error: null,
  flash: null,
  manualCodes: {},
  settings: null,
  geofences: [],
  lecturerSearchResults: [],
  lecturerSearchLoading: false,
};

/** `active`, preferring the 10s running-poll over the less-fresh full session list. */
export function isActiveOnServer(state: StaffState, session: StaffSession): boolean {
  const id = session._id ?? '';
  const live = state.running[id];
  return live?.active ?? session.active === true;
}

/** In the session's scheduled window right now — regardless of `active`. */
export function isRunning(state: StaffState, sessionId?: string): boolean {
  return sessionId != null && Object.prototype.hasOwnProperty.call(state.running, sessionId);
}

export function stageOf(state: StaffState, session: StaffSession): SessionStage {
  if (!isRunning(state, session._id)) return 'inactive';
  return isActiveOnServer(state, session) ? 'collecting' : 'withinSession';
}

/**
 * Server-side "is this session broadcasting" truth, visible to every viewer.
 * Prefers the running-poll over the session list for the same freshness reason
 * as [isActiveOnServer]: another lecturer's phone can start or stop a broadcast
 * between two full reloads.
 */
export function isBroadcastingOnServer(state: StaffState, session: StaffSession): boolean {
  const id = session._id ?? '';
  const live = state.running[id];
  return live?.broadcasting ?? session.broadcasting === true;
}

export function bleEnabled(state: StaffState): boolean {
  return state.settings?.bleEnabled !== false;
}

/**
 * Lecturers only — administration is Android-only, so there is no admin branch
 * anywhere below (see AdminNoticeScreen).
 */
const POLL_INTERVAL_MS = 10_000;
/** 6 x 10 s = one settings read a minute. */
const SETTINGS_POLL_EVERY_TICKS = 6;

export function useStaffDashboard() {
  const [state, setState] = useState<StaffState>(INITIAL);

  const patch = useCallback((next: Partial<StaffState>) => {
    setState((s) => ({ ...s, ...next }));
  }, []);

  // One action has one outcome, so each setter clears the other. Neither used to,
  // and the error banner is dismissed only by clicking it (StaffDashboard wires
  // clearError to onClick; the flash gets a 2.5s timer, the error gets nothing) —
  // so a session-clash error survived the retry that fixed it, every later action
  // and every tab switch, sitting in red above a green "Session created." The
  // obvious reading of that screen is that the session was not created, so the
  // real cost was lecturers re-creating work that had already succeeded.
  //
  // refresh() below also preserves a stale error and is deliberately left alone:
  // deactivate() calls setError() and then refresh(), so clearing there would
  // swallow the message it had just set. Fixing the setters is enough, because
  // refresh only ever sets an error on failure and so never restores the old one.
  //
  // Mirrors the same fix in the Android client's StaffViewModel.
  const setFlash = useCallback((flash: string) => patch({ flash, error: null }), [patch]);
  const setError = useCallback((error: string) => patch({ error, flash: null }), [patch]);
  const clearFlash = useCallback(() => patch({ flash: null }), [patch]);
  const clearError = useCallback(() => patch({ error: null }), [patch]);

  /** Reloads page 1 of every list. Wrapped by `refresh` below, which also
   *  re-reads the shared settings/geofences. */
  const refreshLists = useCallback(async () => {
    patch({ loading: true });
    const [coursesRes, sessionsRes] = await Promise.all([api.adminCourses(1), api.allSessions(1)]);

    setState((s) => {
      let next: StaffState = { ...s, loading: false };
      if (coursesRes.ok) {
        next = {
          ...next,
          courses: coursesRes.data.items ?? [],
          coursesPage: 1,
          coursesHasMore: coursesRes.data.hasMore === true,
        };
      } else {
        next = { ...next, error: coursesRes.message };
      }
      if (sessionsRes.ok) {
        next = {
          ...next,
          sessions: sessionsRes.data.items ?? [],
          sessionsPage: 1,
          sessionsHasMore: sessionsRes.data.hasMore === true,
        };
      } else {
        next = { ...next, error: sessionsRes.message };
      }
      return next;
    });
  }, [patch]);

  /**
   * Out-of-cycle running-set refresh, so a just-activated session doesn't wait
   * for the next poll tick. Returns false when the session is gone (401) and
   * polling should stop.
   */
  const refreshRunningNow = useCallback(async (): Promise<boolean> => {
    const res = await api.runningSessions();
    if (!res.ok) return res.status !== 401;
    const map: Record<string, RunningSession> = {};
    for (const item of res.data.items ?? []) {
      if (item.sessionId) map[item.sessionId] = item;
    }
    patch({ running: map });
    return true;
  }, [patch]);

  /**
   * Settings and geofences are staff-readable, not admin-only: every lecturer
   * needs the BLE switch to word the card, and the building list to create a
   * session at all.
   *
   * Re-read on every refresh rather than once on mount. Loaded once, they were
   * stale for the life of the dashboard — an admin switching Bluetooth off, or
   * adding a building, changed nothing on a lecturer's already-open page until
   * they reloaded it. Mirrors the same fix in the Android client's StaffViewModel.
   */
  const loadSharedConfig = useCallback(() => {
    void api.settings().then((res) => {
      if (res.ok) patch({ settings: res.data });
      else setError(`Could not load Bluetooth/geofence settings: ${res.message}`);
    });
    void api.geofences().then((res) => {
      if (res.ok) patch({ geofences: res.data.items ?? [] });
      else setError(`Could not load buildings: ${res.message}`);
    });
  }, [patch, setError]);

  const refresh = useCallback(async () => {
    await refreshLists();
    loadSharedConfig();
  }, [refreshLists, loadSharedConfig]);

  // Initial load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Stops on 401 for the same reason the native poll does: this state outlives a
   * sign-out on a shared browser, and a stale poll's 401 landing after a fresh
   * sign-in would force that new session straight back out.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    let ticks = 0;

    const tick = async () => {
      if (cancelled) return;
      const keepGoing = await refreshRunningNow();
      if (cancelled || !keepGoing) return;
      // Every sixth tick, so global settings cannot sit stale on a dashboard
      // nobody is touching. `refresh()` re-reads them too, but it only runs
      // after a mutation, and a lecturer who opens this page and just watches
      // it would otherwise never see an admin switch Bluetooth off. Mirrors the
      // Android StaffViewModel's poll.
      ticks += 1;
      if (ticks % SETTINGS_POLL_EVERY_TICKS === 0) loadSharedConfig();
      timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refreshRunningNow, loadSharedConfig]);

  // ── Courses ────────────────────────────────────────────────────────────────

  const loadMoreCourses = useCallback(async () => {
    if (!state.coursesHasMore || state.coursesLoadingMore) return;
    const nextPage = state.coursesPage + 1;
    patch({ coursesLoadingMore: true });
    const res = await api.adminCourses(nextPage);
    if (res.ok) {
      setState((s) => ({
        ...s,
        courses: [...s.courses, ...(res.data.items ?? [])],
        coursesPage: nextPage,
        coursesHasMore: res.data.hasMore === true,
        coursesLoadingMore: false,
      }));
    } else {
      patch({ coursesLoadingMore: false, error: res.message });
    }
  }, [state.coursesHasMore, state.coursesLoadingMore, state.coursesPage, patch]);

  const createCourse = useCallback(
    async (code: string, batches: string[], name: string) => {
      if (!code.trim() || !name.trim() || batches.length === 0) {
        setError('Course code, at least one batch, and name are required.');
        return;
      }
      const res = await api.createCourse({ name: name.trim(), code: code.trim(), batches });
      if (res.ok) {
        setFlash('Course added.');
        await refresh();
      } else {
        setError(res.message);
      }
    },
    [refresh, setError, setFlash],
  );

  const disableCourse = useCallback(
    async (courseId: string) => {
      const res = await api.disableCourse(courseId);
      if (res.ok) {
        setFlash('Course archived.');
        await refresh();
      } else setError(res.message);
    },
    [refresh, setError, setFlash],
  );

  const enableCourse = useCallback(
    async (courseId: string) => {
      const res = await api.enableCourse(courseId);
      if (res.ok) {
        setFlash('Course unarchived.');
        await refresh();
      } else setError(res.message);
    },
    [refresh, setError, setFlash],
  );

  const assignLecturers = useCallback(
    async (courseId: string, lecturerIds: string[]) => {
      const res = await api.assignLecturers(courseId, lecturerIds);
      if (res.ok) {
        setFlash('Owners updated.');
        await refresh();
      } else setError(res.message);
    },
    [refresh, setError, setFlash],
  );

  // Debounced lecturer lookup, used by the Owners dialog. Not admin-gated: a
  // plain lecturer adding a co-owner to their own course needs it too.
  const searchTimer = useRef<number | undefined>(undefined);
  const searchLecturers = useCallback(
    (query: string) => {
      if (searchTimer.current !== undefined) window.clearTimeout(searchTimer.current);
      const q = query.trim();
      if (q.length < 2) {
        patch({ lecturerSearchResults: [], lecturerSearchLoading: false });
        return;
      }
      searchTimer.current = window.setTimeout(() => {
        patch({ lecturerSearchLoading: true });
        void api.lecturers(q).then((res) => {
          // A failed search used to render as an empty result list, which reads as
          // "no such lecturer" — the opposite of what happened.
          if (!res.ok) setError(`Lecturer search failed: ${res.message}`);
          patch({
            lecturerSearchResults: res.ok ? res.data.items ?? [] : [],
            lecturerSearchLoading: false,
          });
        });
      }, 300);
    },
    [patch, setError],
  );

  // ── Sessions ───────────────────────────────────────────────────────────────

  const loadMoreSessions = useCallback(async () => {
    if (!state.sessionsHasMore || state.sessionsLoadingMore) return;
    const nextPage = state.sessionsPage + 1;
    patch({ sessionsLoadingMore: true });
    const res = await api.allSessions(nextPage);
    if (res.ok) {
      setState((s) => ({
        ...s,
        sessions: [...s.sessions, ...(res.data.items ?? [])],
        sessionsPage: nextPage,
        sessionsHasMore: res.data.hasMore === true,
        sessionsLoadingMore: false,
      }));
    } else {
      patch({ sessionsLoadingMore: false, error: res.message });
    }
  }, [state.sessionsHasMore, state.sessionsLoadingMore, state.sessionsPage, patch]);

  const createSession = useCallback(
    async (
      courseId: string,
      day: string,
      start: string,
      end: string,
      recurring: boolean,
      buildings: string[],
      manualCodeRotationMode: string,
      manualCodeRotationSeconds: number,
    ) => {
      if (!courseId) {
        setError('Choose a course first.');
        return;
      }
      // Mandatory: GPS runs for every session, so without a polygon nobody could
      // ever land in a passing band.
      if (buildings.length === 0) {
        setError('Select at least one building for this session.');
        return;
      }
      const res = await api.createSession(courseId, {
        lectureDay: day.toUpperCase(),
        startTime: start,
        endTime: end,
        recurring,
        buildings,
        manualCodeRotationMode,
        manualCodeRotationSeconds,
      });
      if (res.ok) {
        // The server names the date it derived for a one-time session — the create
        // form only takes a weekday, so "MON" can mean today or a week out and this
        // is the lecturer's only chance to catch the wrong one. Falls back to the
        // generic line if the server predates the field.
        setFlash(res.data.message || 'Session created.');
        await refresh();
      } else {
        setError(res.message);
      }
    },
    [refresh, setError, setFlash],
  );

  /**
   * "Collect" (Within-session → Collecting). On Android this same call also
   * doubles as "Join"/start-broadcast; here it only ever flips the server's
   * `active` flag, so a web lecturer starts GPS collection without ever
   * claiming a radio.
   */
  const collect = useCallback(
    async (sessionId: string) => {
      const res = await api.activateSession(sessionId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setFlash('Collecting attendance.');
      // Optimistic: flips the stage to Collecting immediately instead of reading
      // Within-session for one more round trip.
      setState((s) => ({
        ...s,
        sessions: s.sessions.map((x) => (x._id === sessionId ? { ...x, active: true } : x)),
        running: Object.fromEntries(
          Object.entries(s.running).map(([id, r]) => [
            id,
            id === sessionId ? { ...r, active: true } : r,
          ]),
        ),
      }));
      await refresh();
      await refreshRunningNow();
    },
    [refresh, refreshRunningNow, setError, setFlash],
  );

  /**
   * Ends Collecting. Does NOT necessarily leave the scheduled window — it lands
   * on Within-session if the window is still open, so the optimistic update
   * flips `active` on the existing running entry rather than removing it.
   */
  const deactivate = useCallback(
    async (sessionId: string) => {
      setState((s) => ({
        ...s,
        sessions: s.sessions.map((x) =>
          x._id === sessionId ? { ...x, active: false, broadcasting: false } : x,
        ),
        running: Object.fromEntries(
          Object.entries(s.running).map(([id, r]) => [
            id,
            id === sessionId ? { ...r, active: false, broadcasting: false } : r,
          ]),
        ),
      }));
      const res = await api.deactivateSession(sessionId);
      if (res.ok) setFlash('Session deactivated.');
      // The optimistic clear above assumed success — resync now that it didn't.
      else setError(res.message);
      await refresh();
    },
    [refresh, setError, setFlash],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const res = await api.deleteSession(sessionId);
      if (res.ok) {
        setFlash('Session deleted.');
        await refresh();
      } else setError(res.message);
    },
    [refresh, setError, setFlash],
  );

  // ── Attendance code ────────────────────────────────────────────────────────

  const putManualCode = useCallback(
    (sessionId: string, status: ManualCodeStatus) => {
      setState((s) => ({ ...s, manualCodes: { ...s.manualCodes, [sessionId]: status } }));
    },
    [],
  );

  const loadManualCode = useCallback(
    async (sessionId: string) => {
      const res = await api.manualCodeStatus(sessionId);
      if (res.ok) putManualCode(sessionId, res.data);
      else setError(res.message);
    },
    [putManualCode, setError],
  );

  const patchManualCode = useCallback(
    async (sessionId: string, body: ManualCodeConfigReq) => {
      const res = await api.setManualCode(sessionId, body);
      if (res.ok) putManualCode(sessionId, res.data);
      else setError(res.message);
    },
    [putManualCode, setError],
  );

  const pauseManualCode = useCallback(
    (sessionId: string) => patchManualCode(sessionId, { paused: true }),
    [patchManualCode],
  );
  const resumeManualCode = useCallback(
    (sessionId: string) => patchManualCode(sessionId, { paused: false }),
    [patchManualCode],
  );
  const regenerateManualCode = useCallback(
    (sessionId: string) => patchManualCode(sessionId, { regenerate: true }),
    [patchManualCode],
  );

  return {
    state,
    clearFlash,
    clearError,
    refresh,
    loadMoreCourses,
    createCourse,
    disableCourse,
    enableCourse,
    assignLecturers,
    searchLecturers,
    loadMoreSessions,
    createSession,
    collect,
    deactivate,
    deleteSession,
    loadManualCode,
    pauseManualCode,
    resumeManualCode,
    regenerateManualCode,
  };
}

export type StaffApi = ReturnType<typeof useStaffDashboard>;
