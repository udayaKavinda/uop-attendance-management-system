import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { verifyLecture, recordAttendance } from '../api';

export default function LectureEntry() {
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // attempt geolocation
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const verify = await verifyLecture({
            lectureCode: code,
            lat: latitude,
            lng: longitude,
          });
          if (verify.success) {
            const student = JSON.parse(localStorage.getItem('student') || '{}');
            const method = 'webauthn'; // only path to this screen is after biometric verification
            const record = await recordAttendance({
              studentId: student.studentId,
              lectureCode: code,
              method,
              lat: latitude,
              lng: longitude,
            });
            if (record.success) {
              navigate('/done');
            } else {
              setError(record.error || 'Failed to record attendance');
            }
          } else {
            setError(verify.error || 'Lecture verification failed');
          }
        } catch (err) {
          setError(err.message);
        }
      },
      (err) => {
        setError('Unable to get location: ' + err.message);
      }
    );
  };

  return (
    <div className="container">
      <form className="card" onSubmit={handleSubmit}>
        <h2>Enter Lecture Code</h2>
        {error && <p className="error">{error}</p>}
        <input
          type="text"
          placeholder="8-digit lecture code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <button type="submit">Submit</button>
      </form>
    </div>
  );
}
