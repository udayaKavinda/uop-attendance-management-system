/**
 * Express authorization middleware.
 * Attaches req.auth ({ person, isAdmin? }) after role checks using Passport session user.
 * Composite guards attach req.course or req.sessionItem for downstream controllers.
 */
const asyncHandler = require('./asyncHandler');
const authService = require('../services/auth.service');
const lectureSessionService = require('../services/lectureSession.service');
const LectureSession = require('../models/LectureSession');

function sendAuthError(res, result) {
  return res.status(result.status || 403).json({ error: result.message });
}

function requireStaff(req, res, next) {
  const base = authService.getPersonFromRequest(req);
  if (!base.ok) return sendAuthError(res, base);
  const auth = authService.authorizeStaff(base.person);
  if (!auth.ok) return sendAuthError(res, auth);
  req.auth = { person: auth.person, isAdmin: auth.isAdmin };
  next();
}

function requireAdmin(req, res, next) {
  const base = authService.getPersonFromRequest(req);
  if (!base.ok) return sendAuthError(res, base);
  const auth = authService.authorizeAdmin(base.person);
  if (!auth.ok) return sendAuthError(res, auth);
  req.auth = { person: auth.person, isAdmin: true };
  next();
}

function requireStudent(req, res, next) {
  const base = authService.getPersonFromRequest(req);
  if (!base.ok) return sendAuthError(res, base);
  const auth = authService.authorizeStudent(base.person);
  if (!auth.ok) return sendAuthError(res, auth);
  req.auth = { person: auth.person };
  next();
}

function requireAnyAuth(req, res, next) {
  const base = authService.getPersonFromRequest(req);
  if (!base.ok) return sendAuthError(res, base);
  req.auth = { person: base.person };
  next();
}

/** Loads course and verifies staff lecturer assignment (or admin). Sets req.course. */
function requireCourseAccess(paramKey = 'courseId') {
  return asyncHandler(async (req, res, next) => {
    const courseId = req.params[paramKey];
    const access = await authService.assertCourseAccess(req.auth.person, req.auth.isAdmin, courseId);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    req.course = access.course;
    next();
  });
}

/**
 * Loads lecture session and verifies course access. Sets req.sessionItem.
 * @param {{ paramKey?: string, populateCourse?: boolean }} [options]
 */
function requireSessionAccess(options = {}) {
  const { paramKey = 'sessionId', populateCourse = false } = options;
  return asyncHandler(async (req, res, next) => {
    const sessionId = req.params[paramKey];
    let sessionItem;
    if (populateCourse) {
      sessionItem = await LectureSession.findOne({ _id: sessionId, deleted: false }).populate('course');
    } else {
      sessionItem = await lectureSessionService.findSessionById(sessionId);
    }
    if (!sessionItem) return res.status(404).json({ error: 'Session not found' });
    const courseRef = sessionItem.course;
    const courseId = courseRef?._id || courseRef;
    const access = await authService.assertCourseAccess(req.auth.person, req.auth.isAdmin, courseId);
    if (!access.ok) return res.status(access.status || 403).json({ error: access.message });
    req.sessionItem = sessionItem;
    if (!populateCourse) req.course = access.course;
    next();
  });
}

module.exports = {
  requireStaff,
  requireAdmin,
  requireStudent,
  requireAnyAuth,
  requireCourseAccess,
  requireSessionAccess,
};
