const Attendance = require('../models/Attendance');
const LectureSession = require('../models/LectureSession');
const { localYmd } = require('../utils/date');
const { DAY_INDEX, toMinutes } = require('../utils/schedule');
const {
  studentDisplayIdFromEmail,
  formatAttendanceTableColumnLabel,
} = require('../utils/attendanceLabels');
const { resolveActiveSessionForCourse, checkScheduleWindow } = require('./session.service');
const bluetoothCode = require('./bluetoothCode.service');

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
  };
}

async function getBluetoothTarget(courseId) {
  const resolved = await resolveActiveSessionForCourse(courseId);
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };
  if (!resolved.session.bluetoothEnabled) {
    return { ok: false, status: 400, error: 'Bluetooth attendance is not enabled for this session' };
  }
  // Mirror the record path: don't advertise a target while attendance is paused.
  if (resolved.session.attendancePaused) {
    return { ok: false, status: 400, error: 'Attendance is paused. Please wait until your lecturer resumes.' };
  }
  return { ok: true, deviceName: resolved.session.bluetoothDeviceName };
}

async function recordBluetoothAttendance(studentPk, courseId, token) {
  const resolved = await resolveActiveSessionForCourse(courseId);
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };
  if (!resolved.session.bluetoothEnabled) {
    return { ok: false, status: 400, error: 'Bluetooth attendance is not enabled for this session' };
  }
  if (resolved.session.attendancePaused) {
    return { ok: false, status: 400, error: 'Attendance is paused. Please wait until your lecturer resumes.' };
  }
  const schedule = checkScheduleWindow(resolved.session);
  if (!schedule.ok) return { ok: false, status: 400, error: schedule.reason };
  if (!await bluetoothCode.verifyToken(String(resolved.session._id), token)) {
    return { ok: false, status: 400, error: 'Invalid or expired Bluetooth token. Move closer and try again.' };
  }
  const attendanceDate = localYmd();
  const existing = await Attendance.findOne({
    student: studentPk,
    session: resolved.session._id,
    attendanceDate,
  });
  if (existing) return { ok: true, attendance: existing, duplicate: true };
  try {
    const attendance = await Attendance.create({
      student: studentPk,
      course: resolved.course._id,
      session: resolved.session._id,
      courseCode: resolved.course.code,
      // Stable, human-readable identifier for the lecture occurrence — not the
      // ephemeral 15s BLE token, which carries no meaning once rotated.
      lectureCode: `${resolved.session.lectureDay} ${resolved.session.startTime}-${resolved.session.endTime}`,
      attendanceDate,
      method: 'bluetooth',
    });
    return { ok: true, attendance, duplicate: false };
  } catch (err) {
    if (err && err.code === 11000) {
      const dup = await Attendance.findOne({
        student: studentPk,
        session: resolved.session._id,
        attendanceDate,
      });
      return { ok: true, attendance: dup, duplicate: true };
    }
    throw err;
  }
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

module.exports = {
  getAttendanceStatus,
  getBluetoothTarget,
  recordBluetoothAttendance,
  getSessionAttendance,
  getAttendanceMatrix,
};
