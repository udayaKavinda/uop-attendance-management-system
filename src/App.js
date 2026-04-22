import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import Login from './components/Login';
import LectureEntry from './components/LectureEntry';
import GoogleSuccess from './components/GoogleSuccess';
import AdminDashboard from './components/AdminDashboard';
import AttendanceTablePage from './components/AttendanceTablePage';
import MarketingLayout from './layouts/MarketingLayout';
import StudentLayout from './layouts/StudentLayout';
import AdminLayout from './layouts/AdminLayout';

function isLoggedIn() {
  try {
    const raw = localStorage.getItem('student');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed && parsed.studentId);
  } catch {
    return false;
  }
}

function roleOfCurrentUser() {
  try {
    const raw = localStorage.getItem('student');
    if (!raw) return 'student';
    const parsed = JSON.parse(raw);
    return parsed?.role || 'student';
  } catch {
    return 'student';
  }
}

function RequireAuth() {
  return isLoggedIn() ? <Outlet /> : <Navigate to="/" replace />;
}

function RequireStudent() {
  return roleOfCurrentUser() !== 'admin' ? <Outlet /> : <Navigate to="/admin" replace />;
}

function RequireAdmin() {
  return roleOfCurrentUser() === 'admin' ? <Outlet /> : <Navigate to="/lecture" replace />;
}

function App() {
  return (
    <div className="App">
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<Login />} />
          <Route path="/login/success" element={<GoogleSuccess />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<RequireStudent />}>
            <Route path="/lecture" element={<StudentLayout />}>
              <Route index element={<LectureEntry />} />
            </Route>
          </Route>

          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="courses/:courseId/matrix" element={<AttendanceTablePage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </div>
  );
}

export default App;
