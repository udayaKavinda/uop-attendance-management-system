import { Navigate, Routes, Route } from 'react-router-dom';
import Login from './components/Login';
import LectureEntry from './components/LectureEntry';
import GoogleSuccess from './components/GoogleSuccess';
import AdminDashboard from './components/AdminDashboard';

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

function ProtectedRoute({ children }) {
  return isLoggedIn() ? children : <Navigate to="/" replace />;
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

function StudentRoute({ children }) {
  return roleOfCurrentUser() === 'admin' ? <Navigate to="/admin" replace /> : children;
}

function AdminRoute({ children }) {
  return roleOfCurrentUser() === 'admin' ? children : <Navigate to="/lecture" replace />;
}

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login/success" element={<GoogleSuccess />} />
        <Route path="/lecture" element={<ProtectedRoute><StudentRoute><LectureEntry /></StudentRoute></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><AdminRoute><AdminDashboard /></AdminRoute></ProtectedRoute>} />
      </Routes>
    </div>
  );
}

export default App;
