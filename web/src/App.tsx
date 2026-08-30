import { Card, Screen } from './components/Chrome';
import { useSession } from './hooks/useSession';
import { isIosDevice } from './platform/ios';
import { CheckInScreen } from './screens/CheckInScreen';
import { LoginScreen } from './screens/LoginScreen';
import { NotSupportedScreen } from './screens/NotSupportedScreen';
import { StaffNoticeScreen } from './screens/StaffNoticeScreen';

/**
 * Evaluated once, not on every render: the answer cannot change without a
 * reload, and re-running the sniff mid-session would only risk flicker.
 */
const IS_IOS = isIosDevice();

export function App() {
  const { session, signIn, signOut } = useSession();

  if (!IS_IOS) return <NotSupportedScreen />;

  switch (session.state) {
    case 'loading':
      return (
        <Screen>
          <Card>
            <p className="subtitle" style={{ textAlign: 'center', margin: 0 }}>
              Loading…
            </p>
          </Card>
        </Screen>
      );

    case 'loggedOut':
      return <LoginScreen error={session.error} onSignIn={signIn} />;

    case 'loggedIn':
      return session.user.role === 'student' ? (
        // Keyed on identity: one phone is genuinely passed between students at
        // "get help", and without this the next signed-in account would inherit
        // the previous student's check-in state — including a settled "you're
        // marked present" they never earned. Remounting on email change throws
        // that state away. The native app does the same (see AppRoot.kt).
        <CheckInScreen key={session.user.email} email={session.user.email} onSignOut={signOut} />
      ) : (
        <StaffNoticeScreen email={session.user.email} onSignOut={signOut} />
      );
  }
}
