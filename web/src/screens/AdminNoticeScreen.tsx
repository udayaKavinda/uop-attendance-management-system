import { Card, Screen, TopBar } from '../components/Chrome';

/**
 * Administration is not on the web at all — it stays in the Android app.
 *
 * The lecturer dashboard is here (see StaffDashboard), but an admin's own work
 * is not: drawing building geofences needs a map surface, and the lecturer
 * picker, global settings and lecturer management have no web counterpart. An
 * admin is told plainly rather than shown a dashboard missing half its tabs.
 */
export function AdminNoticeScreen({
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
            🛡️
          </div>
          <h1 className="hero__title">Administration isn't on the web</h1>
          <p className="hero__body" style={{ marginBottom: 0 }}>
            This page handles student check-in and the lecturer dashboard. To manage lecturers,
            buildings and global settings, use the UOP Attendance app on Android.
          </p>
        </div>
      </Card>
    </Screen>
  );
}
