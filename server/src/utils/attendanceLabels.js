function studentDisplayIdFromEmail(email, fallbackStudentId) {
  if (!email || typeof email !== 'string') return String(fallbackStudentId || '').trim();
  const at = email.indexOf('@');
  if (at <= 0) return String(fallbackStudentId || email).trim();
  return email.slice(0, at).trim();
}

function compactTimeForLabel(hhmm) {
  const raw = String(hhmm || '').trim();
  if (!raw) return '';
  const [h, m] = raw.split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h)) return raw.slice(0, 5);
  if (!Number.isFinite(m) || m === 0) return String(h);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function timeRangeForColumnLabel(session) {
  const a = compactTimeForLabel(session.startTime);
  const b = compactTimeForLabel(session.endTime);
  if (!a && !b) return '';
  return `${a}-${b}`;
}

/** Column header: "Apr 22 8:00-10:00" (no year) when we have an attendance date; else "MON 8-10". */
function formatAttendanceTableColumnLabel(session, minAttendanceDateYmd) {
  const hourRange = timeRangeForColumnLabel(session);
  if (minAttendanceDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(minAttendanceDateYmd)) {
    const d = new Date(`${minAttendanceDateYmd}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${md} ${hourRange}`.trim();
    }
  }
  return `${session.lectureDay} ${timeRangeForColumnLabel(session)}`.trim();
}

module.exports = {
  studentDisplayIdFromEmail,
  formatAttendanceTableColumnLabel,
};
