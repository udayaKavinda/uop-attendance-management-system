const authService = require('../../services/auth.service');
const lectureSessionService = require('../../services/lectureSession.service');
const sessionService = require('../../services/session.service');
const manualCodeService = require('../../services/manualCode.service');
const attendanceReviewService = require('../../services/attendanceReview.service');
const { validateBroadcastBody, validateReviewBody } = require('../../validators/session.validator');
const { validateManualCodeConfigBody } = require('../../validators/manualCode.validator');
const { parsePagination } = require('../../utils/pagination');

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
  const pagination = parsePagination(req.query);
  const result = await lectureSessionService.listAllForStaff(req.auth, pagination);
  if (Array.isArray(result)) return res.json({ items: result });
  return res.json(result);
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

/** Staff-facing code status. Every session has one; only the schedule window gates it. */
async function getManualCode(req, res) {
  const status = await manualCodeService.getStatus(req.sessionItem);
  return res.json(status);
}

async function patchManualCode(req, res) {
  const validated = validateManualCodeConfigBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });

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

  const status = await manualCodeService.getStatus(req.sessionItem);
  return res.json({ success: true, ...status });
}

/** Pending code-override submissions awaiting this lecturer's decision. */
async function listPendingReviews(req, res) {
  const items = await attendanceReviewService.listPending(req.sessionItem);
  return res.json({ items });
}

async function reviewSubmission(req, res) {
  const validated = validateReviewBody(req.body);
  if (!validated.ok) return res.status(validated.status).json({ error: validated.error });
  const result = await attendanceReviewService.review(
    req.sessionItem,
    req.params.attendanceId,
    validated.decision,
    req.auth.person._id,
  );
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ success: true, status: result.attendance.status });
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
  listPendingReviews,
  reviewSubmission,
};
