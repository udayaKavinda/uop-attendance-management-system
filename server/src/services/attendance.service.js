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
const attemptVerdict = require('./attemptVerdict.service');
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
  return { status: attendance ? attendance.status : 'none' };
}

/**
 * Whether the student should bother scanning for Bluetooth at all. False when
 * the admin has killed BLE globally or no lecturer is broadcasting — the client
 * then spends its whole 90s window on GPS instead of splitting attention.
 */
async function getBluetoothTarget(courseId) {
  const resolved = await resolveActiveSessionForCourse(courseId);
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };
  if (!await settingsService.isBleEnabled()) {
    return { ok: true, available: false };
  }
  return { ok: true, available: isBroadcastLive(resolved.session) };
}

function centroidDoc(centroid, distanceM) {
  if (!centroid) return undefined;
  return {
    lat: centroid.lat,
    lng: centroid.lng,
    fixCount: centroid.fixCount,
    ...(Number.isFinite(distanceM) ? { distanceM } : {}),
  };
}

/**
 * Idempotent write for every acceptance path.
 *
 * A genuine automatic pass always overwrites a non-present record: a student who
 * was sent to review, or even rejected, and then actually walks into the room
 * must be able to fix it themselves. Nothing else overwrites — resubmitting the
 * code while already under review is a no-op, not a new pending row.
 */
async function upsertAttendance({
  studentPk, course, session, method, status, band, centroid, seedRelayed = false,
}) {
  const attendanceDate = localYmd();
  const doc = {
    student: studentPk,
    course: course._id,
    session: session._id,
    courseCode: course.code,
    // Stable, human-readable identifier for the lecture occurrence — not the
    // ephemeral rotating token/code, which carries no meaning once rotated.
    lectureCode: `${session.lectureDay} ${session.startTime}-${session.endTime}`,
    attendanceDate,
    method,
    status,
    band,
    seedRelayed,
    ...(centroid ? { centroid } : {}),
  };

  const existing = await Attendance.findOne({ student: studentPk, session: session._id, attendanceDate });
  if (existing) {
    if (existing.status !== 'present' && status === 'present') {
      Object.assign(existing, doc, { reviewedAt: null, reviewedBy: null });
      await existing.save();
      return { ok: true, attendance: existing, duplicate: false, upgraded: true };
    }
    return { ok: true, attendance: existing, duplicate: true };
  }

  try {
    const attendance = await Attendance.create(doc);
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
 * BLE path — the strongest evidence there is. Receiving a live token means the
 * student's radio physically heard the room, so it passes outright without
 * consulting GPS at all.
 */
async function recordBluetoothAttendance(studentPk, courseId, token, canAdvertise = false) {
  const resolved = await resolveActiveSessionForCourse(courseId);
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };
  const { session, course } = resolved;

  if (!await settingsService.isBleEnabled()) {
    return { ok: false, status: 403, error: 'Bluetooth verification is currently disabled.' };
  }
  if (!isBroadcastLive(session)) {
    return { ok: false, status: 400, error: 'Attendance is not open for this session right now.' };
  }
  const schedule = checkScheduleWindow(session);
  if (!schedule.ok) return { ok: false, status: 400, error: schedule.reason };

  const verified = await bluetoothCode.verifyToken(String(session._id), token);
  if (!verified.ok) {
    return { ok: false, status: 400, error: 'Invalid or expired Bluetooth token. Move closer and try again.' };
  }

  const result = await upsertAttendance({
    studentPk,
    course,
    session,
    method: 'bluetooth',
    status: 'present',
    band: 'inside',
    seedRelayed: verified.role === 'seed',
  });

  gpsFixService.clearFixes(String(studentPk), String(session._id));
  attemptVerdict.clear(String(studentPk), String(session._id));

  if (!result.duplicate) {
    result.seeding = await peerSeeding.selectSeedingRole(session, studentPk, canAdvertise, verified.role);
  }
  return result;
}

/**
 * GPS path: one fix per call — the client streams fixes across its 90s window and
 * the server re-bands the accumulated centroid on each one.
 *
 * Everything short of a pass returns the same `collecting: true` the client sees
 * while genuinely still gathering fixes. That is deliberate: the client is never
 * told which band it reached, so a modified app cannot learn how far out it is,
 * and the suspicious/far distinction stays server-side until a code is submitted.
 */
async function recordGpsFixAttendance(studentPk, courseId, fix) {
  const resolved = await resolveActiveSessionForCourse(courseId);
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };
  const { session, course } = resolved;

  const schedule = checkScheduleWindow(session);
  if (!schedule.ok) return { ok: false, status: 400, error: schedule.reason };

  const studentKey = String(studentPk);
  const sessionKey = String(session._id);

  const geofences = await geofenceService.findByIds(session.buildings);
  if (geofences.length === 0) {
    // Buildings are mandatory at creation, so this means every one was later
    // deleted or deactivated. Fail closed: record `unknown` so a later code
    // submission routes to review rather than silently passing.
    attemptVerdict.record(studentKey, sessionKey, { band: 'unknown' });
    return { ok: true, collecting: true };
  }

  const settings = await settingsService.getSettings();
  const verdict = gpsFixService.evaluateFix(
    studentKey, sessionKey, fix, geofences, settingsService.buffers(settings),
  );
  if (!verdict.ready) return { ok: true, collecting: true };

  attemptVerdict.record(studentKey, sessionKey, {
    band: verdict.band,
    centroid: verdict.centroid,
    distanceM: verdict.distanceM,
  });

  if (!gpsFixService.isPassBand(verdict.band)) {
    return { ok: true, collecting: true };
  }

  const result = await upsertAttendance({
    studentPk,
    course,
    session,
    method: 'gps',
    status: 'present',
    band: verdict.band,
    centroid: centroidDoc(verdict.centroid, verdict.distanceM),
  });

  gpsFixService.clearFixes(studentKey, sessionKey);
  attemptVerdict.clear(studentKey, sessionKey);
  // No seeding here on purpose: a GPS pass only proves the student is within the
  // near buffer of the building, not inside the room. See peerSeeding.service.
  return result;
}

