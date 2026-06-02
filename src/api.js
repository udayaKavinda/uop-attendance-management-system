import { notifySessionInvalid } from './utils/authRedirect';

function apiBase() {
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE;
  if (typeof window !== 'undefined' && window.location.port === '3000') return 'http://localhost:5000';
  return '';
}

async function safeFetchJson(url, init = {}) {
  try {
    const resp = await fetch(url, { credentials: 'include', ...init, headers: { ...(init.headers || {}) } });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (resp.status === 401) notifySessionInvalid();
      const msg = data.error || data.message || `Request failed (${resp.status})`;
      return { ...data, error: msg };
    }
    return data;
  } catch (err) {
    return { error: err?.message || 'Network error' };
  }
}

export async function getMe() { return safeFetchJson(`${apiBase()}/api/me`); }
export async function logoutSession() { return safeFetchJson(`${apiBase()}/api/logout`, { method: 'POST' }); }

export async function getAttendanceStatus(courseId) {
  return safeFetchJson(
    `${apiBase()}/api/attendance-status?courseId=${encodeURIComponent(courseId || '')}`,
  );
}

// ── Bluetooth ─────────────────────────────────────────────────────────────────

export async function getBluetoothTarget(courseId) {
  return safeFetchJson(
    `${apiBase()}/api/bluetooth-target?courseId=${encodeURIComponent(courseId || '')}`,
  );
}

export async function submitBluetoothAttendance(payload) {
  return safeFetchJson(`${apiBase()}/api/bluetooth-attendance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function startSessionBluetooth(sessionId) {
  return safeFetchJson(
    `${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/bluetooth/start`,
    { method: 'PATCH' },
  );
}

export async function stopSessionBluetooth(sessionId) {
  return safeFetchJson(
    `${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/bluetooth/stop`,
    { method: 'PATCH' },
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** Staff-only: live pin for an active session on this course (lecturer = own courses only). */
export async function getLectureCode(courseId) {
  return safeFetchJson(
    `${apiBase()}/api/lecture-code?courseId=${encodeURIComponent(courseId || '')}`,
  );
}

export async function getCourses() {
  const data = await safeFetchJson(`${apiBase()}/api/courses`);
  if (data.error) return { error: data.error, items: [] };
  const raw = data.items ?? data.data;
  return { items: Array.isArray(raw) ? raw : [] };
}

export async function getRunningCourses() {
  const data = await safeFetchJson(`${apiBase()}/api/courses/running`);
  if (data.error) return { error: data.error, items: [] };
  const raw = data.items ?? data.data;
  return { items: Array.isArray(raw) ? raw : [] };
}

export async function getAdminCourses() {
  const data = await safeFetchJson(`${apiBase()}/api/admin/courses`);
  if (data.error) return data;
  const raw = data.items ?? data.data;
  return { ...data, items: Array.isArray(raw) ? raw : [] };
}

export async function createAdminCourse(payload) {
  return safeFetchJson(`${apiBase()}/api/admin/courses`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}

export async function patchCourseAssignLecturer(courseId, lecturerIds) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/assign-lecturer`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lecturerIds }),
  });
}

export async function getAdminLecturers(q) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  const data = await safeFetchJson(`${apiBase()}/api/admin/lecturers${qs}`);
  if (data.error) return data;
  const raw = data.items ?? data.data;
  return { ...data, items: Array.isArray(raw) ? raw : [] };
}

export async function createAdminLecturer(payload) {
  return safeFetchJson(`${apiBase()}/api/admin/lecturers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}

export async function deleteAdminLecturer(lecturerId) {
  return safeFetchJson(`${apiBase()}/api/admin/lecturers/${encodeURIComponent(lecturerId)}`, {
    method: 'DELETE',
  });
}


export async function deleteAdminCourse(courseId) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}`, { method: 'DELETE' });
}

