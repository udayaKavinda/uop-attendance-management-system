const Attendance = require('../models/Attendance');
const LectureSession = require('../models/LectureSession');
const { localYmd } = require('../utils/date');
const { DAY_INDEX, toMinutes } = require('../utils/schedule');
const {
  studentDisplayIdFromEmail,
  formatAttendanceTableColumnLabel,
} = require('../utils/attendanceLabels');
const { resolveActiveSessionForCourse, checkScheduleWindow, isBroadcastLive } = require('./session.service');
const bluetoothCode = require('./bluetoothCode.service');
const manualCode = require('./manualCode.service');
const settingsService = require('./settings.service');
const geofenceService = require('./geofence.service');
const gpsFixService = require('./gpsFix.service');
const peerSeeding = require('./peerSeeding.service');

async function getAttendanceStatus(studentPk, courseId) {
  const attendanceDate = localYmd();
  const resolved = await resolveActiveSessionForCourse(courseId);
  const activeSessionId = resolved.error ? null : resolved.session._id;

  // Prefer the active session when one is running; otherwise fall back to any
  // attendance recorded today for this course so a student can still confirm a
  // record made earlier, after the lecture window has closed.
  const query = { student: studentPk, course: courseId, attendanceDate };
  if (activeSessionId) query.session = activeSessionId;
  const attendance = await Attendance.findOne(query);

  return {
    studentId: studentPk,
    courseId,
    sessionId: activeSessionId || attendance?.session || null,
    attended: Boolean(attendance),
    attendanceId: attendance?._id || null,
    attendedAt: attendance?.timestamp || null,
    method: attendance?.method || null,
  };
}

async function assertAutomaticMethodAllowed(session, method) {
  const verification = session.verification || 'bluetooth';
  const supportsMethod = method === 'bluetooth'
    ? verification === 'bluetooth' || verification === 'both'
    : verification === 'geofence' || verification === 'both';
  if (!supportsMethod) {
    return {
      ok: false,
      status: 400,
      error: method === 'bluetooth'
        ? 'This session does not use Bluetooth verification.'
        : 'This session does not use GPS verification.',
    };
  }
  const settings = await settingsService.getSettings();
  if (!settingsService.isVerificationAllowed(settings, verification)) {
    return { ok: false, status: 403, error: 'This session verification policy is currently disabled.' };
  }
  return { ok: true };
}

async function getBluetoothTarget(courseId) {
  const resolved = await resolveActiveSessionForCourse(courseId);
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };
  const methodGate = await assertAutomaticMethodAllowed(resolved.session, 'bluetooth');
  if (!methodGate.ok) return methodGate;
  if (!isBroadcastLive(resolved.session)) {
    return { ok: false, status: 400, error: 'Attendance is not open for this session right now.' };
  }
  return { ok: true, deviceName: resolved.session.bluetoothDeviceName };
}

/**
 * Shared by every attendance-submission path: idempotent create, resolving a
 * duplicate submission (same student/session/day) to the existing row instead
 * of erroring — including the race where two requests both miss the initial
 * findOne and hit the unique-index conflict on create.
 */
async function createAttendanceRecord({ studentPk, course, session, method }) {
  const attendanceDate = localYmd();
  const existing = await Attendance.findOne({ student: studentPk, session: session._id, attendanceDate });
  if (existing) return { ok: true, attendance: existing, duplicate: true };
  try {
    const attendance = await Attendance.create({
      student: studentPk,
      course: course._id,
      session: session._id,
      courseCode: course.code,
      // Stable, human-readable identifier for the lecture occurrence — not the
      // ephemeral rotating token/code, which carries no meaning once rotated.
      lectureCode: `${session.lectureDay} ${session.startTime}-${session.endTime}`,
      attendanceDate,
      method,
    });
    return { ok: true, attendance, duplicate: false };
  } catch (err) {
    if (err && err.code === 11000) {
      const dup = await Attendance.findOne({ student: studentPk, session: session._id, attendanceDate });
      return { ok: true, attendance: dup, duplicate: true };
    }
    throw err;
  }
}

/**
 * BLE path. `canAdvertise` is optional (defaults to no seeding participation) —
 * the legacy `/api/bluetooth-attendance` alias doesn't send it, only the unified
 * endpoint does.
 */
