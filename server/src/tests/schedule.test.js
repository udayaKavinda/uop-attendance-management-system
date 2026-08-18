/**
 * Schedule helpers unit tests
 */
const {
  toMinutes, hasScheduleOverlap, isNonRecurringExpired, nextOccurrenceDate,
} = require('../utils/schedule');

describe('toMinutes', () => {
  it('converts HH:MM to minutes', () => {
    expect(toMinutes('09:00')).toBe(540);
    expect(toMinutes('13:30')).toBe(810);
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('23:59')).toBe(1439);
  });
  it('returns null for invalid input', () => {
    expect(toMinutes('')).toBeNull();
    expect(toMinutes(null)).toBeNull();
    expect(toMinutes('invalid')).toBeNull();
    expect(toMinutes('9:00')).toBeNull();
    expect(toMinutes('24:00')).toBeNull();
    expect(toMinutes('12:60')).toBeNull();
    expect(toMinutes('09:00extra')).toBeNull();
  });
});

describe('hasScheduleOverlap', () => {
  it('detects overlapping sessions on the same day', () => {
    const existing = [{ lectureDay: 'MON', startTime: '09:00', endTime: '11:00' }];
    expect(hasScheduleOverlap(existing, 'MON', '10:00', '12:00')).toBe(true);
  });
  it('allows non-overlapping sessions', () => {
    const existing = [{ lectureDay: 'MON', startTime: '09:00', endTime: '11:00' }];
    expect(hasScheduleOverlap(existing, 'MON', '11:01', '13:00')).toBe(false);
  });
  it('allows same time on different day', () => {
    const existing = [{ lectureDay: 'MON', startTime: '09:00', endTime: '11:00' }];
    expect(hasScheduleOverlap(existing, 'TUE', '09:00', '11:00')).toBe(false);
  });
});

describe('isNonRecurringExpired', () => {
  it('returns false for recurring sessions', () => {
    expect(isNonRecurringExpired({ recurring: true })).toBe(false);
  });
  it('returns false when no nonRecurringDate set', () => {
    expect(isNonRecurringExpired({ recurring: false })).toBe(false);
  });
  it('expires a dated one-time session after its occurrence date', () => {
    const now = new Date(2026, 7, 20, 9, 0);
    expect(isNonRecurringExpired({ recurring: false, occurrenceDate: '2026-08-19', endTime: '23:59' }, now)).toBe(true);
  });
  it('does not expire a dated one-time session before its occurrence', () => {
    const now = new Date(2026, 7, 18, 9, 0);
    expect(isNonRecurringExpired({ recurring: false, occurrenceDate: '2026-08-19', endTime: '10:00' }, now)).toBe(false);
  });
});

describe('nextOccurrenceDate', () => {
  it('moves a same-day one-time session to next week when today\'s end has passed', () => {
    const mondayAfterClass = new Date(2026, 7, 17, 12, 0);
    expect(nextOccurrenceDate('MON', mondayAfterClass, '10:00')).toBe('2026-08-24');
  });
  it('uses today when the same-day session has not ended', () => {
    const mondayBeforeClass = new Date(2026, 7, 17, 8, 0);
    expect(nextOccurrenceDate('MON', mondayBeforeClass, '10:00')).toBe('2026-08-17');
  });
});
