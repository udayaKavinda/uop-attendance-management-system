import type { ReactNode } from 'react';

export function TopBar({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="topbar">
      <div className="topbar__logo" aria-hidden="true">
        🎓
      </div>
      <div className="topbar__titles">
        <div className="topbar__title">Attendance</div>
        <div className="topbar__subtitle">
          {email.split('@')[0] || 'University of Peradeniya'}
        </div>
      </div>
      <button type="button" className="topbar__signout" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}

export function Footer() {
  return (
    <div className="footer">
      University of Peradeniya · Faculty of Engineering
      {' · '}
      <a href="/privacy">Privacy</a>
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>;
}

export function Screen({ children, top }: { children: ReactNode; top?: ReactNode }) {
  return (
    <div className="app">
      {top}
      <div className="app__body">{children}</div>
      <Footer />
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="banner" role="alert">
      {message}
    </div>
  );
}

export function EmptyState({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="empty__title">{title}</div>
      <p className="empty__text">{text}</p>
    </div>
  );
}