async function recordBluetoothAttendance(studentPk, courseId, token, canAdvertise = false) {
  const resolved = await resolveActiveSessionForCourse(courseId);
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };
  const methodGate = await assertAutomaticMethodAllowed(resolved.session, 'bluetooth');
  if (!methodGate.ok) return methodGate;
  if (!isBroadcastLive(resolved.session)) {
    return { ok: false, status: 400, error: 'Attendance is not open for this session right now.' };
  }
  const schedule = checkScheduleWindow(resolved.session);
  if (!schedule.ok) return { ok: false, status: 400, error: schedule.reason };
  if (!await bluetoothCode.verifyToken(String(resolved.session._id), token)) {
    return { ok: false, status: 400, error: 'Invalid or expired Bluetooth token. Move closer and try again.' };
  }
  const result = await createAttendanceRecord({
    studentPk, course: resolved.course, session: resolved.session, method: 'bluetooth',
  });
  if (!result.duplicate) {
    result.seeding = await peerSeeding.selectSeedingRole(resolved.session, studentPk, canAdvertise);
  }
  return result;
}

/**
 * GPS path: one fix per call — the client streams fixes as they arrive over its
 * 90s window, and the server re-evaluates the accumulated centroid on each one.
 * `pending` (not an error) means "keep streaming"; the client's own 90s timeout,
 * not the server, is what eventually gives up.
 */
async function recordGpsFixAttendance(studentPk, courseId, fix, canAdvertise = false) {
  const resolved = await resolveActiveSessionForCourse(courseId);
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };
  const { session, course } = resolved;

  const methodGate = await assertAutomaticMethodAllowed(session, 'gps');
  if (!methodGate.ok) return methodGate;
  const schedule = checkScheduleWindow(session);
  if (!schedule.ok) return { ok: false, status: 400, error: schedule.reason };

  if (!Array.isArray(session.buildings) || session.buildings.length === 0) {
    return { ok: false, status: 400, error: 'No building configured for this session.' };
  }
  const geofences = await geofenceService.findByIds(session.buildings);
  if (geofences.length === 0) {
    return { ok: false, status: 400, error: 'No active building configured for this session.' };
  }

  const settings = await settingsService.getSettings();
  const bufferMeters = session.verification === 'geofence' ? settings.bufferGpsOnly : settings.bufferGpsBle;

  const { accepted, centroid } = gpsFixService.evaluateFix(
    String(studentPk), String(session._id), fix, geofences, bufferMeters,
  );
  if (!accepted) {
    return { ok: true, pending: true };
  }
  gpsFixService.clearFixes(String(studentPk), String(session._id));

  const result = await createAttendanceRecord({
    studentPk, course, session, method: 'gps',
  });
  if (result.attendance && !result.duplicate && centroid) {
    // Audit-only — never fail the attendance record over this write.
    await Attendance.updateOne(
      { _id: result.attendance._id },
      { $set: { centroid: { lat: centroid.lat, lng: centroid.lng, fixCount: centroid.fixCount } } },
    ).catch(() => {});
  }
  if (!result.duplicate) {
    result.seeding = await peerSeeding.selectSeedingRole(session, studentPk, canAdvertise);
  }
  return result;
}

/**
 * Fallback path: verify the lecturer-controlled 8-digit code instead of the BLE
 * token. Independent of Bluetooth/broadcast state entirely — deliberately does
 * NOT check isBroadcastLive, since the manual code works whether or not the
 * lecturer's phone is broadcasting.
 */
async function recordManualCodeAttendance(studentPk, courseId, code) {
  const resolved = await resolveActiveSessionForCourse(courseId);
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };

  const allowed = await settingsService.isManualCodeAllowed();
  if (!allowed || !resolved.session.manualCodeEnabled) {
    return { ok: false, status: 400, error: 'Manual attendance code is not enabled for this session.' };
  }
  const schedule = checkScheduleWindow(resolved.session);
  if (!schedule.ok) return { ok: false, status: 400, error: schedule.reason };

  const attempt = await manualCode.verifyAttempt(String(studentPk), resolved.session, code);
  if (attempt.lockedOut) {
    return { ok: false, status: 429, error: 'Too many incorrect attempts. Try again in a couple of minutes.' };
  }
  if (!attempt.ok) {
    return { ok: false, status: 400, error: 'Invalid or expired attendance code.' };
  }
  return createAttendanceRecord({
    studentPk, course: resolved.course, session: resolved.session, method: 'manual_code',
  });
}

