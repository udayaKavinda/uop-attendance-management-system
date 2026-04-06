function apiBase() {
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE;
  if (typeof window !== 'undefined' && window.location.port === '3000') {
    return 'http://localhost:5000';
  }
  return process.env.REACT_APP_API_BASE || '';
}

export async function login(identifier) {
  const resp = await fetch(`${apiBase()}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
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

/** Current rotating code + countdown (same value the server validates). */
export async function getLectureCode() {
  const resp = await fetch(`${apiBase()}/api/lecture-code`);
  return resp.json();
}
