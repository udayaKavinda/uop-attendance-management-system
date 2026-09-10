import { Card, PrimaryButton, Screen } from '../components/Chrome';

/**
 * Shown to anything that is not an iPhone or iPad, unless an admin has switched
 * `webAllowNonIos` on (see usePlatformGate).
 *
 * Android has the native app, which verifies over Bluetooth as well as GPS — a
 * browser build can only do GPS, so sending Android users here would be a
 * downgrade. Desktop has no business marking room attendance at all.
 *
 * `unreachable` is the other way in: the gate could not be checked at all. The
 * device is still kept out (the check fails closed), but claiming it is
 * unsupported would be a guess — so this says what actually happened and offers
 * a retry.
 */
export function NotSupportedScreen({
  unreachable = false,
  onRetry,
}: {
  unreachable?: boolean;
  onRetry?: () => void;
}) {
  if (unreachable) {
    return (
      <Screen>
        <Card>
          <div className="hero">
            <div className="hero__logo" aria-hidden="true">
              📡
            </div>
            <h1 className="hero__title">Could not reach the server</h1>
            <p className="hero__body">
              This device has to check with the server before it can be let in, and that check did
              not complete. Check your connection and try again.
            </p>
            {onRetry && <PrimaryButton text="Try again" onClick={onRetry} />}
          </div>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <div className="hero">
          <div className="hero__logo" aria-hidden="true">
            📱
          </div>
          <h1 className="hero__title">Use the Android app</h1>
          <p className="hero__body" style={{ marginBottom: 0 }}>
            This web version is for iPhone and iPad only. On Android, install the UOP Attendance
            app.
          </p>
        </div>
      </Card>
    </Screen>
  );
}
