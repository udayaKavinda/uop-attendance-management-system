const LectureSession = require('../models/LectureSession');
const Course = require('../models/Course');
const bluetoothCode = require('./bluetoothCode.service');
const { validateSessionCreateBody, checkSessionOverlap } = require('../validators/session.validator');
const { staffSessionMatch } = require('./auth.service');
const { invalidateActiveSessionCache } = require('./session.service');

async function listForCourse(courseId) {
  return LectureSession.find({ course: courseId, deleted: false }).sort({ lectureDay: 1, startTime: 1 });
}

async function createSession(course, body) {
  const validated = validateSessionCreateBody(body);
  if (!validated.ok) return validated;
  if (!course.active) return { ok: false, status: 409, error: 'Cannot add sessions to a disabled course' };
  const overlap = await checkSessionOverlap(
    LectureSession,
    course._id,
    validated.lectureDay,
    validated.startTime,
    validated.endTime
  );
  if (!overlap.ok) return overlap;
  const created = await LectureSession.create({
    course: course._id,
    lectureDay: validated.lectureDay,
    startTime: validated.startTime,
    endTime: validated.endTime,
    recurring: validated.recurring,
    active: true,
  });
  return { ok: true, session: created };
}

async function findSessionById(sessionId) {
  return LectureSession.findOne({ _id: sessionId, deleted: false });
}

async function softDeleteSession(sessionItem) {
  sessionItem.deleted = true;
  sessionItem.active = false;
  sessionItem.broadcasting = false;
  sessionItem.lastBroadcastSeenAt = null;
  await sessionItem.save();
  await bluetoothCode.removeToken(String(sessionItem._id));
  invalidateActiveSessionCache(sessionItem.course);
  return { ok: true };
}

async function activateSession(sessionItem) {
  // `course` may be a populated doc (activate route) or an ObjectId ref. Resolve
  // it either way so activation never depends on the guard's populate behavior.
  const course = sessionItem.populated && sessionItem.populated('course')
    ? sessionItem.course
    : await Course.findById(sessionItem.course);
  if (!course?.active) return { ok: false, status: 400, error: 'Course is disabled' };
  sessionItem.active = true;
  await sessionItem.save();
  invalidateActiveSessionCache(course._id);
  return { ok: true, session: sessionItem };
}

async function deactivateSession(sessionItem) {
  sessionItem.active = false;
  sessionItem.broadcasting = false;
  sessionItem.lastBroadcastSeenAt = null;
  await sessionItem.save();
  await bluetoothCode.removeToken(String(sessionItem._id));
  invalidateActiveSessionCache(sessionItem.course);
  return { ok: true, session: sessionItem };
}

async function listAllForStaff(auth) {
  const scope = await staffSessionMatch(auth.person, auth.isAdmin);
  return LectureSession.find({ deleted: false, ...scope })
    .populate('course', 'code name active batch lecturers')
    .sort({ updatedAt: -1 });
}

/**
 * Idempotent on/off switch for the session's BLE attendance broadcast.
 * On: seeds the device name (once) + rotating token and stamps the heartbeat.
 * Off: closes the channel and removes the token.
 */
async function setBroadcasting(sessionItem, on) {
  if (on) {
    if (!sessionItem.bluetoothDeviceName) {
      sessionItem.bluetoothDeviceName = bluetoothCode.generateDeviceName();
    }
    sessionItem.broadcasting = true;
    // Stamp immediately so the channel counts as live before the first token poll.
    sessionItem.lastBroadcastSeenAt = new Date();
    await sessionItem.save();
    await bluetoothCode.getToken(String(sessionItem._id));
  } else {
    sessionItem.broadcasting = false;
    sessionItem.lastBroadcastSeenAt = null;
    await sessionItem.save();
    await bluetoothCode.removeToken(String(sessionItem._id));
  }
  invalidateActiveSessionCache(sessionItem.course);
  return { ok: true, session: sessionItem };
}

/** Current token for the broadcasting phone. Each poll doubles as the heartbeat. */
async function getBroadcast(sessionItem) {
  if (!sessionItem.broadcasting) {
    return { ok: false, status: 400, error: 'Broadcast is not on for this session' };
  }
  sessionItem.lastBroadcastSeenAt = new Date();
  await sessionItem.save();
  const { token, rotatesIn } = await bluetoothCode.getToken(String(sessionItem._id));
  return {
    ok: true,
    data: {
      sessionId: sessionItem._id,
      broadcasting: true,
      deviceName: sessionItem.bluetoothDeviceName,
      token,
      rotatesIn,
      rotationMs: bluetoothCode.ROTATION_MS,
    },
  };
}

module.exports = {
  listForCourse,
  createSession,
  findSessionById,
  softDeleteSession,
  activateSession,
  deactivateSession,
  listAllForStaff,
  setBroadcasting,
  getBroadcast,
};
