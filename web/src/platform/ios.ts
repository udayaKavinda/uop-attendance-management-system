/**
 * Whether this browser is running on iOS or iPadOS.
 *
 * This gate is a UX guard, not a security boundary: a user agent is trivially
 * spoofable and nothing here is enforced server-side. It exists because Android
 * users have the native app, which verifies attendance over Bluetooth as well as
 * GPS — sending them to a GPS-only browser build would be a downgrade, not a
 * convenience.
 */
export function isIosDevice(): boolean {
  const ua = navigator.userAgent;

  // Android must lose before anything else: some Android browsers put "like Mac
  // OS X" or an iPhone string in the UA when desktop mode is on.
  if (/Android/i.test(ua)) return false;

  if (/iPhone|iPod/i.test(ua)) return true;

  // iPadOS 13+ defaults to a desktop-Safari user agent with no "iPad" in it, so
  // the only reliable tell is a Mac that reports touch — real Macs report none.
  const isMacLike = /iPad|Macintosh|Mac OS X/i.test(ua);
  return isMacLike && navigator.maxTouchPoints > 1;
}

/** Whether the page is running from the home screen rather than a Safari tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Safari's own non-standard flag, still the only signal it sets on iOS.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
