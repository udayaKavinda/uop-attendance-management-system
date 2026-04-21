import React, { useState } from 'react';

export default function Done() {
  const [logoMissing, setLogoMissing] = useState(false);

  return (
    <div className="app-shell">
      <div className="auth-card">
        <div className="card-content status-wrap">
          <div className="brand-row" style={{ justifyContent: 'center' }}>
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
          </div>
          <div className="success-icon">✓</div>
          <h2 className="card-title">Attendance Recorded</h2>
          <p className="card-subtitle">Thank you. Your attendance was submitted successfully.</p>
        </div>
      </div>
    </div>
  );
}
