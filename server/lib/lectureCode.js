const crypto = require('crypto');

const ROTATION_MS = 30000;

const courseState = new Map();

function generateCode() {
  return String(crypto.randomInt(10000000, 100000000));
}

function normalizeCourseCode(courseCode) {
  return String(courseCode || '').trim().toUpperCase();
}

function getOrCreateState(courseCode) {
  const normalized = normalizeCourseCode(courseCode);
  if (!courseState.has(normalized)) {
    courseState.set(normalized, {
      code: generateCode(),
      expiresAt: Date.now() + ROTATION_MS,
    });
  }
  return { normalized, state: courseState.get(normalized) };
}

function rotateCourseCode(courseCode) {
  const { normalized } = getOrCreateState(courseCode);
  courseState.set(normalized, {
    code: generateCode(),
    expiresAt: Date.now() + ROTATION_MS,
  });
}

function ensureFreshCodeForDisplay(courseCode) {
  const { normalized, state } = getOrCreateState(courseCode);
  if (Date.now() >= state.expiresAt) {
    rotateCourseCode(normalized);
  }
}

function getCurrent(courseCode) {
  const normalizedCourseCode = normalizeCourseCode(courseCode);
  ensureFreshCodeForDisplay(normalizedCourseCode);
  const state = courseState.get(normalizedCourseCode);
  const secondsRemaining = Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000));
  return {
    courseCode: normalizedCourseCode,
    code: state.code,
    expiresAt: new Date(state.expiresAt).toISOString(),
    secondsRemaining,
    rotationSeconds: ROTATION_MS / 1000,
  };
}

/**
 * Validates submitted code against course-specific active window.
 */
function isValidCode(courseCode, lectureCode) {
  const normalizedCourseCode = normalizeCourseCode(courseCode);
  const { state } = getOrCreateState(normalizedCourseCode);
  const submitted = String(lectureCode ?? '').replace(/\s/g, '');
  if (Date.now() >= state.expiresAt) return false;
  return submitted === state.code;
}

function startRotationTimer(allowedCourseCodes = []) {
  allowedCourseCodes.forEach((courseCode) => rotateCourseCode(courseCode));
  setInterval(() => {
    allowedCourseCodes.forEach((courseCode) => rotateCourseCode(courseCode));
  }, ROTATION_MS);
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
  startRotationTimer,
  hasValidLocation,
};
