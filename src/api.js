// simple wrapper for backend API calls
const BASE = process.env.REACT_APP_API_BASE || '';

export async function login(identifier) {
  const resp = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
  return resp.json();
}

export async function verifyDevice(payload) {
  const resp = await fetch(`${BASE}/api/verify-device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

const apiBase = () => process.env.REACT_APP_API_BASE || (typeof window !== 'undefined' && window.location.port === '3000' ? 'http://localhost:5000' : '');

export async function getWebAuthnOptions(studentId) {
  const resp = await fetch(`${apiBase()}/api/webauthn/options?studentId=${encodeURIComponent(studentId)}`);
  return resp.json();
}

export async function verifyWebAuthnRegistration(studentId, credential) {
  const resp = await fetch(`${apiBase()}/api/webauthn/register-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, credential }),
  });
  return resp.json();
}

export async function verifyWebAuthnAssertion(studentId, assertion) {
  const resp = await fetch(`${apiBase()}/api/webauthn/auth-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, assertion }),
  });
  return resp.json();
}

export async function verifyLecture(payload) {
  const resp = await fetch(`${BASE}/api/verify-lecture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

export async function recordAttendance(payload) {
  const resp = await fetch(`${BASE}/api/record-attendance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return resp.json();
}
