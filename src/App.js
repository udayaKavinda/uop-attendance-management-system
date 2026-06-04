import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import Login from './components/Login';
import LectureEntry from './components/LectureEntry';
import GoogleSuccess from './components/GoogleSuccess';
import AdminDashboard from './components/AdminDashboard';
import LecturerDashboard from './components/LecturerDashboard';
import AttendanceTablePage from './components/AttendanceTablePage';
import MarketingLayout from './layouts/MarketingLayout';
import StudentLayout from './layouts/StudentLayout';
import AdminLayout from './layouts/AdminLayout';
import { getMe } from './api';
import { readStoredStudent } from './utils/safeStorage';

function isStaffRole(role) {
  return role === 'admin' || role === 'lecturer';
}

function storeSessionUser(payload) {
  try {
    localStorage.setItem('student', JSON.stringify(payload));
  } catch {
    // ignore localStorage write failures
  }
}

function clearSessionUser() {
  try {
    localStorage.removeItem('student');
  } catch {
    // ignore localStorage write failures
  }
}

function LoadingGate() {
  return (
    <div className="marketing-card page-fade">
      <div className="card-content status-wrap">
        <h2 className="card-title">Checking session...</h2>
        <p className="card-subtitle">Please wait.</p>
      </div>
    </div>
  );
}

function RequireAuth({ sessionReady, user }) {
  if (!sessionReady) return <LoadingGate />;
  return user ? <Outlet /> : <Navigate to="/" replace />;
}

function App() {
  const [sessionReady, setSessionReady] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function hydrateSession() {
      const me = await getMe();
      if (cancelled) return;
      if (me && !me.error && me.studentId) {
        const role = me.role || 'student';
        const sessionUser = {
          studentId: String(me.studentId),
          role,
          email: me.email || '',
          lecturerId: me.lecturerId || null,
        };
        storeSessionUser(sessionUser);
        setUser(sessionUser);
      } else {
        clearSessionUser();
        setUser(null);
      }
      setSessionReady(true);
    }
    const cached = readStoredStudent();
    if (cached && cached.studentId) {
      setUser(cached);
    }
    hydrateSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const staff = useMemo(() => isStaffRole(user?.role), [user?.role]);

  if (!sessionReady && window.location.pathname !== '/login/success') {
    return <LoadingGate />;
  }

  return (
    <div className="App">
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<Login />} />
          <Route path="/login/success" element={<GoogleSuccess />} />
        </Route>

        <Route element={<RequireAuth sessionReady={sessionReady} user={user} />}>
          <Route element={!staff ? <Outlet /> : <Navigate to="/admin" replace />}>
            <Route path="/lecture" element={<StudentLayout />}>
              <Route index element={<LectureEntry />} />
            </Route>
          </Route>

          <Route element={staff ? <Outlet /> : <Navigate to="/lecture" replace />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={user?.role === 'lecturer' ? <LecturerDashboard /> : <AdminDashboard />} />
              <Route path="courses/:courseId/matrix" element={<AttendanceTablePage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </div>
  );
}

export default App;