export async function disableAdminCourse(courseId) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/disable`, { method: 'PATCH' });
}

export async function enableAdminCourse(courseId) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/enable`, { method: 'PATCH' });
}

export async function getAdminSessions(courseId) {
  const data = await safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/sessions`);
  if (data.error) return data;
  const raw = data.items ?? data.data;
  return { ...data, items: Array.isArray(raw) ? raw : [] };
}

export async function createAdminSession(courseId, payload) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}

export async function deleteAdminSession(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

export async function activateAdminSession(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/activate`, { method: 'PATCH' });
}

export async function deactivateAdminSession(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/deactivate`, { method: 'PATCH' });
}

export async function getAdminAllSessions() {
  const data = await safeFetchJson(`${apiBase()}/api/admin/sessions`);
  if (data.error) return data;
  const raw = data.items ?? data.data;
  return { ...data, items: Array.isArray(raw) ? raw : [] };
}

export async function patchAdminSessionAttendancePaused(sessionId, paused) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/attendance-paused`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }),
  });
}

export async function getAdminAttendanceMatrix(courseId) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/attendance-matrix`);
}

/** Lecturer: poll the current rotating BLE payload for a session. */
export async function getCurrentBlePayload(sessionId) {
  return safeFetchJson(`${apiBase()}/api/ble/current-payload/${encodeURIComponent(sessionId)}`);
}

/** Student: submit a BLE-scanned payload to verify and mark attendance. */
export async function verifyBlePayload(courseId, payload) {
  return safeFetchJson(`${apiBase()}/api/ble/verify-payload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, payload }),
  });
}

/** Lecturer: get currently active/running sessions (staff-scoped). */
export async function getActiveSessions() {
  const data = await safeFetchJson(`${apiBase()}/api/admin/sessions/current-codes`);
  if (data.error) return { error: data.error, sessions: [] };
  const raw = data.items ?? data.data;
  const sessions = (Array.isArray(raw) ? raw : []).map((s) => ({
    ...s,
    id: s.sessionId || s._id,
  }));
  return { sessions };
}

/** Lecturer: get all sessions (history). */
export async function getSessions() {
  const data = await safeFetchJson(`${apiBase()}/api/admin/sessions`);
  if (data.error) return { error: data.error, sessions: [] };
  const raw = data.items ?? data.data;
  return { sessions: Array.isArray(raw) ? raw.map((s) => ({ ...s, id: s._id })) : [] };
}

/** Lecturer: activate a session (start it). */
export async function startSession(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/activate`, {
    method: 'PATCH',
  });
}

/** Lecturer: deactivate a session (end it). */
export async function endSession(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/deactivate`, {
    method: 'PATCH',
  });
}

/** Lecturer: get attendance records for a session. */
export async function getAttendance(sessionId) {
  const data = await safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/attendance`);
  if (data.error) return { error: data.error, records: [] };
  const raw = data.records ?? data.items ?? data.data;
  return { records: Array.isArray(raw) ? raw : [] };
}

/** Lecturer: returns a URL for downloading attendance as Excel. */
export function exportAttendanceUrl(sessionId) {
  return `${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/attendance/export`;
}

export async function startAdminSessionRotation(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/rotation/start`, { method: 'PATCH' });
}

export async function stopAdminSessionRotation(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/rotation/stop`, { method: 'PATCH' });
}

export async function getAdminCurrentSessionCodes() {
  const data = await safeFetchJson(`${apiBase()}/api/admin/sessions/current-codes`);
  if (data.error) return { error: data.error, items: [] };
  const raw = data.items ?? data.data;
  return { items: Array.isArray(raw) ? raw : [] };
}

export async function getAdminSettings() { return safeFetchJson(`${apiBase()}/api/admin/settings`); }

export async function patchAdminStudentDomainRestriction(restrictStudentGoogleDomain) {
  return safeFetchJson(`${apiBase()}/api/admin/settings/student-domain-restriction`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ restrictStudentGoogleDomain }),
  });
}
