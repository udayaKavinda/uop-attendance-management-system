import type { ReactNode } from 'react';

/*
 * Web counterparts of ui/components/Components.kt, kept name-for-name so the two
 * clients stay recognisably one product.
 */

/** StudentTopBar in LectureEntryScreen.kt. */
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

/** AppFooter — same line the native app shows. */
function Footer() {
  return (
    <div className="footer">
      Copyright © 2026 Computing Centre - Faculty of Engineering - University of Peradeniya. All
      Rights Reserved.
    </div>
  );
}

/** AppCard. */
export function Card({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>;
}

/**
 * `align` picks how `.app__body` positions short content:
 *
 *  - `'center'` (default) — a single card vertically centered on a tall
 *    viewport. Right for a one-card screen (Login, notices, check-in) where
 *    there is nothing else on the page to stay anchored to.
 *  - `'top'` — content starts immediately below `top` and never moves. Required
 *    for anything with its own persistent navigation below `top` (StaffDashboard's
 *    tab row, AttendanceMatrixScreen's back link): centering would otherwise
 *    drag that navigation down the page whenever the active view is short —
 *    e.g. an empty Sessions tab centering "Search sessions" mid-viewport and
 *    pushing the tab row down with it, while a fuller tab stays put.
 */
export function Screen({
  children,
  top,
  align = 'center',
}: {
  children: ReactNode;
  top?: ReactNode;
  align?: 'center' | 'top';
}) {
  return (
    <div className="app">
      {top}
      <div className={`app__body${align === 'top' ? ' app__body--top' : ''}`}>{children}</div>
      <Footer />
    </div>
  );
}

/** ErrorBanner. */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="banner" role="alert">
      {message}
    </div>
  );
}

/** EmptyState. */
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

/**
 * Shown in place of an [EmptyState] while a list is still being fetched.
 *
 * An empty list and a list that has not arrived yet render identically, and the
 * empty copy is not neutral — "Add a course above to get started" reads as a
 * statement about the lecturer's account. On a slow connection that was the
 * first thing they saw after signing in, and it was wrong.
 */
export function ListLoading({ text }: { text: string }) {
  return (
    <div className="empty">
      <div className="spinner" role="status" aria-label="Loading" />
      <p className="empty__text">{text}</p>
    </div>
  );
}

/** LoadingGate. */
export function LoadingGate({ message = 'Please wait.' }: { message?: string }) {
  return (
    <div className="loading">
      <div className="spinner" role="status" aria-label="Loading" />
      <p className="loading__title">Checking session…</p>
      <p className="loading__text">{message}</p>
    </div>
  );
}

export type ButtonVariant = 'accent' | 'bluetooth' | 'plain';

/** PrimaryButton. */
export function PrimaryButton({
  text,
  onClick,
  variant = 'accent',
  disabled = false,
  loading = false,
  type = 'button',
}: {
  text: string;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
}) {
  const modifier = variant === 'accent' ? '' : ` button--${variant}`;
  return (
    <button
      type={type}
      className={`button${modifier}`}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {loading && <span className="spinner spinner--small" aria-hidden="true" />}
      {text}
    </button>
  );
}

/** AppTextField — label above a rounded outlined input. */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  inputMode,
  maxLength,
  autoComplete,
  type = 'text',
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  inputMode?: 'numeric' | 'search' | 'text';
  maxLength?: number;
  autoComplete?: string;
  type?: 'text' | 'search';
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <label>
      <span className="field__label">{label}</span>
      <input
        ref={inputRef}
        className="input"
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete={autoComplete}
        {...(inputMode === 'numeric' ? { pattern: '[0-9]*' } : {})}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
