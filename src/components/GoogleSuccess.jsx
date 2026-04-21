import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getMe } from '../api';

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export default function GoogleSuccess() {
  const navigate = useNavigate();
  const query = useQuery();

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
        // Fallback: do not block login success page if profile endpoint is temporarily unreachable.
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
    <div className="app-shell">
      <div className="auth-card">
        <div className="card-content status-wrap">
          <h2 className="card-title">Signing you in...</h2>
          <p className="card-subtitle">Please wait while we complete Google authentication.</p>
        </div>
      </div>
    </div>
  );
}
