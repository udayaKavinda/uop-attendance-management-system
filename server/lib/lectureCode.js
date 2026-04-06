const crypto = require('crypto');

const ROTATION_MS = 30000;

let currentCode = null;
let expiresAt = 0;

function generateCode() {
  return String(crypto.randomInt(10000000, 100000000));
}

function rotate() {
  currentCode = generateCode();
  expiresAt = Date.now() + ROTATION_MS;
}

/**
 * Ensures the projector always sees a non-expired code when polling.
 */
function ensureFreshCodeForDisplay() {
  if (!currentCode || Date.now() >= expiresAt) {
    rotate();
  }
}

function getCurrent() {
  ensureFreshCodeForDisplay();
  const secondsRemaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  return {
    code: currentCode,
    expiresAt: new Date(expiresAt).toISOString(),
    secondsRemaining,
    rotationSeconds: ROTATION_MS / 1000,
  };
}

/**
 * Validates submitted code against the active window (no rotation here — expired codes fail).
 */
function isValidCode(lectureCode) {
  if (!currentCode) rotate();
  const submitted = String(lectureCode ?? '').replace(/\s/g, '');
  if (Date.now() >= expiresAt) return false;
  return submitted === currentCode;
}

function startRotationTimer() {
  rotate();
  setInterval(() => {
    rotate();
  }, ROTATION_MS);
}

function hasValidLocation(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln);
}

module.exports = {
  ROTATION_MS,
  getCurrent,
  isValidCode,
  startRotationTimer,
  hasValidLocation,
};
