import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLocation, useNavigate } from 'react-router-dom';
import { exchangeOAuthCode, getMe } from '../api';

const VALID_ROLES = new Set(['admin', 'lecturer', 'student']);

export default function GoogleSuccess({ onAuthenticated }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [lockupOk, setLockupOk] = useState(true);
  const loginStarted = useRef(false);

  useEffect(() => {
    if (loginStarted.current) return undefined;
    loginStarted.current = true;

    async function completeLogin() {
      const params = new URLSearchParams(location.search);
      const code = params.get('code');

      if (code && Capacitor.isNativePlatform()) {
        const exchanged = await exchangeOAuthCode(code);
        if (exchanged?.error) {
          navigate('/?error=session');
          return;
        }
      }

      let last;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        last = await getMe();
        if (last && !last.error) break;
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }

      if (!last || last.error) {
        navigate('/?error=session');
        return;
      }

      const role = VALID_ROLES.has(last.role) ? last.role : 'student';
      const sessionUser = {
        studentId: last.studentId != null ? String(last.studentId) : '',
        role,
        email: last.email || '',
        lecturerId: last.lecturerId || null,
      };

      onAuthenticated?.(sessionUser);
      navigate(role === 'admin' || role === 'lecturer' ? '/admin' : '/lecture', { replace: true });
    }

    completeLogin();
  }, [location.search, navigate, onAuthenticated]);

  return (
    <div className="marketing-card page-fade">
      <div className="login-hero" style={{ minHeight: lockupOk ? 100 : 48 }}>
        {lockupOk && (
          <img
            src="/brand-lockup.png"
            alt=""
            className="login-hero-lockup"
            style={{ maxHeight: 56 }}
            onError={() => setLockupOk(false)}
          />
        )}
      </div>
      <div className="card-content status-wrap">
        <h2 className="card-title">Signing you in…</h2>
        <p className="card-subtitle">Completing Google authentication.</p>
      </div>
    </div>
  );
}
