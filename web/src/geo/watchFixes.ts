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
 */
export function watchFixes(
  onFix: (fix: GpsFix) => void,
  onError: (error: LocationUnavailableError) => void,
): WatchHandle {
  if (!('geolocation' in navigator)) {
    onError(new LocationUnavailableError('Location is not available in this browser.'));
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
      onError(new LocationUnavailableError(messageFor(error)));
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );

  return {
    stop: () => {
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
    },
  };
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
