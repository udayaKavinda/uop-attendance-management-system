import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  MapContainer, TileLayer, Polygon, CircleMarker, Popup, LayersControl, useMap,
} from 'react-leaflet';
import { getSessionsForGpsAnalysis, getSessionGpsSamples } from '../api';

/* ─── constants ─────────────────────────────────────────────────────────────── */

const MAP_CENTER = [7.2548, 80.5974];
const MAP_ZOOM   = 17;

const OSM_TILE_URL          = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION       = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const SATELLITE_TILE_URL    = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION = 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const GPS_POINT_COLOR  = '#6366f1';
const GEOFENCE_COLOR   = '#FF1493';

/**
 * Buffer rings rendered largest → smallest so smaller buffers sit on top.
 * Each colour is a distinct band in the red→orange→yellow→green→teal spectrum.
 */
const BUFFER_LEVELS = [
  { m: 100, color: '#7f1d1d', label: '100 m' },
  { m: 75,  color: '#991b1b', label: '75 m'  },
  { m: 50,  color: '#b91c1c', label: '50 m'  },
  { m: 45,  color: '#c2410c', label: '45 m'  },
  { m: 40,  color: '#ea580c', label: '40 m'  },
  { m: 35,  color: '#d97706', label: '35 m'  },
  { m: 30,  color: '#ca8a04', label: '30 m'  },
  { m: 25,  color: '#a16207', label: '25 m'  },
  { m: 20,  color: '#4d7c0f', label: '20 m'  },
  { m: 15,  color: '#15803d', label: '15 m'  },
  { m: 10,  color: '#0f766e', label: '10 m'  },
  { m: 5,   color: '#0369a1', label: '5 m'   },
];

/* ─── geo helpers ────────────────────────────────────────────────────────────── */

/**
 * Expand a polygon outward from its centroid by `meters`.
 * Accurate for convex campus polygons (building footprints, courtyards).
 */
function expandPolygon(polygon, meters) {
  if (!polygon || polygon.length < 3) return polygon;
  const centLat = polygon.reduce((s, p) => s + p.lat, 0) / polygon.length;
  const centLng = polygon.reduce((s, p) => s + p.lng, 0) / polygon.length;
  const latPerM = 1 / 111320;
  const lngPerM = 1 / (111320 * Math.cos(centLat * Math.PI / 180));
  return polygon.map((pt) => {
    const dLat = pt.lat - centLat;
    const dLng = pt.lng - centLng;
    const distM = Math.sqrt((dLat / latPerM) ** 2 + (dLng / lngPerM) ** 2);
    if (distM === 0) return pt;
    const scale = (distM + meters) / distM;
    return { lat: centLat + dLat * scale, lng: centLng + dLng * scale };
  });
}

const toLeafletRing = (ring) => ring.map((p) => [p.lat, p.lng]);

/* ─── display helpers ────────────────────────────────────────────────────────── */

function emailPrefix(email) {
  if (!email) return '—';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

function fmtTimestamp(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); }
  catch { return String(ts); }
}

function sessionLabel(s) {
  const code = s.course?.code || '?';
  const name = s.course?.name ? ` — ${s.course.name}` : '';
  const day  = s.lectureDay  || '';
  const time = `${s.startTime || ''}–${s.endTime || ''}`;
  return `${code}${name} · ${day} ${time}`;
}

/* ─── sub-components ─────────────────────────────────────────────────────────── */

/** Fits the Leaflet map viewport to the current visible GPS points. */
function MapFitter({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    map.fitBounds(
      [
        [Math.min(...lats) - 0.0003, Math.min(...lngs) - 0.0003],
        [Math.max(...lats) + 0.0003, Math.max(...lngs) + 0.0003],
      ],
      { padding: [48, 48] },
    );
  }, [map, points]);
  return null;
}

function BasemapLayerControl() {
  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer checked name="Street map">
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} maxNativeZoom={19} maxZoom={22} />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Satellite">
        <TileLayer attribution={SATELLITE_ATTRIBUTION} url={SATELLITE_TILE_URL} maxNativeZoom={19} maxZoom={22} />
      </LayersControl.BaseLayer>
    </LayersControl>
  );
}

