/**
 * Holds the screen awake for the duration of a check-in window.
 *
 * The native app does the same with `keepScreenOn` (see LectureEntryScreen.kt),
 * and for the same reason: a screen timeout silently stops the callbacks the
 * attempt depends on — Bluetooth scans there, geolocation updates here — and the
 * student sees a false "we couldn't confirm you're in the lecture" rather than a
 * real one.
 *
 * Screen Wake Lock landed in Safari 16.4. Older iOS just does without it: the
 * lock is a nicety, never a precondition, so every failure here is swallowed.
 */
export interface ScreenLock {
  release: () => void;
}

export function keepScreenAwake(): ScreenLock {
  const api = navigator.wakeLock;
  if (!api) return { release: () => {} };

  let sentinel: WakeLockSentinel | null = null;
  let released = false;

  const acquire = async () => {
    if (released || document.visibilityState !== 'visible') return;
    try {
      sentinel = await api.request('screen');
    } catch {
      // Denied, or the document lost focus mid-request. Not worth surfacing.
    }
  };

  // iOS drops the lock whenever the page is hidden and does not restore it, so
  // re-acquire each time the student comes back to the tab.
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void acquire();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  void acquire();

  return {
    release: () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
}
