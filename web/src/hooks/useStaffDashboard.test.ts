/**
 * Staff dashboard state: the banner contract and the session-card stage rules.
 *
 * This hook is a state-for-state port of the Android StaffViewModel, so the
 * behaviour pinned here is the behaviour that has to stay identical between the
 * two clients — a divergence is how the error-banner bug survived on this side
 * after the Android one was fixed.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StaffSession } from '../api/types';

// Annotated as the full ApiResult union, not the narrow success shape: without
// this every mock infers `{ ok: true }` and mockResolvedValueOnce(fail(...)) is a
// type error, which `tsc -b` would fail the build on even while the tests pass.
type Result<T> = { ok: true; data: T } | { ok: false; message: string; status: number };

const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (message: string, status = 400): Result<never> => ({ ok: false, message, status });

const emptyPage = { items: [], hasMore: false };

// Every method the hook can reach. Defaults are the boring success case; each
// test overrides only the call it cares about.
const api = {
  adminCourses: vi.fn(async () => ok(emptyPage)),
  allSessions: vi.fn(async () => ok(emptyPage)),
  runningSessions: vi.fn(async () => ok([])),
  settings: vi.fn(async () => ok({ bleEnabled: true })),
  geofences: vi.fn(async () => ok(emptyPage)),
  lecturers: vi.fn(async () => ok(emptyPage)),
  createCourse: vi.fn(async () => ok({})),
  disableCourse: vi.fn(async () => ok({})),
  enableCourse: vi.fn(async () => ok({})),
  assignLecturers: vi.fn(async () => ok({})),
  createSession: vi.fn(async () => ok({ message: 'Session created.' })),
  activateSession: vi.fn(async () => ok({})),
  deactivateSession: vi.fn(async () => ok({})),
  deleteSession: vi.fn(async () => ok({})),
  manualCodeStatus: vi.fn(async () => ok({})),
  setManualCode: vi.fn(async () => ok({})),
};

vi.mock('../api/client', () => ({
  api,
  setUnauthorizedHandler: vi.fn(),
}));

// Imported after the mock is registered.
const {
  useStaffDashboard, stageOf, isRunning, isActiveOnServer, isBroadcastingOnServer, bleEnabled,
} = await import('./useStaffDashboard');

/** A hook already past its initial load, so assertions are not racing refresh(). */
async function mountSettled() {
  const view = renderHook(() => useStaffDashboard());
  await waitFor(() => expect(view.result.current.state.loading).toBe(false));
  return view;
}

const GEOFENCE_ID = 'geo1';

/** The minimum a createSession call needs to get past the hook's own guards. */
async function createValidSession(result: { current: ReturnType<typeof useStaffDashboard> }) {
  await act(async () => {
    await result.current.createSession(
      'course1', 'FRI', '08:00', '10:00', true, [GEOFENCE_ID], 'none', 60,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.adminCourses.mockResolvedValue(ok(emptyPage));
  api.allSessions.mockResolvedValue(ok(emptyPage));
  api.runningSessions.mockResolvedValue(ok([]));
  api.createSession.mockResolvedValue(ok({ message: 'Session created.' }));
  api.deactivateSession.mockResolvedValue(ok({}));
});

describe('flash and error are mutually exclusive', () => {
  it('a later success clears the error the previous failure left behind', async () => {
    const { result } = await mountSettled();

    api.createSession.mockResolvedValueOnce(
      fail('08:00-10:00 clashes with this course\'s existing FRI session at 08:00-10:00 (weekly).'),
    );
    await createValidSession(result);
    expect(result.current.state.error).toMatch(/clashes with/);

    // The lecturer corrects the time and saves. Before the fix the red banner
    // stayed put, on every tab, above a green "Session created." — which reads
    // as "it did not save" and got the work re-created.
    await createValidSession(result);

    expect(result.current.state.error).toBeNull();
    expect(result.current.state.flash).toBe('Session created.');
  });

  it('a failure clears a success message still on screen', async () => {
    const { result } = await mountSettled();

    await createValidSession(result);
    expect(result.current.state.flash).toBe('Session created.');

    api.createSession.mockResolvedValueOnce(fail('Select at least one building for this session'));
    await createValidSession(result);

    expect(result.current.state.flash).toBeNull();
    expect(result.current.state.error).toMatch(/building/);
  });

  it('still surfaces errors — the fix must not swallow them', async () => {
    const { result } = await mountSettled();

    api.createSession.mockResolvedValueOnce(fail('Choose a course first.'));
    await createValidSession(result);

    expect(result.current.state.error).toBe('Choose a course first.');
  });

  it('keeps the error when a mutation fails and then reloads', async () => {
    // deactivate() is the one caller that does setError() and then refresh().
    // refresh() must not clear the message it was just handed.
    const { result } = await mountSettled();
    api.deactivateSession.mockResolvedValueOnce(fail('This session has been deleted.'));

    await act(async () => {
      await result.current.deactivate('session1');
    });

    expect(result.current.state.error).toBe('This session has been deleted.');
  });

  it('clearError and clearFlash dismiss only their own banner', async () => {
    const { result } = await mountSettled();

    api.createSession.mockResolvedValueOnce(fail('boom'));
    await createValidSession(result);
    act(() => result.current.clearError());
    expect(result.current.state.error).toBeNull();

    await createValidSession(result);
    act(() => result.current.clearFlash());
    expect(result.current.state.flash).toBeNull();
  });
});

describe('session card stages', () => {
  const session = (over: Partial<StaffSession> = {}) =>
    ({ _id: 's1', active: false, broadcasting: false, ...over }) as StaffSession;

  const stateWith = (running: Record<string, unknown>, settings?: unknown) =>
    ({ running, settings } as unknown as Parameters<typeof stageOf>[0]);

  it('is inactive when the session is outside its scheduled window', () => {
    // Not in the running set at all — `active` on the stale list must not win.
    expect(stageOf(stateWith({}), session({ active: true }))).toBe('inactive');
  });

  it('is withinSession in-window before anyone taps Collect', () => {
    expect(stageOf(stateWith({ s1: { active: false } }), session())).toBe('withinSession');
  });

  it('is collecting once the session is active in-window', () => {
    expect(stageOf(stateWith({ s1: { active: true } }), session())).toBe('collecting');
  });

  it('prefers the running poll over the staler session list', () => {
    // Another lecturer's phone flipped this between two full reloads.
    const state = stateWith({ s1: { active: true, broadcasting: true } });
    expect(isActiveOnServer(state, session({ active: false }))).toBe(true);
    expect(isBroadcastingOnServer(state, session({ broadcasting: false }))).toBe(true);
  });

  it('falls back to the session list when the poll has no entry for it', () => {
    const state = stateWith({ s1: {} });
    expect(isActiveOnServer(state, session({ active: true }))).toBe(true);
    expect(isBroadcastingOnServer(state, session({ broadcasting: true }))).toBe(true);
  });

  it('isRunning needs a real id, not a missing one', () => {
    expect(isRunning(stateWith({ s1: {} }), 's1')).toBe(true);
    expect(isRunning(stateWith({ s1: {} }), 'other')).toBe(false);
    expect(isRunning(stateWith({ s1: {} }), undefined)).toBe(false);
  });

  it('treats Bluetooth as enabled until the server says otherwise', () => {
    // Settings not loaded yet must not read as "admin switched BLE off".
    expect(bleEnabled(stateWith({}, undefined))).toBe(true);
    expect(bleEnabled(stateWith({}, { bleEnabled: true }))).toBe(true);
    expect(bleEnabled(stateWith({}, { bleEnabled: false }))).toBe(false);
  });
});
