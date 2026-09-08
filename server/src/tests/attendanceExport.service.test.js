'use strict';

jest.mock('../services/attendance.service', () => ({
  getAttendanceMatrixRaw: jest.fn(),
}));

const attendanceService = require('../services/attendance.service');
const { buildAttendanceWorkbook } = require('../services/attendanceExport.service');

function session(id, overrides = {}) {
  return {
    _id: id, lectureDay: 'MON', startTime: '09:00', endTime: '10:00', recurring: true, ...overrides,
  };
}

function occurrence(sessionId, attendanceDate, overrides = {}) {
  return {
    key: `${sessionId}|${attendanceDate}`,
    sessionId,
    attendanceDate,
    session: session(sessionId, overrides),
  };
}

describe('buildAttendanceWorkbook', () => {
  test('present and flagged cells both show P; flagged additionally gets a red fill and the reason as a note', async () => {
    const course = {
      _id: 'course-1', code: 'CS101', batch: 'E23', name: 'Intro to CS',
    };
    const sessionId = 'sess-1';
    const occKey = `${sessionId}|2026-01-05`;
    attendanceService.getAttendanceMatrixRaw.mockResolvedValue({
      occurrences: [occurrence(sessionId, '2026-01-05')],
      attendanceDocs: [
        {
          session: sessionId,
          status: 'present',
          attendanceDate: '2026-01-05',
          student: { _id: 'stu-present', email: 'present@eng.pdn.ac.lk', studentId: 'E20/123' },
        },
        {
          session: sessionId,
          status: 'flagged',
          attendanceDate: '2026-01-05',
          reason: 'GPS location is 2.1km from the nearest session building.',
          student: { _id: 'stu-flagged', email: 'flagged@eng.pdn.ac.lk', studentId: 'E20/456' },
        },
      ],
    });

    const workbook = await buildAttendanceWorkbook(course);
    const sheet = workbook.worksheets[0];

    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => rows.push(row));
    // Row 1 is the header; data rows are sorted by displayId.
    const [, flaggedRow, presentRow] = rows;

    const flaggedCell = flaggedRow.getCell(occKey);
    expect(flaggedCell.value).toBe('P');
    expect(flaggedCell.fill).toMatchObject({ type: 'pattern', pattern: 'solid' });
    expect(flaggedCell.note).toMatch(/2\.1km/);

    const presentCell = presentRow.getCell(occKey);
    expect(presentCell.value).toBe('P');
    expect(presentCell.fill).toBeUndefined();
    expect(presentCell.note).toBeUndefined();
  });

  test('a student with no record for an occurrence gets "-", not "P"', async () => {
    const course = { _id: 'course-1', code: 'CS101', batch: null };
    const sessionId = 'sess-1';
    const occKey = `${sessionId}|2026-01-05`;
    attendanceService.getAttendanceMatrixRaw.mockResolvedValue({
      occurrences: [occurrence(sessionId, '2026-01-05')],
      attendanceDocs: [
        {
          session: 'other-session',
          status: 'present',
          attendanceDate: '2026-01-05',
          student: { _id: 'stu-1', email: 'a@eng.pdn.ac.lk', studentId: 'E20/1' },
        },
      ],
    });

    const workbook = await buildAttendanceWorkbook(course);
    const sheet = workbook.worksheets[0];
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => rows.push(row));
    const dataRow = rows[1];
    expect(dataRow.getCell(occKey).value).toBe('-');
  });

  test(
    'a recurring session run in two different weeks gets two columns, one per week — '
    + 'neither week overwrites the other',
    async () => {
      const course = { _id: 'course-1', code: 'CS101', batch: 'E23' };
      const sessionId = 'sess-recurring';
      const student = { _id: 'stu-1', email: 'a@eng.pdn.ac.lk', studentId: 'E20/1' };
      attendanceService.getAttendanceMatrixRaw.mockResolvedValue({
        occurrences: [
          occurrence(sessionId, '2026-09-01'),
          occurrence(sessionId, '2026-09-08'),
        ],
        attendanceDocs: [
          {
            session: sessionId, status: 'present', attendanceDate: '2026-09-01', student,
          },
          {
            session: sessionId,
            status: 'flagged',
            attendanceDate: '2026-09-08',
            reason: 'GPS location is 2.1km from the nearest session building.',
            student,
          },
        ],
      });

      const workbook = await buildAttendanceWorkbook(course);
      const sheet = workbook.worksheets[0];
      expect(sheet.columns).toHaveLength(3); // Student ID + two weekly occurrences

      const rows = [];
      sheet.eachRow({ includeEmpty: false }, (row) => rows.push(row));
      const dataRow = rows[1];
      expect(dataRow.getCell(`${sessionId}|2026-09-01`).value).toBe('P');
      expect(dataRow.getCell(`${sessionId}|2026-09-01`).fill).toBeUndefined();
      expect(dataRow.getCell(`${sessionId}|2026-09-08`).value).toBe('P');
      expect(dataRow.getCell(`${sessionId}|2026-09-08`).fill).toMatchObject({ type: 'pattern' });
    },
  );
});
