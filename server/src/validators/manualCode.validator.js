const mongoose = require('mongoose');
const { MIN_ROTATION_SECONDS, MAX_ROTATION_SECONDS } = require('../services/manualCode.service');

const ROTATION_MODES = ['none', 'interval'];

/**
 * Body for PATCH /api/admin/sessions/:sessionId/manual-code. Every field is
 * optional and independently applied — `{ paused: true }` alone just pauses,
 * `{ enabled: true, rotationMode: 'interval', rotationSeconds: 60 }` sets up and
 * turns it on in one call. At least one recognized field is required.
 */
function validateManualCodeConfigBody(body) {
  const b = body || {};
  const result = {};

  if ('enabled' in b) {
    if (typeof b.enabled !== 'boolean') {
      return { ok: false, status: 400, error: 'enabled must be a boolean' };
    }
    result.enabled = b.enabled;
  }

  if ('rotationMode' in b || 'rotationSeconds' in b) {
    const rotationMode = String(b.rotationMode || 'none');
    if (!ROTATION_MODES.includes(rotationMode)) {
      return { ok: false, status: 400, error: 'rotationMode must be "none" or "interval"' };
    }
    let rotationSeconds = MIN_ROTATION_SECONDS;
    if (rotationMode === 'interval') {
      rotationSeconds = Number(b.rotationSeconds);
      if (!Number.isFinite(rotationSeconds)
        || rotationSeconds < MIN_ROTATION_SECONDS
        || rotationSeconds > MAX_ROTATION_SECONDS) {
        return {
          ok: false,
          status: 400,
          error: `rotationSeconds must be between ${MIN_ROTATION_SECONDS} and ${MAX_ROTATION_SECONDS}`,
        };
      }
    }
    result.rotationMode = rotationMode;
    result.rotationSeconds = Math.round(rotationSeconds);
  }

  if ('paused' in b) {
    if (typeof b.paused !== 'boolean') {
      return { ok: false, status: 400, error: 'paused must be a boolean' };
    }
    result.paused = b.paused;
  }

  if ('regenerate' in b) {
    if (b.regenerate !== true) {
      return { ok: false, status: 400, error: 'regenerate must be true if present' };
    }
    result.regenerate = true;
  }

  if (Object.keys(result).length === 0) {
    return { ok: false, status: 400, error: 'No recognized manual-code fields in body' };
  }
  return { ok: true, ...result };
}

/** Body for POST /api/manual-attendance — { courseId, code }. */
function validateManualCodeAttendanceBody(body) {
  const { courseId, code } = body || {};
  const id = String(courseId || '').trim();
  if (!mongoose.isValidObjectId(id)) {
    return { ok: false, status: 400, error: 'Invalid courseId' };
  }
  const normalized = String(code || '').trim();
  if (!/^[0-9]{8}$/.test(normalized)) {
    return { ok: false, status: 400, error: 'Invalid attendance code' };
  }
  return { ok: true, courseId: id, code: normalized };
}

module.exports = { validateManualCodeConfigBody, validateManualCodeAttendanceBody };
