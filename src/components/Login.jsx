import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export default function Login() {
  const location = useLocation();
  const [error, setError] = useState(null);
  const [logoMissing, setLogoMissing] = useState(false);
  const [lockupMissing, setLockupMissing] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('error')) {
      const code = params.get('error');
      if (code === 'auth') {
        setError('Google authentication failed. Please try again.');
      } else if (code === 'profile') {
        setError('Could not load your profile from the server. Check that the API is reachable, then sign in again.');
      } else {
        setError('Login error: ' + code);
      }
    }
  }, [location.search]);

  return (
    <div className="marketing-card page-fade">
      <div className="login-hero">
        {!lockupMissing && (
          <img
            src="/brand-lockup.png"
            alt="University of Peradeniya"
            className="login-hero-lockup"
            onError={() => setLockupMissing(true)}
          />
        )}
        {lockupMissing && (
          <p className="card-subtitle" style={{ margin: 0, textAlign: 'center' }}>University of Peradeniya</p>
        )}
      </div>
      <div className="card-content">
        <div className="brand-row">
          {!logoMissing ? (
            <img
              src="/logo.png"
              alt="University of Peradeniya logo"
              className="brand-logo"
              onError={() => setLogoMissing(true)}
            />
          ) : (
            <span className="brand-fallback">UOP</span>
          )}
          <div>
            <p className="brand-title">Sign in</p>
            <p className="brand-subtitle">Attendance Management System</p>
          </div>
        </div>
        <h2 className="card-title">Continue with Google</h2>
        <p className="card-subtitle">Use your university Google account.</p>
        {error && <p className="error">{error}</p>}
        <button
          type="button"
          className="primary-btn"
          onClick={() => {
            const base = process.env.REACT_APP_API_BASE
              || (window.location.port === '3000' ? 'http://localhost:5000' : '');
            window.location.href = `${base}/auth/google`;
          }}
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
