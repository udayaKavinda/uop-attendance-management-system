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
 * This is the LECTURER dashboard, and only that. Two things the native dashboard
 * has are deliberately absent:
 *
 *  - everything administrative — the Lecturers, Geofences and Settings tabs, and
 *    admins themselves, who get AdminNoticeScreen instead of this. Administration
 *    is Android-only.
 *  - anything that starts a Bluetooth broadcast. See the staff block in
 *    api/client.ts for why claiming a radio this client does not have would be
 *    worse than simply not having one.
 */
const TABS = ['Courses', 'Create session', 'Sessions'];

export function StaffDashboard({ onSignOut }: { onSignOut: () => void }) {
  const staff = useStaffDashboard();
  const [tab, setTab] = useState(0);
  const [matrixCourseId, setMatrixCourseId] = useState<string | null>(null);
  const { flash, error } = staff.state;
  const { clearFlash, clearError } = staff;

  useEffect(() => {
    if (flash == null) return;
    const timer = window.setTimeout(clearFlash, 2500);
    return () => window.clearTimeout(timer);
  }, [flash, clearFlash]);

  /**
   * Switching tabs (or opening/closing the attendance matrix) swaps the whole
   * view in place — the page itself never navigates, so nothing resets scroll on
   * its own. Without this, scrolling down a tall tab (Create session) and then
   * tapping a short one (Sessions, empty) leaves the browser at its old scroll
   * offset: the new, shorter content renders starting from that same offset, so
   * the topbar and tab row end up pushed far down the viewport instead of at the
   * top. Every tab should open at its top, same as a fresh Compose scroll
   * container does natively.
   */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, matrixCourseId]);

  if (matrixCourseId != null) {
    return (
      <AttendanceMatrixScreen courseId={matrixCourseId} onBack={() => setMatrixCourseId(null)} />
    );
  }

  return (
    <Screen top={<StaffTopBar onSignOut={onSignOut} />}>
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
