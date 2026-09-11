/**
 * The geolocation stream that feeds every web check-in.
 *
 * This file had no tests at all, which is how the failure it now pins reached
 * production: `watchPosition` is a *stream*, and iOS emits a transient TIMEOUT
 * or POSITION_UNAVAILABLE mid-window and then carries on delivering fixes
 * perfectly well. Those errors used to propagate to the caller, which treats any
 * error as the end of the attempt — so one recoverable blip ended a window that
 * still had seventy good seconds in it, no fix was ever submitted, and the
 * student was pushed to the lecturer's code and recorded as flagged.
 *
 * The rule being pinned: only a denied permission is fatal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocationUnavailableError, watchFixes } from './watchFixes';

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

type SuccessCb = (p: GeolocationPosition) => void;
type ErrorCb = (e: GeolocationPositionError) => void;

let successCb: SuccessCb;
let errorCb: ErrorCb;
let clearWatchSpy: ReturnType<typeof vi.fn>;
let lastOptions: PositionOptions | undefined;

function installGeolocation() {
  clearWatchSpy = vi.fn();
  const watchPosition = vi.fn((s: SuccessCb, e: ErrorCb, o?: PositionOptions) => {
    successCb = s;
    errorCb = e;
    lastOptions = o;
    return 42;
  });
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: { watchPosition, clearWatch: clearWatchSpy },
    configurable: true,
  });
}

function position(lat: number, lng: number, accuracy: number): GeolocationPosition {
  return {
    coords: {
      latitude: lat, longitude: lng, accuracy,
      altitude: null, altitudeAccuracy: null, heading: null, speed: null,
    },
    timestamp: Date.now(),
  } as GeolocationPosition;
}

/** The shape a browser hands the error callback, including the code constants. */
function geoError(code: number): GeolocationPositionError {
  return {
    code,
    message: 'test',
    PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT,
  } as GeolocationPositionError;
}

describe('watchFixes', () => {
  beforeEach(() => {
    vi.useRealTimers();
    installGeolocation();
    Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });
  });

  describe('transient errors must not end the attempt', () => {
    it('ignores a TIMEOUT and keeps the watch open', () => {
      const onFix = vi.fn();
      const onError = vi.fn();
      watchFixes(onFix, onError);

      errorCb(geoError(TIMEOUT));

      expect(onError).not.toHaveBeenCalled();
      expect(clearWatchSpy).not.toHaveBeenCalled();
    });

    it('ignores POSITION_UNAVAILABLE and keeps the watch open', () => {
      const onError = vi.fn();
      watchFixes(vi.fn(), onError);

      errorCb(geoError(POSITION_UNAVAILABLE));

      expect(onError).not.toHaveBeenCalled();
      expect(clearWatchSpy).not.toHaveBeenCalled();
    });

    it('still delivers fixes after a transient error — the regression itself', () => {
      const onFix = vi.fn();
      const onError = vi.fn();
      watchFixes(onFix, onError);

      errorCb(geoError(TIMEOUT));
      successCb(position(7.2547, 80.5918, 8));

      expect(onError).not.toHaveBeenCalled();
      expect(onFix).toHaveBeenCalledTimes(1);
      expect(onFix).toHaveBeenCalledWith({ lat: 7.2547, lng: 80.5918, accuracy: 8 });
    });
  });

  describe('fatal errors', () => {
    it('reports PERMISSION_DENIED, which cannot resolve itself', () => {
      const onError = vi.fn();
      watchFixes(vi.fn(), onError);

      errorCb(geoError(PERMISSION_DENIED));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(LocationUnavailableError);
      expect(onError.mock.calls[0][0].message).toMatch(/permission/i);
    });

    it('names an insecure origin instead of blaming the permission', () => {
      Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true });
      const onError = vi.fn();

      watchFixes(vi.fn(), onError);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toMatch(/https/i);
    });

    it('reports a browser with no geolocation at all', () => {
      // @ts-expect-error — removing the property is the shape a browser without
      // geolocation actually has.
      delete globalThis.navigator.geolocation;
      const onError = vi.fn();

      watchFixes(vi.fn(), onError);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toMatch(/not available in this browser/i);
    });

    it('reports a geolocation property that is present but holds nothing', () => {
      // A stripped webview or a privacy shim can leave the key in place with
      // nothing behind it. `'geolocation' in navigator` is true here, which is
      // why that check was not enough to stop a TypeError.
      Object.defineProperty(globalThis.navigator, 'geolocation', {
        value: undefined, configurable: true,
      });
      const onError = vi.fn();

      expect(() => watchFixes(vi.fn(), onError)).not.toThrow();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toMatch(/not available in this browser/i);
    });
  });

  describe('acquisition options', () => {
    it('asks for the GPS chip and refuses a cached position', () => {
      watchFixes(vi.fn(), vi.fn());

      expect(lastOptions?.enableHighAccuracy).toBe(true);
      // A stale fix from wherever the phone was ten minutes ago is exactly the
      // evidence the geofence must never be handed.
      expect(lastOptions?.maximumAge).toBe(0);
    });

    it('allows the whole window to acquire, not a short deadline', () => {
      watchFixes(vi.fn(), vi.fn());

      // iOS starts this clock when the call is made, while its permission sheet
      // is still on screen. A 20s deadline expired before the student had
      // finished tapping Allow.
      expect(lastOptions?.timeout).toBeGreaterThanOrEqual(90_000);
    });
  });

  describe('throttling and payload', () => {
    it('submits the first fix immediately', () => {
      const onFix = vi.fn();
      watchFixes(onFix, vi.fn());

      successCb(position(7.1, 80.1, 5));

      expect(onFix).toHaveBeenCalledTimes(1);
    });

    it('drops fixes arriving faster than the 3s interval', () => {
      const onFix = vi.fn();
      watchFixes(onFix, vi.fn());

      successCb(position(7.1, 80.1, 5));
      successCb(position(7.1, 80.1, 5));
      successCb(position(7.1, 80.1, 5));

      expect(onFix).toHaveBeenCalledTimes(1);
    });

    it('sends 0 for an unmeasured accuracy, which the server reads as unknown', () => {
      const onFix = vi.fn();
      watchFixes(onFix, vi.fn());

      successCb(position(7.1, 80.1, 0));

      expect(onFix).toHaveBeenCalledWith({ lat: 7.1, lng: 80.1, accuracy: 0 });
    });

    it('sends 0 rather than a negative or non-finite accuracy', () => {
      const onFix = vi.fn();
      watchFixes(onFix, vi.fn());

      successCb(position(7.1, 80.1, Number.NaN));

      expect(onFix).toHaveBeenCalledWith({ lat: 7.1, lng: 80.1, accuracy: 0 });
    });
  });

  describe('stop()', () => {
    it('clears the watch', () => {
      const handle = watchFixes(vi.fn(), vi.fn());
      handle.stop();
      expect(clearWatchSpy).toHaveBeenCalledWith(42);
    });

    it('delivers nothing after stop', () => {
      const onFix = vi.fn();
      const handle = watchFixes(onFix, vi.fn());

      handle.stop();
      successCb(position(7.1, 80.1, 5));

      expect(onFix).not.toHaveBeenCalled();
    });

    it('reports nothing after stop, even a fatal error', () => {
      const onError = vi.fn();
      const handle = watchFixes(vi.fn(), onError);

      handle.stop();
      errorCb(geoError(PERMISSION_DENIED));

      expect(onError).not.toHaveBeenCalled();
    });
  });
});
