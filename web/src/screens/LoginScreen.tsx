import { Card, ErrorBanner, PrimaryButton, Screen } from '../components/Chrome';
import { isStandalone } from '../platform/ios';

export function LoginScreen({ error, onSignIn }: { error?: string; onSignIn: () => void }) {
  // Only worth suggesting from a Safari tab; from the home screen it is done.
  const showInstallHint = !isStandalone();

  return (
    <Screen>
      <Card>
        <div className="hero">
          <div className="hero__logo" aria-hidden="true">
            🎓
          </div>
          <h1 className="hero__title">Attendance</h1>
          <p className="hero__body">
            Sign in with your university Google account to mark your lecture attendance.
          </p>
        </div>
        {error && (
          <div style={{ marginBottom: 14 }}>
            <ErrorBanner message={error} />
          </div>
        )}
        <PrimaryButton text="Continue with Google" onClick={onSignIn} />
        {showInstallHint && (
          <p className="subtitle" style={{ textAlign: 'center', marginTop: 16 }}>
          </p>
        )}
      </Card>
    </Screen>
  );
}
