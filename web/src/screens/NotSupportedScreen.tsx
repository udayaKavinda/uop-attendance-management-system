import { Card, Screen } from '../components/Chrome';

/**
 * Shown to anything that is not an iPhone or iPad, unless an admin has switched
 * `webAllowNonIos` on (see usePlatformGate).
 *
 * Android has the native app, which verifies over Bluetooth as well as GPS — a
 * browser build can only do GPS, so sending Android users here would be a
 * downgrade. Desktop has no business marking room attendance at all.
 */
export function NotSupportedScreen() {
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
            app — it marks attendance over Bluetooth as well as GPS, so it works in places this
            page cannot.
          </p>
        </div>
      </Card>
    </Screen>
  );
}
