/**
 * Schedule helpers unit tests
 */
const { toMinutes, hasScheduleOverlap, isNonRecurringExpired } = require('../utils/schedule');

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
});
