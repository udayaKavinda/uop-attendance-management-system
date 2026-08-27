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

describe('buildAttendanceWorkbook', () => {
  test('present cells show P with no fill; flagged cells show F, a red fill, and the reason as a note', async () => {
    const course = {
      _id: 'course-1', code: 'CS101', batch: 'E23', name: 'Intro to CS',
    };
    const sessionId = 'sess-1';
    attendanceService.getAttendanceMatrixRaw.mockResolvedValue({
      sessions: [session(sessionId)],
      sessionMinDate: new Map([[sessionId, '2026-01-05']]),
      attendanceDocs: [
        {
          session: sessionId,
          status: 'present',
          student: { _id: 'stu-present', email: 'present@eng.pdn.ac.lk', studentId: 'E20/123' },
        },
        {
          session: sessionId,
          status: 'flagged',
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

    const flaggedCell = flaggedRow.getCell(sessionId);
    expect(flaggedCell.value).toBe('F');
    expect(flaggedCell.fill).toMatchObject({ type: 'pattern', pattern: 'solid' });
    expect(flaggedCell.note).toMatch(/2\.1km/);

    const presentCell = presentRow.getCell(sessionId);
    expect(presentCell.value).toBe('P');
    expect(presentCell.fill).toBeUndefined();
    expect(presentCell.note).toBeUndefined();
  });

  test('a student with no record for a session gets a blank cell, not "F"', async () => {
    const course = { _id: 'course-1', code: 'CS101', batch: null };
    const sessionId = 'sess-1';
    attendanceService.getAttendanceMatrixRaw.mockResolvedValue({
      sessions: [session(sessionId)],
      sessionMinDate: new Map(),
      attendanceDocs: [
        {
          session: 'other-session',
          status: 'present',
          student: { _id: 'stu-1', email: 'a@eng.pdn.ac.lk', studentId: 'E20/1' },
        },
      ],
    });

    const workbook = await buildAttendanceWorkbook(course);
    const sheet = workbook.worksheets[0];
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => rows.push(row));
    const dataRow = rows[1];
    expect(dataRow.getCell(sessionId).value).toBe('');
  });
});
