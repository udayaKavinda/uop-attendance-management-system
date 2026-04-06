import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export default function GoogleSuccess() {
  const navigate = useNavigate();
  const query = useQuery();

  useEffect(() => {
    const studentId = query.get('studentId');
    if (studentId) {
      // store and continue
      localStorage.setItem('student', JSON.stringify({ studentId }));
      navigate('/lecture');
    } else {
      navigate('/');
    }
  }, [query, navigate]);

  return (
    <div className="container">
      <p>Processing Google login...</p>
    </div>
  );
}
