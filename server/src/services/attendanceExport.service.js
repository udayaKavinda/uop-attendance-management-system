const ExcelJS = require('exceljs');
const attendanceService = require('./attendance.service');
const { studentDisplayIdFromEmail, formatAttendanceTableColumnLabel } = require('../utils/attendanceLabels');

// Soft red so the sheet still reads fine printed in black and white — the cell
// text ('F') and comment carry the actual information either way.
const FLAG_FILL = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' },
};
const FLAG_FONT = { color: { argb: 'FF842029' }, bold: true };

function sheetNameFor(course) {
  const raw = [course.code, course.batch].filter(Boolean).join(' ') || 'Attendance';
  return raw.replace(/[:\\/?*[\]]/g, '').slice(0, 31);
}

/**
 * Builds the downloadable Excel report: one row per student, one column per
 * session, 'P' for present. A `flagged` record ('far'/'unknown' GPS verdict
 * that never passed) gets a red-filled 'F' cell with the reason as a cell
 * comment — this is the only place that reason is ever surfaced; nobody
 * "reviews" it, it's just visible context for whoever reads the export.
 */
async function buildAttendanceWorkbook(course) {
  const { sessions, attendanceDocs, sessionMinDate } = await attendanceService.getAttendanceMatrixRaw(course);

  const rowsMap = new Map(); // studentId -> { displayId, cells: Map(sessionId -> doc) }
  attendanceDocs.forEach((doc) => {
    const sid = String(doc.student?._id || '');
    if (!sid) return;
    if (!rowsMap.has(sid)) {
      rowsMap.set(sid, {
        displayId: studentDisplayIdFromEmail(doc.student?.email, doc.student?.studentId),
        cells: new Map(),
      });
    }
    rowsMap.get(sid).cells.set(String(doc.session), doc);
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetNameFor(course));

  sheet.columns = [
    { header: 'Student ID', key: 'studentId', width: 20 },
    ...sessions.map((s) => ({
      header: formatAttendanceTableColumnLabel(s, sessionMinDate.get(String(s._id))),
      key: String(s._id),
      width: 18,
    })),
  ];
  sheet.getRow(1).font = { bold: true };

  const rows = [...rowsMap.values()].sort((a, b) => a.displayId.localeCompare(b.displayId));
  rows.forEach((row) => {
    const values = { studentId: row.displayId };
    sessions.forEach((s) => {
      const doc = row.cells.get(String(s._id));
      values[String(s._id)] = doc?.status === 'present' ? 'P' : doc?.status === 'flagged' ? 'F' : '';
    });
    const sheetRow = sheet.addRow(values);
    sessions.forEach((s) => {
      const doc = row.cells.get(String(s._id));
      if (doc?.status !== 'flagged') return;
      const cell = sheetRow.getCell(String(s._id));
      cell.fill = FLAG_FILL;
      cell.font = FLAG_FONT;
      cell.note = doc.reason || 'Flagged — never verified as present.';
    });
  });

  return workbook;
}

module.exports = { buildAttendanceWorkbook };