/**
 * "Get help" path: the lecturer's code, submitted after the automatic attempt
 * failed. What it grants depends on how far out the student's last GPS verdict
 * put them — a correct code is proof the lecturer is nearby and willing to
 * vouch, not proof of location, so it never converts a far/unknown attempt into
 * a silent pass.
 */
async function recordHelpCodeAttendance(studentPk, courseId, code) {
  const resolved = await resolveActiveSessionForCourse(courseId);
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };
  const { session, course } = resolved;

  const schedule = checkScheduleWindow(session);
  if (!schedule.ok) return { ok: false, status: 400, error: schedule.reason };

  const studentKey = String(studentPk);
  const sessionKey = String(session._id);

  const attempt = await manualCode.verifyAttempt(studentKey, session, code);
  if (attempt.lockedOut) {
    return { ok: false, status: 429, error: 'Too many incorrect attempts. Try again in a couple of minutes.' };
  }
  if (!attempt.ok) {
    return { ok: false, status: 400, error: 'Incorrect code. Ask your lecturer to read it out again.' };
  }

  const settings = await settingsService.getSettings();
  const stored = attemptVerdict.get(studentKey, sessionKey);
  // No stored verdict means the attempt never produced a usable fix at all
  // (location denied, no provider, no lock). Treat that as unknown, never a pass.
  const band = stored?.band || 'unknown';

  const passes = gpsFixService.isPassBand(band)
    || (band === 'suspicious' && settings.suspiciousBandAutoPass !== false);

  const result = await upsertAttendance({
    studentPk,
    course,
    session,
    method: 'code_override',
    status: passes ? 'present' : 'under_review',
    band,
    centroid: centroidDoc(stored?.centroid, stored?.distanceM),
  });

  if (passes) {
    gpsFixService.clearFixes(studentKey, sessionKey);
    attemptVerdict.clear(studentKey, sessionKey);
  }
  return result;
}

/** Single dispatcher behind `POST /api/attendance`; the validator requires one method. */
async function recordAttendance(studentPk, courseId, {
  token, fix, code, canAdvertise,
}) {
  // Deliberately campus-wide: authentication proves the caller is a student,
  // while the live session and its BLE/GPS/code evidence authorize attendance.
  // This project has no course-enrolment source, so do not add a membership gate
  // here or in the method-specific paths.
  if (token) return recordBluetoothAttendance(studentPk, courseId, token, canAdvertise);
  if (fix) return recordGpsFixAttendance(studentPk, courseId, fix);
  return recordHelpCodeAttendance(studentPk, courseId, code);
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
    // Status only — `method`, `band`, and `centroid` stay server-internal.
    rowsMap.get(sid).attendance[String(doc.session)] = doc.status;
  });
  return {
    course: {
      _id: course._id, code: course.code, batch: course.batch, name: course.name,
    },
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
  if (!await settingsService.isBleEnabled()) {
    return { ok: false, status: 403, error: 'Bluetooth is currently disabled.' };
  }

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
  recordAttendance,
  getSeedToken,
  releaseSeedToken,
  getAttendanceMatrix,
};