/**
 * Single dispatcher behind `POST /api/attendance`, per the design doc's unified
 * endpoint: exactly one of `token` (BLE), `fix` (GPS), or `code` (manual) is
 * expected per call — the validator enforces that. The two legacy endpoints
 * (`/api/bluetooth-attendance`, `/api/manual-attendance`) stay as thin aliases
 * calling straight through to the same underlying functions, so neither the app
 * nor these functions' own behavior needs to change to support both.
 */
async function recordAttendance(studentPk, courseId, {
  token, fix, code, canAdvertise,
}) {
  if (token) return recordBluetoothAttendance(studentPk, courseId, token, canAdvertise);
  if (fix) return recordGpsFixAttendance(studentPk, courseId, fix, canAdvertise);
  return recordManualCodeAttendance(studentPk, courseId, code);
}

async function getSessionAttendance(sessionId) {
  return Attendance.find({ session: sessionId })
    .populate('student', 'studentId email name')
    .sort({ timestamp: -1 });
}

async function getAttendanceMatrix(course) {
  const sessionIds = await Attendance.distinct('session', { course: course._id });
  const attendanceDocs = await Attendance.find({ course: course._id, session: { $in: sessionIds } })
    .populate('student', 'studentId email');
  const sessionMinDate = new Map();
  attendanceDocs.forEach((doc) => {
    const sessKey = String(doc.session);
    const ymd = doc.attendanceDate;
    if (!ymd) return;
    const prev = sessionMinDate.get(sessKey);
    if (!prev || ymd < prev) sessionMinDate.set(sessKey, ymd);
  });
  const sessions = await LectureSession.find({ _id: { $in: sessionIds } });
  sessions.sort((a, b) => {
    const da = sessionMinDate.get(String(a._id));
    const db = sessionMinDate.get(String(b._id));
    if (da && db && da !== db) return da.localeCompare(db);
    if (da && !db) return -1;
    if (!da && db) return 1;
    const dOrder = (day) => DAY_INDEX.indexOf(String(day || '').toUpperCase());
    const diffDay = dOrder(a.lectureDay) - dOrder(b.lectureDay);
    if (diffDay !== 0) return diffDay;
    const taN = toMinutes(a.startTime);
    const tbN = toMinutes(b.startTime);
    if (taN !== tbN) return (taN ?? -1) - (tbN ?? -1);
    return String(a._id).localeCompare(String(b._id));
  });
  const rowsMap = new Map();
  attendanceDocs.forEach((doc) => {
    const sid = String(doc.student?._id || '');
    if (!sid) return;
    if (!rowsMap.has(sid)) {
      rowsMap.set(sid, {
        // Human-readable identifier (email local-part) for the export column.
        // Named `displayId` to avoid colliding with the API's `studentId` (= Person _id).
        displayId: studentDisplayIdFromEmail(doc.student?.email, doc.student?.studentId),
        email: doc.student.email,
        attendance: {},
      });
    }
    rowsMap.get(sid).attendance[String(doc.session)] = true;
  });
  return {
    course: { _id: course._id, code: course.code, batch: course.batch, name: course.name },
    sessions: sessions.map((s) => ({
      _id: s._id,
      label: formatAttendanceTableColumnLabel(s, sessionMinDate.get(String(s._id))),
    })),
    rows: Array.from(rowsMap.values()),
  };
}

/**
 * Seeder re-fetch: current rotating seeder token + `rotatesIn`. Each call is
 * also the seeder's heartbeat, mirroring the lecturer broadcast's poll loop.
 * Returns an error once the lease has ended — the client stops advertising then.
 */
async function getSeedToken(studentPk, sessionId) {
  const sessionItem = await LectureSession.findOne({ _id: sessionId, deleted: false });
  if (!sessionItem) return { ok: false, status: 404, error: 'Session not found' };

  const result = await bluetoothCode.getSeedToken(String(sessionId), String(studentPk));
  if (!result) {
    return { ok: false, status: 400, error: 'Seeding window has ended.' };
  }
  return {
    ok: true,
    data: { sessionId: sessionItem._id, token: result.token, rotatesIn: result.rotatesIn },
  };
}

/** Relinquishes this student's own seeder lease after an on-device advertiser failure. */
async function releaseSeedToken(studentPk, sessionId) {
  await bluetoothCode.removeSeedToken(String(sessionId), String(studentPk));
  return { ok: true };
}

module.exports = {
  getAttendanceStatus,
  getBluetoothTarget,
  recordBluetoothAttendance,
  recordGpsFixAttendance,
  recordManualCodeAttendance,
  recordAttendance,
  getSeedToken,
  releaseSeedToken,
  getSessionAttendance,
  getAttendanceMatrix,
};
