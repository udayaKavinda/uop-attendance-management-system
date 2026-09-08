'use strict';

/**
 * Edge case: a recurring (weekly) LectureSession is one document reused every
 * week — deactivateRecurringSessionsPastWindow resets `active` after each
 * window closes, and the lecturer taps Collect again next week on the SAME
 * session _id (see session.service.js / sessionExpiry.service.js). Attendance
 * itself is correctly keyed by {student, session, attendanceDate} (unique
 * index in models/Attendance.js), so a student who attends the same recurring
 * session in two different weeks gets two separate Attendance documents.
 *
 * The matrix and Excel export used to key their columns purely by `session`
 * _id, with no attendanceDate in the key — a second week's document silently
 * overwrote the first week's in the row map. Both now key by occurrence
 * (session + attendanceDate) instead; these tests prove that fix.
 */

jest.mock('../models/Attendance', () => ({
  distinct: jest.fn(),
  find: jest.fn(),
}));
jest.mock('../models/LectureSession', () => ({
  find: jest.fn(),
}));

const Attendance = require('../models/Attendance');
const LectureSession = require('../models/LectureSession');
const { getAttendanceMatrix, getAttendanceMatrixRaw } = require('../services/attendance.service');
const { buildAttendanceWorkbook } = require('../services/attendanceExport.service');

function chainableFind(docs) {
  return { select: jest.fn().mockReturnThis(), populate: jest.fn().mockResolvedValue(docs) };
}

describe('attendance matrix / export — recurring session run across multiple weeks', () => {
  const course = {
    _id: 'course-1', code: 'CS101', batch: 'E23', name: 'Intro to CS', active: true,
  };
  const sessionId = 'sess-recurring-1';
  const session = {
    _id: sessionId, lectureDay: 'MON', startTime: '09:00', endTime: '10:00', recurring: true,
  };
  const student = { _id: 'stu-1', email: 'a@eng.pdn.ac.lk', studentId: 'E20/1' };

  beforeEach(() => {
    jest.clearAllMocks();
    Attendance.distinct.mockResolvedValue([sessionId]);
    LectureSession.find.mockResolvedValue([session]);
  });

  test(
    'a student present in week 1 and flagged in week 2 (same recurring session) gets '
    + 'two distinct occurrence columns, not one overwriting the other',
    async () => {
      const week1 = {
        session: sessionId, status: 'present', attendanceDate: '2026-09-01', student,
      };
      const week2 = {
        session: sessionId,
        status: 'flagged',
        attendanceDate: '2026-09-08',
        reason: 'GPS location is 2.1km from the nearest session building.',
        student,
      };
      Attendance.find.mockReturnValue(chainableFind([week1, week2]));

      const matrix = await getAttendanceMatrix(course);

      // One occurrence column per week the session actually ran, both labeled
      // by their own date (see formatAttendanceTableColumnLabel).
      expect(matrix.sessions).toHaveLength(2);
      expect(matrix.sessions.map((s) => s.label)).toEqual(['Sep 1 9-10', 'Sep 8 9-10']);

      const row = matrix.rows.find((r) => r.email === student.email);
      const statuses = Object.values(row.attendance);
      expect(statuses.sort()).toEqual(['flagged', 'present']);
    },
  );

  test('Excel export gives the recurring session one column per week, not one overall', async () => {
    const week1 = {
      session: sessionId, status: 'present', attendanceDate: '2026-09-01', student,
    };
    const week2 = {
      session: sessionId,
      status: 'flagged',
      attendanceDate: '2026-09-08',
      reason: 'GPS location is 2.1km from the nearest session building.',
      student,
    };
    Attendance.find.mockReturnValue(chainableFind([week1, week2]));

    const workbook = await buildAttendanceWorkbook(course);
    const sheet = workbook.worksheets[0];
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (r) => rows.push(r));

    expect(sheet.columns).toHaveLength(3); // Student ID + one column per week
    expect(rows).toHaveLength(2); // header + one student row
    const dataRow = rows[1];
    expect(dataRow.getCell(`${sessionId}|2026-09-01`).value).toBe('P');
    expect(dataRow.getCell(`${sessionId}|2026-09-08`).value).toBe('P');
    expect(dataRow.getCell(`${sessionId}|2026-09-08`).fill).toMatchObject({ type: 'pattern' });
  });

  test('a student who attends only week 1 shows "-" for week 2, not a missing column', async () => {
    const otherStudent = { _id: 'stu-2', email: 'b@eng.pdn.ac.lk', studentId: 'E20/2' };
    const week1Student1 = {
      session: sessionId, status: 'present', attendanceDate: '2026-09-01', student,
    };
    const week2Student2 = {
      session: sessionId, status: 'present', attendanceDate: '2026-09-08', student: otherStudent,
    };
    Attendance.find.mockReturnValue(chainableFind([week1Student1, week2Student2]));

    const matrix = await getAttendanceMatrix(course);
    expect(matrix.sessions).toHaveLength(2);
    const row = matrix.rows.find((r) => r.email === student.email);
    expect(row.attendance[`${sessionId}|2026-09-01`]).toBe('present');
    expect(row.attendance[`${sessionId}|2026-09-08`]).toBeUndefined();
  });

  test('sanity check: getAttendanceMatrixRaw returns both weeks of documents at the query layer', async () => {
    const week1 = {
      session: sessionId, status: 'present', attendanceDate: '2026-09-01', student,
    };
    const week2 = {
      session: sessionId, status: 'flagged', attendanceDate: '2026-09-08', student,
    };
    Attendance.find.mockReturnValue(chainableFind([week1, week2]));

    const { attendanceDocs, occurrences } = await getAttendanceMatrixRaw(course);
    expect(attendanceDocs).toHaveLength(2);
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map((o) => o.attendanceDate)).toEqual(['2026-09-01', '2026-09-08']);
  });
});
