import React, { useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { readStoredStudent } from '../utils/safeStorage';

export default function StudentLayout() {
  const student = useMemo(() => readStoredStudent(), []);

  return (
    <div className="layout-student" data-layout="student">
      <header className="student-chrome">
        <div className="student-chrome__brand">
          <img src="/logo.png" alt="" className="student-chrome__logo" />
          <div>
            <p className="student-chrome__title">Mark attendance</p>
            <p className="student-chrome__sub">University of Peradeniya</p>
          </div>
        </div>
        {student?.email ? (
          <span className="student-chrome__user" title={student.email}>
            {student.email.split('@')[0]}
          </span>
        ) : null}
      </header>
      <main className="layout-student__main">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
