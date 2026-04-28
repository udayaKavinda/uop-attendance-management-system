import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMe } from '../api';

const VALID_ROLES = new Set(['admin', 'lecturer', 'student']);

export default function GoogleSuccess() {
  const navigate = useNavigate();
  const [lockupOk, setLockupOk] = useState(true);

  useEffect(() => {
    async function completeLogin() {
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
      const studentId = last.studentId != null ? String(last.studentId) : '';

      localStorage.setItem('student', JSON.stringify({
        studentId,
        role,
        email: last.email || '',
        lecturerId: last.lecturerId || null,
      }));
      navigate(role === 'admin' || role === 'lecturer' ? '/admin' : '/lecture');
    }

    completeLogin();
  }, [navigate]);

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