/* ─── main component ─────────────────────────────────────────────────────────── */

export default function AttendanceGpsAnalysis() {
  /* session selector */
  const [sessions, setSessions]             = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionSearch, setSessionSearch]   = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectorOpen, setSelectorOpen]     = useState(false);
  const selectorRef = useRef(null);

  /* loaded session GPS data */
  const [sessionData, setSessionData] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError]     = useState('');

  /* student panel */
  const [studentSearch, setStudentSearch]   = useState('');
  const [selectedStudents, setSelectedStudents] = useState(new Set());

  /* ── load all sessions for the selector on mount ── */
  useEffect(() => {
    setSessionsLoading(true);
    getSessionsForGpsAnalysis()
      .then((resp) => setSessions(resp.items || []))
      .catch(() => {})
      .finally(() => setSessionsLoading(false));
  }, []);

  /* ── load GPS samples when a session is selected ── */
  useEffect(() => {
    if (!selectedSessionId) { setSessionData(null); setDataError(''); return; }
    setDataLoading(true);
    setDataError('');
    setSessionData(null);
    setSelectedStudents(new Set());
    getSessionGpsSamples(selectedSessionId)
      .then((resp) => {
        if (resp.error) { setDataError(resp.error); return; }
        setSessionData(resp);
        // Pre-select all students
        const ids = new Set((resp.items || []).map((s) => String(s.student?._id || s.student)));
        setSelectedStudents(ids);
      })
      .catch((e) => setDataError(e?.message || 'Failed to load GPS data'))
      .finally(() => setDataLoading(false));
  }, [selectedSessionId]);

  /* ── close selector on outside click ── */
  useEffect(() => {
    function handle(e) {
      if (selectorRef.current && !selectorRef.current.contains(e.target)) {
        setSelectorOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  /* ── derived data ── */

  const filteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const code = (s.course?.code || '').toLowerCase();
      const name = (s.course?.name || '').toLowerCase();
      const day  = (s.lectureDay || '').toLowerCase();
      const time = `${s.startTime || ''} ${s.endTime || ''}`.toLowerCase();
      return code.includes(q) || name.includes(q) || day.includes(q) || time.includes(q);
    });
  }, [sessions, sessionSearch]);

  const studentList = useMemo(() => {
    if (!sessionData?.items) return [];
    const map = new Map();
    for (const sample of sessionData.items) {
      const id = String(sample.student?._id || sample.student);
      if (!map.has(id)) map.set(id, { id, email: sample.student?.email || id });
    }
    return Array.from(map.values()).sort((a, b) =>
      emailPrefix(a.email).localeCompare(emailPrefix(b.email)),
    );
  }, [sessionData]);

  const filteredStudentList = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return studentList;
    return studentList.filter((s) =>
      emailPrefix(s.email).toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
    );
  }, [studentList, studentSearch]);

  const visibleSamples = useMemo(() => {
    if (!sessionData?.items) return [];
    return sessionData.items.filter((s) =>
      selectedStudents.has(String(s.student?._id || s.student)),
    );
  }, [sessionData, selectedStudents]);

  const polygons = useMemo(() => sessionData?.session?.polygons || [], [sessionData]);

  const bufferRings = useMemo(() =>
    BUFFER_LEVELS.map(({ m, color, label }) => ({
      m, color, label,
      rings: polygons.map((poly) => expandPolygon(poly, m)),
    })),
  [polygons]);

  /* ── student toggle ── */
  const toggleStudent = useCallback((id) => {
    setSelectedStudents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() =>
    setSelectedStudents(new Set(studentList.map((s) => s.id))),
  [studentList]);

  const clearAll = useCallback(() => setSelectedStudents(new Set()), []);

  /* ── counts ── */
  const totalStudents   = studentList.length;
  const selectedCount   = selectedStudents.size;
  const totalSamples    = sessionData?.items?.length ?? 0;
  const visibleCount    = visibleSamples.length;

  /* ─── render ─────────────────────────────────────────────────────────── */
  return (
    <div className="tab-panel">

      {/* Header */}
      <header className="section-head">
        <p className="section-kicker">Analysis</p>
        <h2 className="section-title">Attendance GPS Analysis</h2>
        <p className="section-desc">
          Select a session to visualise all GPS samples collected from students during the 2-minute
          collection window. Geofence and buffer zones are overlaid for post-hoc location analysis.
        </p>
      </header>

      {/* Session selector */}
      <div className="form-section">
        <label className="field-label" htmlFor="gpsSessionSearch">Session</label>
        <div className="course-combobox" ref={selectorRef} style={{ maxWidth: 540 }}>
          <input
            id="gpsSessionSearch"
            className="input"
            type="text"
            autoComplete="off"
            placeholder={sessionsLoading ? 'Loading sessions…' : 'Search by course code, name, day or time…'}
            value={sessionSearch}
            onFocus={() => setSelectorOpen(true)}
            onChange={(e) => { setSessionSearch(e.target.value); setSelectorOpen(true); }}
          />
          {selectorOpen && filteredSessions.length > 0 && (
            <ul className="course-combobox__menu" role="listbox" style={{ maxHeight: 300, overflowY: 'auto' }}>
              {filteredSessions.map((s) => (
                <li key={s._id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    className="course-combobox__option"
                    aria-selected={String(s._id) === selectedSessionId}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSelectedSessionId(String(s._id));
                      setSessionSearch(sessionLabel(s));
                      setSelectorOpen(false);
                    }}
                  >
                    <span className="course-combobox__code">{s.course?.code || '?'}</span>
                    <span className="course-combobox__name">{sessionLabel(s)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* State feedback */}
      {dataLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.5rem 0' }}>
          <div className="session-spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
          <p className="section-desc" style={{ margin: 0 }}>Loading GPS data…</p>
        </div>
      )}
      {dataError && <p className="error">{dataError}</p>}
      {selectedSessionId && !dataLoading && !dataError && sessionData && totalSamples === 0 && (
        <div className="student-empty">
          <div className="student-empty__icon" aria-hidden>📡</div>
          <p className="student-empty__title">No GPS samples yet</p>
          <p className="student-empty__text">
            No GPS data has been recorded for this session. Samples appear here once students submit attendance.
          </p>
        </div>
      )}

      {/* Main layout */}
      {sessionData && totalSamples > 0 && (
        <div className="gps-analysis-layout">

          {/* Map column */}
          <div className="gps-map-col">

            {/* Stats bar */}
            <div className="gps-stats-bar">
              <span>Students: <strong>{totalStudents}</strong></span>
              <span>Selected: <strong>{selectedCount}</strong></span>
              <span>Total samples: <strong>{totalSamples}</strong></span>
              <span>Visible points: <strong>{visibleCount}</strong></span>
            </div>

            {/* Map */}
            <div className="map-wrap">
              <MapContainer
                center={MAP_CENTER}
                zoom={MAP_ZOOM}
                minZoom={3}
                maxZoom={22}
                scrollWheelZoom={true}
                doubleClickZoom={true}
                zoomControl={true}
                style={{ height: 560, width: '100%' }}
              >
                <BasemapLayerControl />
                {visibleSamples.length > 0 && (
                  <MapFitter points={visibleSamples.map((s) => ({ lat: s.lat, lng: s.lng }))} />
                )}

                {/* Buffer polygons — largest first, smallest on top */}
                {bufferRings.map(({ m, color, rings }) =>
                  rings.map((ring, ri) => (
                    <Polygon
                      key={`buf-${m}-${ri}`}
                      positions={toLeafletRing(ring)}
                      pathOptions={{
                        color,
                        weight: 1,
                        opacity: 0.65,
                        fillColor: color,
                        fillOpacity: 0.04,
                      }}
                    />
                  )),
                )}

                {/* Original geofence */}
                {polygons.map((ring, ri) => (
                  <Polygon
                    key={`geo-${ri}`}
                    positions={toLeafletRing(ring)}
                    pathOptions={{
                      color: GEOFENCE_COLOR,
                      weight: 2.5,
                      opacity: 0.95,
                      fillColor: GEOFENCE_COLOR,
                      fillOpacity: 0.06,
                    }}
                  />
                ))}

                {/* GPS sample points — every sample, individually clickable */}
                {visibleSamples.map((sample, idx) => {
                  const studentEmail = sample.student?.email || String(sample.student);
                  const prefix = emailPrefix(studentEmail);
                  return (
                    <CircleMarker
                      key={sample._id || idx}
                      center={[sample.lat, sample.lng]}
                      radius={5}
                      pathOptions={{
                        color: GPS_POINT_COLOR,
                        weight: 1.5,
                        fillColor: GPS_POINT_COLOR,
                        fillOpacity: 0.8,
                      }}
                    >
                      <Popup minWidth={240} maxWidth={320}>
                        <div style={{ fontSize: '0.82em', lineHeight: 1.65 }}>
                          <p style={{ margin: '0 0 2px', fontWeight: 800 }}>{prefix}</p>
                          <p style={{ margin: '0 0 6px', color: '#64748b', fontSize: '0.92em' }}>{studentEmail}</p>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95em' }}>
                            <tbody>
                              {[
                                ['Time',     fmtTimestamp(sample.clientTimestamp || sample.timestamp)],
                                ['Latitude', sample.lat?.toFixed(7)],
                                ['Longitude',sample.lng?.toFixed(7)],
                                ['Accuracy', sample.accuracy != null ? `${Math.round(sample.accuracy)} m` : '—'],
                                ['Device',   sample.device?.type   || '—'],
                                ['OS',       sample.device?.os     || '—'],
                                ['Browser',  sample.device?.browser|| '—'],
                                sample.device?.model ? ['Model', sample.device.model] : null,
                                ['Session',  String(sample.session || '—').slice(-8)],
                                ['Course',   sessionData.session?.course?.code || '—'],
                              ].filter(Boolean).map(([label, val]) => (
                                <tr key={label}>
                                  <td style={{ paddingRight: 8, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{label}</td>
                                  <td style={{ wordBreak: 'break-all', color: '#0f172a' }}>{val}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {sample.device?.userAgent && (
                            <p style={{ margin: '6px 0 0', fontSize: '0.82em', color: '#94a3b8', wordBreak: 'break-all' }}>
                              {sample.device.userAgent}
                            </p>
                          )}
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            </div>

            {/* Map legend */}
            <div className="gps-legend">
              <p className="gps-legend__title">Legend</p>
              <div className="gps-legend__items">
                <span className="gps-legend__item">
                  <span className="gps-legend__swatch" style={{ background: GEOFENCE_COLOR }} />
                  Geofence
                </span>
                <span className="gps-legend__item">
                  <span className="gps-legend__dot" style={{ background: GPS_POINT_COLOR }} />
                  GPS sample
                </span>
                {BUFFER_LEVELS.map(({ m, color, label }) => (
                  <span key={m} className="gps-legend__item">
                    <span className="gps-legend__swatch" style={{ background: color, opacity: 0.8 }} />
                    {label} buffer
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Student panel */}
          <div className="gps-student-panel">
            <p className="gps-student-panel__title">Students ({totalStudents})</p>

            <input
              className="input"
              type="text"
              placeholder="Search…"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              style={{ padding: '0.5rem 0.75rem', fontSize: '0.85em' }}
            />

            <div className="gps-student-panel__actions">
              <button type="button" className="pill-btn" onClick={selectAll}>Select all</button>
              <button type="button" className="pill-btn" onClick={clearAll}>Clear all</button>
            </div>

            <ul className="gps-student-list">
              {filteredStudentList.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`gps-student-btn${selectedStudents.has(s.id) ? ' selected' : ''}`}
                    onClick={() => toggleStudent(s.id)}
                  >
                    {emailPrefix(s.email)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
