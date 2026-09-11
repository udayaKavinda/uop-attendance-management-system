/**
 * The student check-in window: the only automatic path this client has.
 *
 * Untested until now, which is the reason a transient geolocation error could
 * end a whole attempt without anyone noticing. What is pinned here is the
 * contract between the window, the fix stream and the lecturer's code —
 * specifically that the window survives anything the stream can recover from,
 * and stops immediately for anything it cannot.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocationUnavailableError } from '../geo/watchFixes';

type Result<T> = { ok: true; data: T } | { ok: false; message: string; status: number };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (message: string, status = 400): Result<never> => ({ ok: false, message, status });

const COURSE = { _id: 'course-1', code: 'CO1010', name: 'Signals', batch: 'E21' };

const api = {
  runningCourses: vi.fn(async () => ok({ items: [COURSE] })),
  registeredCourses: vi.fn(async () => ok({ items: [] })),
  attendanceStatus: vi.fn(async () => ok({ status: 'none' })),
  recordAttendance: vi.fn(async () => ok({ status: 'collecting' })),
};

vi.mock('../api/client', () => ({
  api,
  setUnauthorizedHandler: vi.fn(),
}));

// The geolocation stream, captured so a test can drive it like the OS would.
let onFixCb: (fix: { lat: number; lng: number; accuracy: number }) => void;
let onErrorCb: (e: LocationUnavailableError) => void;
const stopSpy = vi.fn();

vi.mock('../geo/watchFixes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../geo/watchFixes')>();
  return {
    ...actual,
    watchFixes: (onFix: typeof onFixCb, onError: typeof onErrorCb) => {
      onFixCb = onFix;
      onErrorCb = onError;
      return { stop: stopSpy };
    },
  };
});

vi.mock('../platform/wakeLock', () => ({ keepScreenAwake: () => ({ release: vi.fn() }) }));

// Imported after the mocks are registered, same as useStaffDashboard.test.ts.
const { useCheckIn, WINDOW_SECONDS } = await import('./useCheckIn');

const FIX = { lat: 7.2547, lng: 80.5918, accuracy: 8 };

/** Mounts the hook and gets as far as a started window. */
async function startedWindow() {
  const view = renderHook(() => useCheckIn());
  await waitFor(() => expect(view.result.current.state.courses).toHaveLength(1));
  act(() => view.result.current.selectCourse(COURSE._id));
  await waitFor(() => expect(view.result.current.state.selectedCourseId).toBe(COURSE._id));
  act(() => view.result.current.startCheckIn());
  return view;
}

