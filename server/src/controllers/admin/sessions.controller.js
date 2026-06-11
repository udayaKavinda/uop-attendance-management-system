const authService = require('../../services/auth.service');
const lectureSessionService = require('../../services/lectureSession.service');
const attendanceService = require('../../services/attendance.service');
const sessionService = require('../../services/session.service');
const { validateBroadcastBody } = require('../../validators/session.validator');

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

async function sessionAttendance(req, res) {
  const records = await attendanceService.getSessionAttendance(req.sessionItem._id);
  return res.json({ records });
}

module.exports = {
  remove,
  activate,
  deactivate,
  list,
  listRunning,
  setBroadcast,
  getBroadcast,
  sessionAttendance,
};
