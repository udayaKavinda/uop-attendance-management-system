/**
 * The lecture window is half-open: [startTime, endTime).
 *
 * It used to be closed on both ends (`currentMinutes > end` meant "out"), so the
 * end minute belonged to the session that was finishing AND to the one starting.
 * Back-to-back slots (09:00-11:00 followed by 11:00-13:00) are the ordinary shape
 * of a timetable, and `findScheduleOverlap` has always allowed them — it treats
 * times as half-open (`sStart < newEnd`). So the system permitted a pair it then
 * could not tell apart, and `resolveActiveSessionForCourse` resolves with
 * `sessions.find(...)`: the FIRST match in whatever order Mongo returned. A
 * student checking in at 11:00 for the incoming lecture could be recorded against
 * the one that had just ended, every day, for sixty seconds, with nothing shown.
 *
 * Every end-boundary comparison in the codebase is pinned here, because they only
 * work as a set: the window itself, one-time expiry, the next-occurrence walk, and
 * the "running right now" sort rank.
 */

const { isScheduledNow, isWithinScheduleWindow } = require('../services/session.service');
const { isNonRecurringExpired, nextOccurrenceDate } = require('../utils/schedule');

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** A fixed Monday, so nothing here depends on when the suite runs. */
const MONDAY = new Date(2026, 8, 14); // 2026-09-14
const at = (h, m, s = 0) => new Date(2026, 8, 14, h, m, s);
const DAY = DAYS[MONDAY.getDay()];

const weekly = (startTime, endTime) => ({
  lectureDay: DAY, startTime, endTime, recurring: true, occurrenceDate: null, active: true,
});

describe('a session ends the moment the clock reaches its endTime', () => {
  const s = weekly('09:00', '11:00');

  it('is open one minute before the end', () => {
    expect(isScheduledNow(s, at(10, 59))).toBe(true);
  });

  it('is closed at exactly the end minute', () => {
    expect(isScheduledNow(s, at(11, 0))).toBe(false);
  });

  it('is closed part-way through the end minute too', () => {
    expect(isScheduledNow(s, at(11, 0, 30))).toBe(false);
  });

  it('is open at exactly the start minute — the start stays inclusive', () => {
    expect(isScheduledNow(s, at(9, 0))).toBe(true);
  });
});

describe('back-to-back lectures never both claim the boundary minute', () => {
  const first = weekly('09:00', '11:00');
  const second = weekly('11:00', '13:00');

  it('only the incoming lecture is in window at 11:00', () => {
    expect(isWithinScheduleWindow(first, at(11, 0))).toBe(false);
    expect(isWithinScheduleWindow(second, at(11, 0))).toBe(true);
  });

  it('only the outgoing lecture is in window at 10:59', () => {
    expect(isWithinScheduleWindow(first, at(10, 59))).toBe(true);
    expect(isWithinScheduleWindow(second, at(10, 59))).toBe(false);
  });

  it('exactly one of them is live at every minute across the handover', () => {
    for (let minute = 10 * 60 + 55; minute <= 11 * 60 + 5; minute += 1) {
      const when = at(Math.floor(minute / 60), minute % 60);
      const live = [first, second].filter((s) => isWithinScheduleWindow(s, when));
      expect(live).toHaveLength(1);
    }
  });
});

describe('one-time expiry uses the same boundary', () => {
  const oneTime = { recurring: false, occurrenceDate: '2026-09-14', endTime: '11:00' };

  it('is not yet spent a minute before the end', () => {
    expect(isNonRecurringExpired(oneTime, at(10, 59))).toBe(false);
  });

  it('is spent at exactly the end minute', () => {
    expect(isNonRecurringExpired(oneTime, at(11, 0))).toBe(true);
  });
});

describe('the next-occurrence walk uses the same boundary', () => {
  it('still offers today a minute before the end', () => {
    expect(nextOccurrenceDate(DAY, at(10, 59), '11:00')).toBe('2026-09-14');
  });

  it('rolls to next week at exactly the end minute', () => {
    expect(nextOccurrenceDate(DAY, at(11, 0), '11:00')).toBe('2026-09-21');
  });
});
