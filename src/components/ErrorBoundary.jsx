import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }

  componentDidCatch(error, info) {
    console.error('UI error boundary:', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="marketing-card page-fade" style={{ maxWidth: 440, margin: '2rem auto', padding: '1.5rem' }}>
          <h2 className="card-title" style={{ marginTop: 0 }}>Something went wrong</h2>
          <p className="card-subtitle" style={{ marginBottom: '1rem' }}>
            The page hit an unexpected error. You can reload and try again. If this keeps happening, sign out and sign in again.
          </p>
          <p className="error" style={{ fontSize: '0.85rem', wordBreak: 'break-word' }}>{this.state.message}</p>
          <button
            type="button"
            className="primary-btn"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
          <button
            type="button"
            className="pill-btn"
            style={{ marginTop: '0.75rem', width: '100%', justifyContent: 'center' }}
            onClick={() => {
              localStorage.removeItem('student');
              window.location.href = '/';
            }}
          >
            Clear sign-in and go home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
