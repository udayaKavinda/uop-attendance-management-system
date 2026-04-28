import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';

function staffSubtitle() {
  try {
    const raw = localStorage.getItem('student');
    if (!raw) return 'University of Peradeniya';
    const { role } = JSON.parse(raw);
    if (role === 'admin') return 'University of Peradeniya · Administrator';
    if (role === 'lecturer') return 'University of Peradeniya · Lecturer';
    return 'University of Peradeniya';
  } catch {
    return 'University of Peradeniya';
  }
}

export default function AdminLayout() {
  const { pathname } = useLocation();
  const matrixMatch = pathname.match(/\/admin\/courses\/([^/]+)\/matrix$/);
  const isMatrix = Boolean(matrixMatch);
  const isPresentPin = pathname.includes('/admin/present/');

  return (
    <div className={`layout-admin ${isPresentPin ? 'layout-admin--present' : ''}`} data-layout="admin">
      {!isPresentPin ? (
        <header className="admin-chrome">
          <div className="admin-chrome__left">
            <img src="/logo.png" alt="" className="admin-chrome__logo" />
            <div>
              <p className="admin-chrome__title">Attendance administration</p>
              <p className="admin-chrome__sub">{staffSubtitle()}</p>
            </div>
          </div>
          <nav className="admin-chrome__nav" aria-label="Admin">
            {isMatrix ? (
              <>
                <Link to="/admin" className="admin-chrome__link">Dashboard</Link>
                <span className="admin-chrome__sep" aria-hidden>/</span>
                <span className="admin-chrome__crumb">Attendance table</span>
              </>
            ) : (
              <span className="admin-chrome__pill">Console</span>
            )}
          </nav>
        </header>
      ) : null}
      <div className={`layout-admin__body ${isPresentPin ? 'layout-admin__body--present' : ''}`}>
        <Outlet />
      </div>
      {!isPresentPin ? <SiteFooter /> : null}
    </div>
  );
}
