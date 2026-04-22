import * as XLSX from 'xlsx';

/** @param {{ course?: { code?: string }; sessions: { _id: unknown; label: string }[]; rows?: { studentId?: string; email?: string; attendance?: Record<string, boolean> }[] }} table */
export function downloadAttendanceTableExcel(table) {
  if (!table?.course || !Array.isArray(table.sessions) || table.sessions.length === 0) return;

  const headers = ['Student ID', 'Email', ...table.sessions.map((s) => s.label)];
  const body = (table.rows || []).map((row) => [
    row.studentId ?? '',
    row.email ?? '',
    ...table.sessions.map((s) => (row.attendance?.[String(s._id)] ? 'P' : '')),
  ]);
  const aoa = [headers, ...body];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance table');

  const rawCode = String(table.course.code || 'course');
  const rawBatch = String(table.course.batch || '').trim();
  const safeCode = rawCode.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'course';
  const safeBatch = rawBatch.replace(/[\\/:*?"<>|]+/g, '_').trim();
  const slug = safeBatch ? `${safeCode}-${safeBatch}` : safeCode;
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `attendance-table-${slug}-${date}.xlsx`);
}
