import { Card, LoadingGate, Screen } from './components/Chrome';
import { usePlatformGate } from './hooks/usePlatformGate';
import { useSession } from './hooks/useSession';
import { CheckInScreen } from './screens/CheckInScreen';
import { LoginScreen } from './screens/LoginScreen';
import { NotSupportedScreen } from './screens/NotSupportedScreen';
import { StaffNoticeScreen } from './screens/StaffNoticeScreen';

export function App() {
  const gate = usePlatformGate();

  switch (gate) {
    case 'checking':
      return (
        <Screen>
          <Card>
            <LoadingGate />
          </Card>
        </Screen>
      );
    case 'blocked':
      return <NotSupportedScreen />;
    case 'allowed':
      // Session handling lives in its own component so it only mounts once the
      // device is actually allowed in — a blocked visitor should never probe
      // /api/me, and hooks cannot be called conditionally.
      return <AuthenticatedApp />;
  }
}

function AuthenticatedApp() {
  const { session, signIn, signOut } = useSession();

  switch (session.state) {
    case 'loading':
      return (
        <Screen>
          <Card>
            <LoadingGate />
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
