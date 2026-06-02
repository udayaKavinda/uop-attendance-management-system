import { Link } from 'react-router-dom';

/**
 * SessionPinPresentPage — kept for route compatibility.
 * PIN-based attendance has been replaced by BLE Bluetooth.
 * Redirect lecturers to the main dashboard.
 */
export default function SessionPinPresentPage() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <p>PIN-based attendance has been replaced by Bluetooth (BLE) attendance.</p>
      <Link to="/admin">← Back to Dashboard</Link>
    </div>
  );
}
