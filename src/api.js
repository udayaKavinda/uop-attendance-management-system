import { notifySessionInvalid } from './utils/authRedirect';

function apiBase() {
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE;
  if (typeof window !== 'undefined' && window.location.port === '3000') return 'http://localhost:5000';
  return '';
}

/**
 * Fetch JSON; does not throw on network failure or non-JSON body..
 * Sends cookies (Passport session) on same-site / credentialed CORS requests.
 */
async function safeFetchJson(url, init = {}) {
  try {
    const resp = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init.headers || {}),
      },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (resp.status === 401) {
        notifySessionInvalid();
      }
      const msg = data.error || data.message || `Request failed (${resp.status})`;
      return { ...data, error: msg };
    }
    return data;
  } catch (err) {
    return { error: err?.message || 'Network error' };
  }
}

/** Current user from server session (requires Google OAuth cookie). */
export async function getMe() {
  return safeFetchJson(`${apiBase()}/api/me`);
}

export async function logoutSession() {
  return safeFetchJson(`${apiBase()}/api/logout`, { method: 'POST' });
}

export async function verifyLecturePin(payload) {
  return safeFetchJson(`${apiBase()}/api/verify-lecture-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function verifyLecture(payload) {
  return safeFetchJson(`${apiBase()}/api/verify-lecture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function recordAttendance(payload) {
  return safeFetchJson(`${apiBase()}/api/record-attendance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getAttendanceStatus(courseId) {
  return safeFetchJson(
    `${apiBase()}/api/attendance-status?courseId=${encodeURIComponent(courseId || '')}`,
  );
}

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

/** Staff-only: session cookie must belong to admin or lecturer. */
export async function getAdminCourses() {
  const data = await safeFetchJson(`${apiBase()}/api/admin/courses`);
  if (data.error) return data;
  const raw = data.items ?? data.data;
  return { ...data, items: Array.isArray(raw) ? raw : [] };
}

export async function createAdminCourse(payload) {
  return safeFetchJson(`${apiBase()}/api/admin/courses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function patchCourseAssignLecturer(courseId, lecturerId) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/assign-lecturer`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lecturerId }),
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteAdminLecturer(lecturerId) {
  return safeFetchJson(`${apiBase()}/api/admin/lecturers/${encodeURIComponent(lecturerId)}`, {
    method: 'DELETE',
  });
}

export async function getPolygonPresets() {
  const data = await safeFetchJson(`${apiBase()}/api/admin/polygon-presets`);
  if (data.error) return { error: data.error, items: [] };
  const raw = data.items ?? data.data;
  const items = Array.isArray(raw) ? raw : (Array.isArray(data) ? data : []);
  return { items };
}

export async function createPolygonPreset(payload) {
  return safeFetchJson(`${apiBase()}/api/admin/polygon-presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deletePolygonPreset(presetId) {
  return safeFetchJson(`${apiBase()}/api/admin/polygon-presets/${encodeURIComponent(presetId)}`, {
    method: 'DELETE',
  });
}

export async function deleteAdminCourse(courseId) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}`, {
    method: 'DELETE',
  });
}

export async function disableAdminCourse(courseId) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/disable`, {
    method: 'PATCH',
  });
}

export async function enableAdminCourse(courseId) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/enable`, {
    method: 'PATCH',
  });
}

export async function getAdminSessions(courseId) {
  const data = await safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/sessions`);
  if (data.error) return data;
  const raw = data.items ?? data.data;
  return { ...data, items: Array.isArray(raw) ? raw : [] };
}

export async function createAdminSession(courseId, payload) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteAdminSession(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export async function activateAdminSession(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/activate`, {
    method: 'PATCH',
  });
}

export async function deactivateAdminSession(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/deactivate`, {
    method: 'PATCH',
  });
}

export async function getAdminAllSessions() {
  const data = await safeFetchJson(`${apiBase()}/api/admin/sessions`);
  if (data.error) return data;
  const raw = data.items ?? data.data;
  return { ...data, items: Array.isArray(raw) ? raw : [] };
}

export async function getAdminCurrentSessionCodes() {
  const data = await safeFetchJson(`${apiBase()}/api/admin/sessions/current-codes`);
  if (data.error) return { error: data.error, items: [] };
  const raw = data.items ?? data.data;
  return { items: Array.isArray(raw) ? raw : [] };
}

export async function startAdminSessionRotation(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/rotation/start`, {
    method: 'PATCH',
  });
}

export async function stopAdminSessionRotation(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/rotation/stop`, {
    method: 'PATCH',
  });
}

export async function patchAdminSessionAttendancePaused(sessionId, paused) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/attendance-paused`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused }),
  });
}

export async function getAdminSessionCode(sessionId) {
  return safeFetchJson(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/current-code`);
}

export async function getAdminAttendanceMatrix(courseId) {
  return safeFetchJson(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/attendance-matrix`);
}
