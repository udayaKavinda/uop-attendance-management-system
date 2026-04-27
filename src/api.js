function apiBase() {
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE;
  // Same-origin API by default avoids Safari mixed-content/proxy issues in production.
  if (typeof window !== 'undefined' && window.location.port === '3000') return 'http://localhost:5000';
  return '';
}

export async function login(identifier) {
  const resp = await fetch(`${apiBase()}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
  return resp.json();
}

export async function getMe(studentId) {
  const resp = await fetch(`${apiBase()}/api/me?studentId=${encodeURIComponent(studentId || '')}`);
  return resp.json();
}

export async function verifyLecture(payload) {
  const resp = await fetch(`${apiBase()}/api/verify-lecture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

export async function recordAttendance(payload) {
  const resp = await fetch(`${apiBase()}/api/record-attendance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

export async function getAttendanceStatus(studentId, courseCode) {
  const resp = await fetch(
    `${apiBase()}/api/attendance-status?studentId=${encodeURIComponent(studentId || '')}&courseId=${encodeURIComponent(courseCode || '')}`,
  );
  return resp.json();
}

/** Current rotating code + countdown (same value the server validates). */
export async function getLectureCode(courseCode) {
  const resp = await fetch(
    `${apiBase()}/api/lecture-code?courseId=${encodeURIComponent(courseCode || '')}`,
  );
  return resp.json();
}

export async function getCourses() {
  const resp = await fetch(`${apiBase()}/api/courses`);
  return resp.json();
}

export async function getRunningCourses() {
  const resp = await fetch(`${apiBase()}/api/courses/running`);
  return resp.json();
}

export async function getAdminCourses(studentId) {
  const resp = await fetch(`${apiBase()}/api/admin/courses`, {
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function createAdminCourse(studentId, payload) {
  const resp = await fetch(`${apiBase()}/api/admin/courses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Student-Id': studentId || '',
    },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

export async function patchCourseAssignLecturer(studentId, courseId, lecturerId) {
  const resp = await fetch(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/assign-lecturer`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Student-Id': studentId || '',
    },
    body: JSON.stringify({ lecturerId }),
  });
  return resp.json();
}

export async function getAdminLecturers(studentId, q) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  const url = `${apiBase()}/api/admin/lecturers${qs}`;
  const resp = await fetch(url, {
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function createAdminLecturer(studentId, payload) {
  const resp = await fetch(`${apiBase()}/api/admin/lecturers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Student-Id': studentId || '',
    },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

export async function deleteAdminLecturer(studentId, lecturerId) {
  const resp = await fetch(`${apiBase()}/api/admin/lecturers/${encodeURIComponent(lecturerId)}`, {
    method: 'DELETE',
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function getPolygonPresets(studentId) {
  const resp = await fetch(`${apiBase()}/api/admin/polygon-presets`, {
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function createPolygonPreset(studentId, payload) {
  const resp = await fetch(`${apiBase()}/api/admin/polygon-presets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Student-Id': studentId || '',
    },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

export async function deletePolygonPreset(studentId, presetId) {
  const resp = await fetch(`${apiBase()}/api/admin/polygon-presets/${encodeURIComponent(presetId)}`, {
    method: 'DELETE',
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function deleteAdminCourse(studentId, courseId) {
  const resp = await fetch(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}`, {
    method: 'DELETE',
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function disableAdminCourse(studentId, courseId) {
  const resp = await fetch(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/disable`, {
    method: 'PATCH',
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function enableAdminCourse(studentId, courseId) {
  const resp = await fetch(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/enable`, {
    method: 'PATCH',
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function getAdminSessions(studentId, courseId) {
  const resp = await fetch(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/sessions`, {
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function createAdminSession(studentId, courseId, payload) {
  const resp = await fetch(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Student-Id': studentId || '',
    },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

export async function deleteAdminSession(studentId, sessionId) {
  const resp = await fetch(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function activateAdminSession(studentId, sessionId) {
  const resp = await fetch(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/activate`, {
    method: 'PATCH',
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function deactivateAdminSession(studentId, sessionId) {
  const resp = await fetch(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/deactivate`, {
    method: 'PATCH',
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function getAdminAllSessions(studentId) {
  const resp = await fetch(`${apiBase()}/api/admin/sessions`, {
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function getAdminCurrentSessionCodes(studentId) {
  try {
    const resp = await fetch(`${apiBase()}/api/admin/sessions/current-codes`, {
      headers: { 'X-Student-Id': studentId || '' },
    });
    return await resp.json();
  } catch (err) {
    return { error: err?.message || 'Failed to fetch running session codes' };
  }
}

export async function startAdminSessionRotation(studentId, sessionId) {
  const resp = await fetch(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/rotation/start`, {
    method: 'PATCH',
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function stopAdminSessionRotation(studentId, sessionId) {
  const resp = await fetch(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/rotation/stop`, {
    method: 'PATCH',
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function getAdminSessionCode(studentId, sessionId) {
  const resp = await fetch(`${apiBase()}/api/admin/sessions/${encodeURIComponent(sessionId)}/current-code`, {
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}

export async function getAdminAttendanceMatrix(studentId, courseId) {
  const resp = await fetch(`${apiBase()}/api/admin/courses/${encodeURIComponent(courseId)}/attendance-matrix`, {
    headers: { 'X-Student-Id': studentId || '' },
  });
  return resp.json();
}
