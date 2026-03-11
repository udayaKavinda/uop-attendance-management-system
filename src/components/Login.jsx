import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export default function Login() {
  const location = useLocation();
  const [error, setError] = useState(null);

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
    <div className="container">
      <div className="card">
        <h2>Sign in with Google</h2>
        {error && <p className="error" style={{ color: 'red' }}>{error}</p>}
        <button
          className="login-btn"
          style={{ background: '#4285f4', color: '#fff', display: 'block' }}
          onClick={() => {
            // Backend handles Google OAuth; must redirect to API origin (e.g. :5000), not React (:3000)
            const base = process.env.REACT_APP_API_BASE
              || (window.location.port === '3000' ? 'http://localhost:5000' : '');
            window.location.href = `${base}/auth/google`;
          }}
        >
          Tap to sign in with Google
        </button>
      </div>
    </div>
  );
}
