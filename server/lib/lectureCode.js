const crypto = require('crypto');

const ROTATION_MS = 30000;

const codeState = new Map();

function generateCode() {
  return String(crypto.randomInt(10000000, 100000000));
}

function normalizeCourseCode(courseCode) {
  return String(courseCode || '').trim().toUpperCase();
}

function getOrCreateState(key) {
  const normalized = String(key || '').trim();
  if (!normalized) {
    throw new Error('Code key is required');
  }
  if (!codeState.has(normalized)) {
    codeState.set(normalized, {
      code: generateCode(),
      expiresAt: Date.now() + ROTATION_MS,
      paused: false,
    });
  }
  return { normalized, state: codeState.get(normalized) };
}

function rotateCode(key) {
  const { normalized } = getOrCreateState(key);
  codeState.set(normalized, {
    code: generateCode(),
    expiresAt: Date.now() + ROTATION_MS,
    paused: false,
  });
}

function ensureFreshCodeForDisplay(key) {
  const { normalized, state } = getOrCreateState(key);
  if (state.paused) return;
  if (Date.now() >= state.expiresAt) {
    rotateCode(normalized);
  }
}

function getCurrent(key) {
  const normalized = String(key || '').trim();
  ensureFreshCodeForDisplay(normalized);
  const state = codeState.get(normalized);
  const secondsRemaining = Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000));
  return {
    key: normalized,
    code: state.code,
    expiresAt: state.paused ? null : new Date(state.expiresAt).toISOString(),
    secondsRemaining: state.paused ? null : secondsRemaining,
    rotationSeconds: ROTATION_MS / 1000,
    paused: Boolean(state.paused),
  };
}

/**
 * Validates submitted code against key-specific active window.
 */
function isValidCode(key, lectureCode) {
  const normalized = String(key || '').trim();
  const { state } = getOrCreateState(normalized);
  const submitted = String(lectureCode ?? '').replace(/\s/g, '');
  if (!state.paused && Date.now() >= state.expiresAt) return false;
  return submitted === state.code;
}

function resetCode(key) {
  rotateCode(key);
}

function pauseCode(key) {
  const normalized = String(key || '').trim();
  const { state } = getOrCreateState(normalized);
  if (state.paused) return;
  codeState.set(normalized, {
    code: state.code,
    expiresAt: state.expiresAt,
    paused: true,
  });
}

function resumeCode(key) {
  const normalized = String(key || '').trim();
  const { state } = getOrCreateState(normalized);
  if (!state.paused) return;
  codeState.set(normalized, {
    code: state.code,
    expiresAt: Date.now() + ROTATION_MS,
    paused: false,
  });
}

function removeKey(key) {
  const normalized = String(key || '').trim();
  if (!normalized) return;
  codeState.delete(normalized);
}

function hasValidLocation(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln);
}

module.exports = {
  ROTATION_MS,
  normalizeCourseCode,
  getCurrent,
  isValidCode,
  resetCode,
  pauseCode,
  resumeCode,
  removeKey,
  hasValidLocation,
};
