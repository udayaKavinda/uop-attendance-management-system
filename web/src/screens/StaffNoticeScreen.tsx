import { Card, Screen, TopBar } from '../components/Chrome';

/**
 * The web client is the student check-in flow and nothing else — running a
 * lecture needs Bluetooth broadcasting, which no iOS browser can do. Staff who
 * sign in here are told plainly rather than shown a half-working dashboard.
 */
export function StaffNoticeScreen({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}) {
  return (
    <Screen top={<TopBar email={email} onSignOut={onSignOut} />}>
      <Card>
        <div className="hero">
          <div className="hero__logo" aria-hidden="true">
            🧑‍🏫
          </div>
          <h1 className="hero__title">Staff tools aren't on the web</h1>
          <p className="hero__body" style={{ marginBottom: 0 }}>
            This page only handles student check-in. To run a lecture — starting a session,
            broadcasting, and reading out the attendance code — use the UOP Attendance app on
            Android.
          </p>
        </div>
      </Card>
    </Screen>
  );
}
