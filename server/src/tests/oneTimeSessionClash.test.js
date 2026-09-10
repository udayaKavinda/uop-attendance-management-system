/**
 * One-time sessions and the schedule clash check.
 *
 * Two bugs met here. The clash check compared weekday + time only, so any two
 * one-time sessions sharing a weekday collided however many weeks apart they
 * were. And it pruned old one-time sessions by DATE alone (`occurrenceDate >=
 * today`), while listAllForStaff hides them the moment their window closes — so
 * between a session ending and midnight, the lecturer was blocked by a row that
 * had already vanished from the Sessions tab, above an error telling them to go
 * and delete it.
 *
 * The rules being pinned down here:
 *
 *   new       existing                 clash?
 *   weekly    weekly                   yes, if the times overlap
 *   weekly    one-time                 yes  (the weekly runs on that date too)
 *   one-time  weekly                   yes  (same reason, other way round)
 *   one-time  one-time, same date      yes
 *   one-time  one-time, other date     NO   <- the fix
 *   anything  spent one-time           NO   (it can never run again)
 */

const { findScheduleOverlap } = require('../utils/schedule');
const { checkSessionOverlap } = require('../validators/session.validator');
const { localYmd } = require('../utils/date');

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function fakeModel(sessions) {
  return { find: jest.fn().mockResolvedValue(sessions) };
}

const weekly = (over) => ({
  lectureDay: 'MON', startTime: '09:00', endTime: '11:00', recurring: true, occurrenceDate: null, ...over,
});
const oneTime = (date, over) => ({
  lectureDay: 'MON', startTime: '09:00', endTime: '11:00', recurring: false, occurrenceDate: date, ...over,
});

describe('findScheduleOverlap — which pairs are allowed to collide', () => {
  it('lets two one-time sessions share a weekday and time on different dates', () => {
    const existing = [oneTime('2099-01-05')];
    expect(findScheduleOverlap(existing, 'MON', '09:00', '11:00', '2099-01-12')).toBeNull();
  });

  it('still catches two one-time sessions that land on the same date', () => {
    const existing = [oneTime('2099-01-05')];
    expect(findScheduleOverlap(existing, 'MON', '10:00', '12:00', '2099-01-05')).toBe(existing[0]);
  });

  it('still catches a one-time session overlapping a weekly one', () => {
    const existing = [weekly()];
    expect(findScheduleOverlap(existing, 'MON', '10:00', '12:00', '2099-01-12')).toBe(existing[0]);
  });

  it('still catches a weekly session overlapping a one-time one', () => {
    const existing = [oneTime('2099-01-05')];
    expect(findScheduleOverlap(existing, 'MON', '10:00', '12:00', null)).toBe(existing[0]);
  });

  it('still catches two weekly sessions', () => {
    const existing = [weekly()];
    expect(findScheduleOverlap(existing, 'MON', '10:00', '12:00', null)).toBe(existing[0]);
  });

  it('non-overlapping times on the same date are still fine', () => {
    const existing = [oneTime('2099-01-05')];
    expect(findScheduleOverlap(existing, 'MON', '11:00', '12:00', '2099-01-05')).toBeNull();
  });

  it('treats a one-time row with no date as a clash rather than skipping it', () => {
    // Malformed data must stay visible; silently ignoring it would let a real
    // double-booking through.
    const existing = [oneTime(null)];
    expect(findScheduleOverlap(existing, 'MON', '10:00', '12:00', '2099-01-12')).toBe(existing[0]);
  });

  it('treats a row with no recurring flag as a clash rather than skipping it', () => {
    const existing = [{ lectureDay: 'MON', startTime: '09:00', endTime: '11:00', occurrenceDate: '2099-01-05' }];
    expect(findScheduleOverlap(existing, 'MON', '10:00', '12:00', '2099-01-12')).toBe(existing[0]);
  });

  it('keeps the old 4-argument behaviour when no date is supplied', () => {
    const existing = [oneTime('2099-01-05')];
    expect(findScheduleOverlap(existing, 'MON', '10:00', '12:00')).toBe(existing[0]);
  });
});

describe("checkSessionOverlap — this morning's spent session must not block the next one", () => {
  const now = new Date();
  const today = localYmd(now);
  const todayName = DAYS[now.getDay()];

  it('does not cite a one-time session whose window has already closed today', async () => {
    // 00:01-00:02 today: over, whatever time the suite runs at, and hidden from
    // the Sessions tab by listAllForStaff's identical rule.
    const spent = oneTime(today, {
      lectureDay: todayName, startTime: '00:01', endTime: '00:02',
    });
    const result = await checkSessionOverlap(
      fakeModel([spent]), 'course-1', todayName, '00:01', '00:02', today,
    );
    expect(result).toEqual({ ok: true });
  });

  it('lets the same slot be booked for next week once today has been used', async () => {
    const ranThisMorning = oneTime(today, { lectureDay: todayName, startTime: '00:01', endTime: '00:02' });
    const nextWeek = localYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));

    const result = await checkSessionOverlap(
      fakeModel([ranThisMorning]), 'course-1', todayName, '00:01', '00:02', nextWeek,
    );
    expect(result).toEqual({ ok: true });
  });

  it('a weekly session is never pruned, however old the course is', async () => {
    const result = await checkSessionOverlap(
      fakeModel([weekly()]), 'course-1', 'MON', '10:00', '12:00', '2099-01-12',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/weekly/i);
  });

  it('a future one-time session on the same date still blocks, and is named', async () => {
    const result = await checkSessionOverlap(
      fakeModel([oneTime('2099-01-05')]), 'course-1', 'MON', '10:00', '12:00', '2099-01-05',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('2099-01-05');
    expect(result.error).toMatch(/one-time/i);
  });
});
