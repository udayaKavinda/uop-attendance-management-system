const authService = require('../../services/auth.service');
const lectureSessionService = require('../../services/lectureSession.service');
const sessionService = require('../../services/session.service');
const manualCodeService = require('../../services/manualCode.service');
const settingsService = require('../../services/settings.service');
const { validateBroadcastBody } = require('../../validators/session.validator');
const { validateManualCodeConfigBody } = require('../../validators/manualCode.validator');

async function remove(req, res) {
  await lectureSessionService.softDeleteSession(req.sessionItem);
  return res.json({ success: true });
}

async function activate(req, res) {
  const result = await lectureSessionService.activateSession(req.sessionItem);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ success: true, session: result.session });
}

async function deactivate(req, res) {
  const result = await lectureSessionService.deactivateSession(req.sessionItem);
  return res.json({ success: true, session: result.session });
}

async function list(req, res) {
  const items = await lectureSessionService.listAllForStaff(req.auth);
  return res.json({ items });
}

async function listRunning(req, res) {
  const scope = await authService.staffSessionMatch(req.auth.person, req.auth.isAdmin);
  const items = await sessionService.getRunningSessionsForStaff(scope);
  return res.json({ items });
}

async function setBroadcast(req, res) {
  const validated = validateBroadcastBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const result = await lectureSessionService.setBroadcasting(req.sessionItem, validated.on);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ success: true, session: result.session });
}

async function getBroadcast(req, res) {
  const result = await lectureSessionService.getBroadcast(req.sessionItem);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result.data);
}

/**
 * Staff-facing manual-code status. Overrides `enabled: false` in the response
 * (without touching the session's own stored setting) when the global
 * `manualCodeAllowed` switch is off, so the dashboard reflects reality without
 * losing the lecturer's per-session preference for when the switch flips back on.
 */
async function getManualCode(req, res) {
  const allowed = await settingsService.isManualCodeAllowed();
  const status = await manualCodeService.getStatus(req.sessionItem);
  if (!allowed) {
    return res.json({ ...status, enabled: false, code: null, allowed });
  }
  return res.json({ ...status, allowed });
}

async function patchManualCode(req, res) {
  const validated = validateManualCodeConfigBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });

  const allowed = await settingsService.isManualCodeAllowed();
  if (!allowed && validated.enabled) {
    return res.status(403).json({ error: 'Manual attendance codes are disabled by the administrator' });
  }

  if ('enabled' in validated) {
    await manualCodeService.setEnabled(req.sessionItem, validated.enabled);
  }
  if (req.sessionItem.manualCodeEnabled) {
    if ('rotationMode' in validated) {
      await manualCodeService.setRotation(req.sessionItem, {
        rotationMode: validated.rotationMode,
        rotationSeconds: validated.rotationSeconds,
      });
    }
    if ('paused' in validated) {
      if (validated.paused) await manualCodeService.pause(req.sessionItem);
      else await manualCodeService.resume(req.sessionItem);
    }
    if (validated.regenerate) {
      await manualCodeService.regenerate(req.sessionItem);
    }
  }

  const status = await manualCodeService.getStatus(req.sessionItem);
  return res.json({ success: true, ...status, allowed });
}

module.exports = {
  remove,
  activate,
  deactivate,
  list,
  listRunning,
  setBroadcast,
  getBroadcast,
  getManualCode,
  patchManualCode,
};