describe('useCheckIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.runningCourses.mockResolvedValue(ok({ items: [COURSE] }));
    api.registeredCourses.mockResolvedValue(ok({ items: [] }));
    api.attendanceStatus.mockResolvedValue(ok({ status: 'none' }));
    api.recordAttendance.mockResolvedValue(ok({ status: 'collecting' }));
  });

  describe('starting a window', () => {
    it('refuses to start without a course selected', async () => {
      const { result } = renderHook(() => useCheckIn());
      await waitFor(() => expect(result.current.state.courses).toHaveLength(1));

      act(() => result.current.startCheckIn());

      expect(result.current.state.error).toMatch(/select your course/i);
      expect(result.current.state.phase).toBe('idle');
    });

    it('enters "preparing" and counts down from the full window', async () => {
      const { result } = await startedWindow();

      expect(result.current.state.phase).toBe('preparing');
      expect(result.current.state.secondsLeft).toBe(WINDOW_SECONDS);
    });

    it('turns "preparing" into "checking" only once a fix actually arrives', async () => {
      const { result } = await startedWindow();
      expect(result.current.state.phase).toBe('preparing');

      await act(async () => { onFixCb(FIX); });

      await waitFor(() => expect(result.current.state.phase).toBe('checking'));
    });
  });

  describe('submitting fixes', () => {
    it('sends each fix to the server with the selected course', async () => {
      await startedWindow();

      await act(async () => { onFixCb(FIX); });

      expect(api.recordAttendance).toHaveBeenCalledWith(
        expect.objectContaining({ courseId: COURSE._id, fix: FIX }),
      );
    });

    it('keeps collecting while the server answers "collecting"', async () => {
      const { result } = await startedWindow();

      await act(async () => { onFixCb(FIX); });
      await act(async () => { onFixCb(FIX); });

      expect(result.current.state.outcome).toBe('none');
      expect(result.current.state.needsHelp).toBe(false);
    });

    it('settles as present the moment the server accepts', async () => {
      api.recordAttendance.mockResolvedValue(ok({ status: 'accepted' }));
      const { result } = await startedWindow();

      await act(async () => { onFixCb(FIX); });

      await waitFor(() => expect(result.current.state.outcome).toBe('present'));
      expect(result.current.state.phase).toBe('idle');
      expect(stopSpy).toHaveBeenCalled();
    });

    it('ignores a transport failure rather than ending the attempt', async () => {
      api.recordAttendance.mockResolvedValue(fail('network down', 0));
      const { result } = await startedWindow();

      await act(async () => { onFixCb(FIX); });

      // The window decides, not any single request.
      expect(result.current.state.needsHelp).toBe(false);
      expect(result.current.state.outcome).toBe('none');
    });
  });

  describe('geolocation errors', () => {
    it('ends the attempt and offers the code when location is refused', async () => {
      const { result } = await startedWindow();

      await act(async () => {
        onErrorCb(new LocationUnavailableError('Location permission is required.'));
      });

      await waitFor(() => expect(result.current.state.needsHelp).toBe(true));
      expect(result.current.state.phase).toBe('idle');
      expect(result.current.state.error).toMatch(/ask your lecturer for the code/i);
      expect(stopSpy).toHaveBeenCalled();
    });

    // watchFixes only forwards fatal errors now; this pins the other half of
    // that contract — the caller genuinely does end the attempt on one.
    it('a fatal error stops the fix stream', async () => {
      await startedWindow();

      await act(async () => {
        onErrorCb(new LocationUnavailableError('nope'));
      });

      expect(stopSpy).toHaveBeenCalled();
    });
  });

  describe('the lecturer\'s code', () => {
    it('rejects anything that is not 8 digits without calling the server', async () => {
      const { result } = await startedWindow();

      await act(async () => { await result.current.submitHelpCode('123'); });

      expect(result.current.state.helpError).toMatch(/8-digit/i);
      expect(api.recordAttendance).not.toHaveBeenCalledWith(
        expect.objectContaining({ code: '123' }),
      );
    });

    it('sends a valid code and records the outcome', async () => {
      api.recordAttendance.mockResolvedValue(ok({ status: 'present' }));
      const { result } = await startedWindow();

      await act(async () => { await result.current.submitHelpCode('12345678'); });

      expect(api.recordAttendance).toHaveBeenCalledWith(
        expect.objectContaining({ courseId: COURSE._id, code: '12345678' }),
      );
      expect(result.current.state.outcome).toBe('present');
    });

    it('surfaces a flagged outcome as flagged, not as success', async () => {
      api.recordAttendance.mockResolvedValue(ok({ status: 'flagged' }));
      const { result } = await startedWindow();

      await act(async () => { await result.current.submitHelpCode('12345678'); });

      expect(result.current.state.outcome).toBe('flagged');
    });

    it('keeps the dialog open and explains when the code is refused', async () => {
      api.recordAttendance.mockResolvedValue(ok({ status: 'none' }));
      const { result } = await startedWindow();

      act(() => result.current.openHelp());
      await act(async () => { await result.current.submitHelpCode('00000000'); });

      expect(result.current.state.helpDialogOpen).toBe(true);
      expect(result.current.state.helpError).toMatch(/not accepted/i);
      expect(result.current.state.needsHelp).toBe(true);
    });

    it('reports a server error without claiming the code was wrong', async () => {
      api.recordAttendance.mockResolvedValue(fail('Session has ended.', 400));
      const { result } = await startedWindow();

      await act(async () => { await result.current.submitHelpCode('12345678'); });

      expect(result.current.state.helpError).toBe('Session has ended.');
      expect(result.current.state.helpSubmitting).toBe(false);
    });
  });

  describe('cancelling and reselecting', () => {
    it('cancel returns to idle and stops the stream', async () => {
      const { result } = await startedWindow();

      act(() => result.current.cancelCheckIn());

      expect(result.current.state.phase).toBe('idle');
      expect(stopSpy).toHaveBeenCalled();
    });

    it('selecting another course clears the previous outcome', async () => {
      api.recordAttendance.mockResolvedValue(ok({ status: 'accepted' }));
      const { result } = await startedWindow();
      await act(async () => { onFixCb(FIX); });
      await waitFor(() => expect(result.current.state.outcome).toBe('present'));

      act(() => result.current.selectCourse('course-2'));

      expect(result.current.state.outcome).toBe('none');
      expect(result.current.state.needsHelp).toBe(false);
      expect(result.current.state.phase).toBe('idle');
    });

    it('tryAgain clears the failure without starting a new window by itself', async () => {
      const { result } = await startedWindow();
      await act(async () => { onErrorCb(new LocationUnavailableError('denied')); });
      await waitFor(() => expect(result.current.state.needsHelp).toBe(true));

      act(() => result.current.tryAgain());

      expect(result.current.state.needsHelp).toBe(false);
      expect(result.current.state.error).toBeNull();
      expect(result.current.state.phase).toBe('idle');
    });
  });

  describe('stale results', () => {
    it('a fix from an abandoned attempt cannot settle the new one', async () => {
      const { result } = await startedWindow();
      const staleFix = onFixCb;

      act(() => result.current.cancelCheckIn());
      api.recordAttendance.mockResolvedValue(ok({ status: 'accepted' }));

      await act(async () => { staleFix(FIX); });

      // The cancelled attempt must not mark the student present after the fact.
      expect(result.current.state.outcome).toBe('none');
    });
  });
});
