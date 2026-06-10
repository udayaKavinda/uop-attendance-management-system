/**
 * Schedule-window resolution unit tests (pure time math, no DB).
 */
const {
  isWithinScheduleWindow,
  invalidateActiveSessionCache,
} = require('../services/session.service');
const { DAY_INDEX } = require('../utils/schedule');

// A fixed local time: 2026-06-08 09:30 (constructed from local components).
const NOW = new Date(2026, 5, 8, 9, 30, 0);
const TODAY = DAY_INDEX[NOW.getDay()];

function session(overrides = {}) {
  return {
    active: true,
    deleted: false,
    lectureDay: TODAY,
    startTime: '09:00',
    endTime: '11:00',
    ...overrides,
  };
}

describe('isWithinScheduleWindow', () => {
  it('returns true inside the window on the matching day', () => {
    expect(isWithinScheduleWindow(session(), NOW)).toBe(true);
  });
  it('returns false before the start time', () => {
    expect(isWithinScheduleWindow(session({ startTime: '10:00' }), NOW)).toBe(false);
  });
  it('returns false after the end time', () => {
    expect(isWithinScheduleWindow(session({ endTime: '09:15' }), NOW)).toBe(false);
  });
  it('returns false on a different day', () => {
    const otherDay = DAY_INDEX[(NOW.getDay() + 1) % 7];
    expect(isWithinScheduleWindow(session({ lectureDay: otherDay }), NOW)).toBe(false);
  });
  it('returns false for inactive or deleted sessions', () => {
    expect(isWithinScheduleWindow(session({ active: false }), NOW)).toBe(false);
    expect(isWithinScheduleWindow(session({ deleted: true }), NOW)).toBe(false);
  });
  it('returns false for invalid time config', () => {
    expect(isWithinScheduleWindow(session({ startTime: 'bad' }), NOW)).toBe(false);
  });
  it('returns false for null input', () => {
    expect(isWithinScheduleWindow(null, NOW)).toBe(false);
  });
});

describe('invalidateActiveSessionCache', () => {
  it('does not throw for a specific id or a full clear', () => {
    expect(() => invalidateActiveSessionCache('abc123')).not.toThrow();
    expect(() => invalidateActiveSessionCache()).not.toThrow();
  });
});
