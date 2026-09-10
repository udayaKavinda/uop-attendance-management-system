const { localYmd } = require('./date');

const DAY_FULL = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function timeRange(session) {
  const start = String(session?.startTime || '').trim();
  const end = String(session?.endTime || '').trim();
  if (!start || !end) return '';
  return `${start}-${end}`;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Mon 21 Sep". Built from a fixed table rather than toLocaleDateString: month and
 * weekday names there come from whatever ICU data the Node build ships, and a
 * small-icu build silently falls back to en-US for any other locale — so the same
 * code can render a different string in production than it does in development.
 * The date is constructed at local noon so no timezone offset can roll it onto the
 * neighbouring day, which is the whole point of the message.
 */
function humanDate(ymd) {
  if (!YMD_RE.test(String(ymd || ''))) return null;
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/**
 * Confirmation copy for a just-created session, composed here rather than in each
 * client so both say exactly the same thing.
 *
 * It exists to make one specific mistake visible at the only moment it is cheap to
 * fix. The create form takes a *weekday*, not a date; for a one-time session the
 * server derives the date via nextOccurrenceDate, which counts today only while
 * today's endTime is still ahead. So the identical set of taps produces "today" at
 * 09:00 and "the same weekday next week" at 15:00, and nothing used to say which
 * had happened — the lecturer walked away believing it was set for today, nobody
 * tapped Collect on the day it actually landed, and the session expired unused.
 * Naming the resolved date here is what turns that into a two-second correction.
 *
 * "today" is called out explicitly because it is the case lecturers expect: its
 * absence is the signal that the date rolled.
 */
function sessionCreatedMessage(session, now = new Date()) {
  const range = timeRange(session);
  const suffix = range ? `, ${range}.` : '.';

  if (session?.recurring !== false) {
    const day = String(session?.lectureDay || '').toUpperCase();
    const named = DAY_FULL[day];
    if (!named) return 'Session created.';
    return `Weekly session created for every ${named}${suffix}`;
  }

  const label = humanDate(session?.occurrenceDate);
  // A one-time session with no usable date is a data problem, not something to
  // narrate a date for; the generic line keeps the success path honest.
  if (!label) return 'Session created.';

  if (session.occurrenceDate === localYmd(now)) {
    return `One-time session created for today (${label})${suffix}`;
  }
  return `One-time session created for ${label}${suffix}`;
}

module.exports = { sessionCreatedMessage };
