import * as XLSX from 'xlsx';

function systemLocalYmd(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value || '0000';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

/** @param {{ course?: { code?: string }; sessions: { _id: unknown; label: string }[]; rows?: { studentId?: string; email?: string; attendance?: Record<string, boolean> }[] }} table */
export function downloadAttendanceTableExcel(table) {
  if (!table?.course || !Array.isArray(table.sessions) || table.sessions.length === 0) return;

  const headers = ['Student ID', ...table.sessions.map((s) => s.label)];
  const body = (table.rows || []).map((row) => [
    row.studentId ?? '',
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
  const date = systemLocalYmd();
  XLSX.writeFile(wb, `attendance-table-${slug}-${date}.xlsx`);
}
