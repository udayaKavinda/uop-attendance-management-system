import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export default function Login() {
  const location = useLocation();
  const [error, setError] = useState(null);
  const [logoMissing, setLogoMissing] = useState(false);
  const [bannerMissing, setBannerMissing] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('error')) {
      const code = params.get('error');
      if (code === 'auth') {
        setError('Google authentication failed. Please try again.');
      } else {
        setError('Login error: ' + code);
      }
    }
  }, [location.search]);

  // plain Google sign-in only
  return (
    <div className="app-shell">
      <div className="auth-card">
        <div className="hero-image-wrap">
          {!bannerMissing && (
            <img
              src="/uop-campus.jpg"
              alt="University of Peradeniya campus"
              className="hero-image"
              onError={() => setBannerMissing(true)}
            />
          )}
          <div className="hero-overlay" />
          <div className="hero-fallback">University of Peradeniya</div>
        </div>
        <div className="card-content">
          <div className="brand-row">
            {!logoMissing ? (
              <img
                src="/uop-logo.png"
                alt="University of Peradeniya logo"
                className="brand-logo"
                onError={() => setLogoMissing(true)}
              />
            ) : (
              <span className="brand-fallback">UOP</span>
            )}
            <div>
              <p className="brand-title">University of Peradeniya</p>
              <p className="brand-subtitle">Attendance Management System</p>
            </div>
          </div>
          <h2 className="card-title">Sign in with Google</h2>
          <p className="card-subtitle">Use your university Google account to continue.</p>
          {error && <p className="error">{error}</p>}
          <button
            className="primary-btn"
            onClick={() => {
              // Backend handles Google OAuth; must redirect to API origin (e.g. :5000), not React (:3000)
              const base = process.env.REACT_APP_API_BASE
                || (window.location.port === '3000' ? 'http://localhost:5000' : '');
              window.location.href = `${base}/auth/google`;
            }}
          >
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}
