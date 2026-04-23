import React from 'react';
import { Outlet } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';

export default function MarketingLayout() {
  return (
    <div className="layout-marketing" data-layout="marketing">
      <div className="layout-marketing__ambient" aria-hidden />
      <div className="layout-marketing__grid">
        <aside className="layout-marketing__aside">
          <div className="layout-marketing__aside-inner">
            <p className="layout-marketing__kicker">University of Peradeniya</p>
            <h1 className="layout-marketing__display">Attendance</h1>
            <p className="layout-marketing__lead">
              Secure sign-in for students and administrators. Use your university Google account.
            </p>
          </div>
        </aside>
        <main className="layout-marketing__main">
          <Outlet />
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
