import { useEffect, useState } from 'react';
import { Screen } from '../components/Chrome';
import { StaffTopBar, Tabs } from '../components/StaffChrome';
import { useStaffDashboard } from '../hooks/useStaffDashboard';
import { AttendanceMatrixScreen } from './staff/AttendanceMatrixScreen';
import { CoursesTab } from './staff/CoursesTab';
import { CreateSessionTab } from './staff/CreateSessionTab';
import { SessionsTab } from './staff/SessionsTab';

/**
 * Web counterpart of ui/staff/StaffDashboardScreen.kt, with the same tabs in the
 * same order and the same copy.
 *
 * Two things the native dashboard has are deliberately absent:
 *
 *  - the admin-only tabs (Lecturers, Geofences, Settings). Drawing a building
 *    polygon needs a map surface, and the rest is rarely-used configuration, so
 *    all of it stays on Android. An admin signing in here gets the same three
 *    lecturer tabs rather than a locked door — they own courses too.
 *  - anything that starts a Bluetooth broadcast. See the staff block in
 *    api/client.ts for why claiming a radio this client does not have would be
 *    worse than simply not having one.
 */
const TABS = ['Courses', 'Create session', 'Sessions'];

export function StaffDashboard({ role, onSignOut }: { role: string; onSignOut: () => void }) {
  const staff = useStaffDashboard(role);
  const [tab, setTab] = useState(0);
  const [matrixCourseId, setMatrixCourseId] = useState<string | null>(null);
  const { flash, error } = staff.state;
  const { clearFlash, clearError } = staff;

  useEffect(() => {
    if (flash == null) return;
    const timer = window.setTimeout(clearFlash, 2500);
    return () => window.clearTimeout(timer);
  }, [flash, clearFlash]);

  if (matrixCourseId != null) {
    return (
      <AttendanceMatrixScreen courseId={matrixCourseId} onBack={() => setMatrixCourseId(null)} />
    );
  }

  return (
    <Screen top={<StaffTopBar role={role} onSignOut={onSignOut} />}>
      <Tabs tabs={TABS} active={tab} onSelect={setTab} />

      {flash && (
        <button type="button" className="flash" onClick={clearFlash}>
          {flash}
        </button>
      )}
      {error && (
        <button type="button" className="banner banner--button" onClick={clearError}>
          {error}
        </button>
      )}

      {tab === 0 && <CoursesTab staff={staff} onOpenMatrix={setMatrixCourseId} />}
      {tab === 1 && <CreateSessionTab staff={staff} />}
      {tab === 2 && <SessionsTab staff={staff} />}
    </Screen>
  );
}
