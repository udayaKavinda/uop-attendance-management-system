import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getMe } from '../api';

const VALID_ROLES = new Set(['admin', 'lecturer', 'student']);

export default function GoogleSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const [lockupOk, setLockupOk] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const studentId = params.get('studentId');
    const serverRoleRaw = String(params.get('role') || '').trim();
    const serverRole = VALID_ROLES.has(serverRoleRaw) ? serverRoleRaw : '';

    async function completeLogin() {
      if (!studentId) {
        navigate('/');
        return;
      }

      async function fetchMeWithRetries() {
        let last;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          last = await getMe(studentId);
          if (last && !last.error) return last;
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        }
        return last;
      }

      try {
        const me = await fetchMeWithRetries();

        let role = 'student';
        if (me && !me.error && VALID_ROLES.has(me.role)) {
          role = me.role;
        } else if (serverRole) {
          role = serverRole;
        }

        localStorage.setItem('student', JSON.stringify({
          studentId,
          role,
          email: (me && !me.error && me.email) ? me.email : '',
          lecturerId: (me && !me.error && me.lecturerId) ? me.lecturerId : null,
        }));
        navigate(role === 'admin' || role === 'lecturer' ? '/admin' : '/lecture');
      } catch (err) {
        console.error('login/success', err);
        const fallback = serverRole && VALID_ROLES.has(serverRole) ? serverRole : 'student';
        localStorage.setItem('student', JSON.stringify({
          studentId,
          role: fallback,
          email: '',
          lecturerId: null,
        }));
        navigate(fallback === 'admin' || fallback === 'lecturer' ? '/admin' : '/lecture');
      }
    }

    completeLogin();
  }, [location.search, navigate]);

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
