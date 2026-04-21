import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polygon, useMapEvents } from 'react-leaflet';
import { getAdminCourseConfigs, saveAdminCourseConfig } from '../api';

const COURSE_CODES = ['EE669', 'EM2020', 'EM503', 'EM526', 'EM1050', 'EM527', 'EM524'];
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
const ENGINEERING_FACULTY_CENTER = [7.2548, 80.5974];

function PolygonEditor({ onAddPoint }) {
  useMapEvents({
    click(e) {
      onAddPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function emptyConfig(courseCode) {
  return {
    courseCode,
    lectureDay: 'MON',
    startTime: '08:00',
    endTime: '10:00',
    recurring: true,
    polygon: [],
  };
}

export default function AdminDashboard() {
  const [selectedCourse, setSelectedCourse] = useState(COURSE_CODES[0]);
  const [configs, setConfigs] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [logoMissing, setLogoMissing] = useState(false);

  const student = useMemo(() => JSON.parse(localStorage.getItem('student') || '{}'), []);
  const studentId = student?.studentId || '';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const resp = await getAdminCourseConfigs(studentId);
      if (cancelled) return;
      if (resp.error) {
        setError(resp.error);
      } else {
        const next = {};
        (resp.items || []).forEach((item) => {
          next[item.courseCode] = { ...emptyConfig(item.courseCode), ...item };
        });
        COURSE_CODES.forEach((courseCode) => {
          if (!next[courseCode]) next[courseCode] = emptyConfig(courseCode);
        });
        setConfigs(next);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [studentId]);

  const current = configs[selectedCourse] || emptyConfig(selectedCourse);

  const onChangeField = (key, value) => {
    setConfigs((prev) => ({
      ...prev,
      [selectedCourse]: {
        ...emptyConfig(selectedCourse),
        ...(prev[selectedCourse] || {}),
        [key]: value,
      },
    }));
  };

  const addPoint = (point) => {
    onChangeField('polygon', [...(current.polygon || []), point]);
    setMessage('Point added. Continue clicking to draw polygon, then save.');
  };

  const undoPoint = () => {
    const next = [...(current.polygon || [])];
    next.pop();
    onChangeField('polygon', next);
  };

  const clearPolygon = () => {
    onChangeField('polygon', []);
    setMessage('Polygon cleared. Click Save to persist.');
  };

  const onSave = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    const payload = {
      lectureDay: current.lectureDay,
      startTime: current.startTime,
      endTime: current.endTime,
      recurring: current.recurring,
      polygon: current.polygon || [],
    };
    const resp = await saveAdminCourseConfig(studentId, selectedCourse, payload);
    if (resp.error) {
      setError(resp.error);
    } else {
      setConfigs((prev) => ({
        ...prev,
        [selectedCourse]: { ...emptyConfig(selectedCourse), ...(resp.config || current) },
      }));
      setMessage('Saved successfully.');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="app-shell">
        <div className="auth-card"><div className="card-content">Loading admin dashboard...</div></div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="auth-card admin-card">
        <div className="card-content">
          <div className="brand-row">
            {!logoMissing ? (
              <img
                src="/uop-logo.png"
                alt="University of Peradeniya logo"
                className="brand-logo"
                onError={() => setLogoMissing(true)}
              />
            ) : <span className="brand-fallback">UOP</span>}
            <div>
              <p className="brand-title">Admin Services</p>
              <p className="brand-subtitle">Schedule and geofence management</p>
            </div>
          </div>

          {error && <p className="error">{error}</p>}
          {message && <p className="card-subtitle" style={{ marginBottom: '0.8rem' }}>{message}</p>}

          <label className="field-label" htmlFor="adminCourseCode">Course Code</label>
          <select
            id="adminCourseCode"
            className="input"
            value={selectedCourse}
            onChange={(e) => setSelectedCourse(e.target.value)}
          >
            {COURSE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <div className="admin-grid">
            <div>
              <label className="field-label" htmlFor="lectureDay">Lecture Day</label>
              <select
                id="lectureDay"
                className="input"
                value={current.lectureDay}
                onChange={(e) => onChangeField('lectureDay', e.target.value)}
              >
                {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="startTime">Start Time</label>
              <input id="startTime" className="input" type="time" value={current.startTime} onChange={(e) => onChangeField('startTime', e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="endTime">End Time</label>
              <input id="endTime" className="input" type="time" value={current.endTime} onChange={(e) => onChangeField('endTime', e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="recurring">Recurring</label>
              <select
                id="recurring"
                className="input"
                value={current.recurring ? 'yes' : 'no'}
                onChange={(e) => onChangeField('recurring', e.target.value === 'yes')}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>

          <p className="field-label" style={{ marginTop: '1rem' }}>Course Geofence Polygon</p>
          <p className="card-subtitle" style={{ marginBottom: '0.6rem' }}>
            Click on the map to draw points. Use Undo/Clear to redraw, then save.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <button className="primary-btn" type="button" style={{ marginTop: 0 }} onClick={undoPoint} disabled={(current.polygon || []).length === 0}>Undo Last Point</button>
            <button className="primary-btn" type="button" style={{ marginTop: 0, background: '#374151', boxShadow: 'none' }} onClick={clearPolygon}>Clear Polygon</button>
          </div>
          <div className="map-wrap">
            <MapContainer center={ENGINEERING_FACULTY_CENTER} zoom={16} scrollWheelZoom style={{ height: 360, width: '100%' }}>
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <PolygonEditor onAddPoint={addPoint} />
              {Array.isArray(current.polygon) && current.polygon.length >= 3 && (
                <Polygon positions={current.polygon.map((p) => [p.lat, p.lng])} pathOptions={{ color: '#7a1414' }} />
              )}
            </MapContainer>
          </div>

          <button className="primary-btn" type="button" disabled={saving} onClick={onSave}>
            {saving ? 'Saving...' : 'Save Course Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
