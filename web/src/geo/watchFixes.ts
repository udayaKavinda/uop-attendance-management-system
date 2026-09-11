import type { GpsFix } from '../api/types';

/** Thrown through `onError` when location streaming cannot start or continue. */
export class LocationUnavailableError extends Error {}

/**
 * Matches the native app's GpsLocationSource.fixFlow() default: a fix roughly
 * every 3 seconds. `watchPosition` fires as often as the OS pleases — sometimes
 * many times a second while a fix is settling — so this throttles submissions
 * rather than letting one student spam the server for a whole 90-second window.
 */
const MIN_INTERVAL_MS = 3000;

/**
 * The per-acquisition deadline handed to `watchPosition`.
 *
 * This is the full check-in window rather than a short value on purpose. iOS
 * starts the clock when the call is made, *not* when the student finishes with
 * the permission sheet, and `maximumAge: 0` forbids satisfying it from cache —
 * so a short deadline expires while the sheet is still on screen, or during a
 * cold GNSS warm-up outdoors. That produced a TIMEOUT on a phone whose GPS was
 * working perfectly. The 90-second window is the only deadline that matters;
 * when it ends with nothing, the caller already offers the lecturer's code.
 */
const ACQUISITION_TIMEOUT_MS = 90_000;

export interface WatchHandle {
  stop: () => void;
}

/**
 * Streams GPS fixes for the duration of a check-in window.
 *
 * `enableHighAccuracy` asks iOS for the GPS chip rather than a coarse Wi-Fi
 * estimate, and `maximumAge: 0` refuses cached positions — a stale fix from
 * wherever the phone was ten minutes ago is exactly the kind of evidence the
 * geofence must never be handed.
 *
 * Only a *fatal* error reaches `onError`. `watchPosition` is a stream, and iOS
 * routinely emits a transient TIMEOUT or POSITION_UNAVAILABLE mid-window (screen
 * dimming, a tunnel, the first moments after the permission sheet) and then goes
 * on delivering fixes perfectly well. Those used to propagate, and the caller
 * treats any error as the end of the attempt — so one recoverable blip killed a
 * window that still had 70 good seconds left in it, and the student was pushed
 * to the lecturer's code with no fix ever submitted. Permission denial is the
 * only error the stream genuinely cannot come back from.
 */
export function watchFixes(
  onFix: (fix: GpsFix) => void,
  onError: (error: LocationUnavailableError) => void,
): WatchHandle {
  // Truthiness, not `'geolocation' in navigator`: the property can be present
  // and hold nothing (a stripped webview, a privacy shim that nulls it out), and
  // the `in` check passed that straight through to `.watchPosition` — a raw
  // TypeError in the student's face instead of the sentence below.
  if (!navigator.geolocation) {
    onError(new LocationUnavailableError('Location is not available in this browser.'));
    return { stop: () => {} };
  }

  // On an insecure origin the API still exists but every call fails as though
  // the student denied permission, sending them to check a setting that was
  // never the problem. Name the real cause instead.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    onError(
      new LocationUnavailableError(
        'Location needs a secure (https) connection. Open this page over https and try again.',
      ),
    );
    return { stop: () => {} };
  }

  let lastSentAt = 0;
  let stopped = false;

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      if (stopped) return;
      const now = Date.now();
      if (now - lastSentAt < MIN_INTERVAL_MS) return;
      lastSentAt = now;
      const { latitude, longitude, accuracy } = position.coords;
      onFix({
        lat: latitude,
        lng: longitude,
        // The server rejects a non-finite or negative accuracy outright, and
        // treats a zero as "unmeasured" rather than "perfect" (gpsFix.service.js).
        accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : 0,
      });
    },
    (error) => {
      if (stopped) return;
      if (!isFatal(error)) return; // keep watching; the window decides
      onError(new LocationUnavailableError(messageFor(error)));
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: ACQUISITION_TIMEOUT_MS },
  );

  return {
    stop: () => {
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
    },
  };
}

/**
 * Whether this error ends the attempt. A denied permission cannot resolve itself
 * without the student changing a setting, so it is worth saying immediately;
 * everything else is the OS reporting a bad moment, not a bad session.
 */
function isFatal(error: GeolocationPositionError): boolean {
  return error.code === error.PERMISSION_DENIED;
}

function messageFor(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location permission is required to verify your position for this session.';
    case error.POSITION_UNAVAILABLE:
      return 'Location is turned off. Enable it to verify your position.';
    case error.TIMEOUT:
      return 'Could not get a location fix in time.';
    default:
      return 'Location is not available on this device.';
  }
}
