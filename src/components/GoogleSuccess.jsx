import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getMe } from '../api';

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export default function GoogleSuccess() {
  const navigate = useNavigate();
  const query = useQuery();
  const [lockupOk, setLockupOk] = useState(true);

  useEffect(() => {
    async function completeLogin() {
      const studentId = query.get('studentId');
      if (!studentId) {
        navigate('/');
        return;
      }
      try {
        const me = await getMe(studentId);
        if (me?.error) {
          throw new Error(me.error);
        }
        const role = me?.role || 'student';
        localStorage.setItem('student', JSON.stringify({
          studentId,
          role,
          email: me?.email || '',
        }));
        navigate(role === 'admin' ? '/admin' : '/lecture');
      } catch {
        localStorage.setItem('student', JSON.stringify({
          studentId,
          role: 'student',
          email: '',
        }));
        navigate('/lecture');
      }
    }
    completeLogin();
  }, [query, navigate]);

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
