const ExcelJS = require('exceljs');
const attendanceService = require('./attendance.service');
const { studentDisplayIdFromEmail, formatAttendanceTableColumnLabel } = require('../utils/attendanceLabels');

// Soft red so the sheet still reads fine printed in black and white — the cell
// stays 'P' either way, so the fill and comment carry the actual information.
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
 * session — 'P' for anyone with a record, '-' for no attempt at all. A
 * `flagged` record (a correct manual code accepted from a 'far'/'unknown' GPS
 * verdict — see recordHelpCodeAttendance) is a genuine present, not a separate
 * outcome: the lecturer read the code out, so treat it as attendance, but a
 * red-filled cell with the reason as a note flags it for a second look — this
 * is the only place that reason is ever surfaced; nobody "reviews" it, it's
 * just visible context for whoever reads the export.
 */
async function buildAttendanceWorkbook(course) {
  const { occurrences, attendanceDocs } = await attendanceService.getAttendanceMatrixRaw(course);

  // studentId -> { displayId, cells: Map(occurrenceKey -> doc) }. Keyed by
  // occurrence (session + attendanceDate), not session alone, so a recurring
  // session that ran several weeks gets one column per week instead of the
  // later week's document silently overwriting the earlier one.
  const rowsMap = new Map();
  attendanceDocs.forEach((doc) => {
    const sid = String(doc.student?._id || '');
    if (!sid || !doc.attendanceDate) return;
    if (!rowsMap.has(sid)) {
      rowsMap.set(sid, {
        displayId: studentDisplayIdFromEmail(doc.student?.email, doc.student?.studentId),
        cells: new Map(),
      });
    }
    rowsMap.get(sid).cells.set(`${doc.session}|${doc.attendanceDate}`, doc);
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetNameFor(course));

  sheet.columns = [
    { header: 'Student ID', key: 'studentId', width: 20 },
    ...occurrences.map((o) => ({
      header: o.session ? formatAttendanceTableColumnLabel(o.session, o.attendanceDate) : o.attendanceDate,
      key: o.key,
      width: 18,
    })),
  ];
  sheet.getRow(1).font = { bold: true };

  const rows = [...rowsMap.values()].sort((a, b) => a.displayId.localeCompare(b.displayId));
  rows.forEach((row) => {
    const values = { studentId: row.displayId };
    occurrences.forEach((o) => {
      const doc = row.cells.get(o.key);
      values[o.key] = doc?.status === 'present' || doc?.status === 'flagged' ? 'P' : '-';
    });
    const sheetRow = sheet.addRow(values);
    occurrences.forEach((o) => {
      const doc = row.cells.get(o.key);
      if (doc?.status !== 'flagged') return;
      const cell = sheetRow.getCell(o.key);
      cell.fill = FLAG_FILL;
      cell.font = FLAG_FONT;
      cell.note = doc.reason || 'Flagged — never verified as present.';
    });
  });

  return workbook;
}

module.exports = { buildAttendanceWorkbook };
