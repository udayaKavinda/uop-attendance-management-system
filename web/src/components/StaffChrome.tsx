import type { ReactNode } from 'react';

/*
 * Web counterparts of the staff-only widgets in ui/staff/StaffDashboardScreen.kt,
 * kept name-for-name so the two dashboards stay recognisably one product.
 */

/**
 * StaffTopBar. Shows the role rather than the address — the native bar takes an
 * `email` parameter but never renders it. Always "Lecturer" here: an admin never
 * reaches this dashboard (see AdminNoticeScreen).
 */
export function StaffTopBar({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="topbar">
      <div className="topbar__logo" aria-hidden="true">
        🛡️
      </div>
      <div className="topbar__titles">
        <div className="topbar__title">Attendance administration</div>
        <div className="topbar__subtitle">Lecturer</div>
      </div>
      <button type="button" className="topbar__signout" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}

/** ScrollableTabRow. */
export function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: string[];
  active: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((title, i) => (
        <button
          key={title}
          type="button"
          role="tab"
          aria-selected={i === active}
          className={`tabs__tab${i === active ? ' tabs__tab--active' : ''}`}
          onClick={() => onSelect(i)}
        >
          {title}
        </button>
      ))}
    </div>
  );
}

/** SectionHeader — emoji stands in for the Material icon. */
export function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="section-header">
      <span className="section-header__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="section-header__title">{title}</span>
    </div>
  );
}

export type PillTone = 'accent' | 'success' | 'warning' | 'neutral' | 'danger';

/** StatusBadge. */
export function StatusBadge({ text, tone }: { text: string; tone: PillTone }) {
  return <span className={`badge badge--${tone}`}>{text}</span>;
}

/** PillButton. */
export function PillButton({
  text,
  onClick,
  tone,
}: {
  text: string;
  onClick: () => void;
  tone: PillTone;
}) {
  return (
    <button type="button" className={`pill-button pill-button--${tone}`} onClick={onClick}>
      {text}
    </button>
  );
}

/** SessionStatePill — the three-stage dot + label. */
export function SessionStatePill({ stage }: { stage: 'inactive' | 'withinSession' | 'collecting' }) {
  const label =
    stage === 'collecting' ? 'Collecting' : stage === 'withinSession' ? 'Within session' : 'Inactive';
  return (
    <span className={`state-pill state-pill--${stage}`}>
      <span className="state-pill__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** SessionMetaChip. */
export function SessionMetaChip({ icon, text }: { icon: string; text: string }) {
  return (
    <span className="meta-chip">
      <span aria-hidden="true">{icon}</span>
      {text}
    </span>
  );
}

/** SessionNotice. */
export function SessionNotice({ text }: { text: string }) {
  return (
    <div className="session-notice">
      <span aria-hidden="true">🕘</span>
      <span>{text}</span>
    </div>
  );
}

export type ActionTone = 'primary' | 'neutral' | 'success' | 'danger';

/** SessionActionButton. */
export function SessionActionButton({
  text,
  icon,
  tone,
  onClick,
  disabled = false,
}: {
  text: string;
  icon: string;
  tone: ActionTone;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`action-button action-button--${tone}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
      {text}
    </button>
  );
}

/** LoadMoreRow. */
export function LoadMoreRow({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button type="button" className="load-more" disabled={loading} onClick={onClick}>
      {loading ? 'Loading…' : 'Load more'}
    </button>
  );
}

/** ConfirmDialog. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onDismiss,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="dialog__scrim" role="presentation" onClick={onDismiss}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__title">{title}</div>
        <p className="dialog__body">{message}</p>
        <div className="dialog__actions">
          <button type="button" className="dialog__action dialog__action--muted" onClick={onDismiss}>
            Cancel
          </button>
          <button type="button" className="dialog__action" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** LabeledDropdown — a native <select>, which is also the right control on iOS. */
export function LabeledSelect({
  label,
  value,
  placeholder,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: { id: string; label: string }[];
  onSelect: (id: string) => void;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select className="input" value={value} onChange={(e) => onSelect(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Wrapper matching AppCard's panel variant. */
export function Panel({ children }: { children: ReactNode }) {
  return <div className="panel">{children}</div>;
}
