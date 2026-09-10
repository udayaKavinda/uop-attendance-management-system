/**
 * Schedule-window resolution unit tests (pure time math, no DB) plus the
 * course-resolution messages, which do read the models — mocked here.
 */
jest.mock('../models/Course', () => ({ findById: jest.fn() }));
jest.mock('../models/LectureSession', () => ({ find: jest.fn() }));

const Course = require('../models/Course');
const LectureSession = require('../models/LectureSession');
const {
  isWithinScheduleWindow,
  invalidateActiveSessionCache,
  resolveActiveSessionForCourse,
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
    recurring: true,
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
  it('rejects sessions that do not match the current recurring contract', () => {
    expect(isWithinScheduleWindow(session({ recurring: undefined }), NOW)).toBe(false);
  });
  it('returns false for null input', () => {
    expect(isWithinScheduleWindow(null, NOW)).toBe(false);
  });
  it('requires a one-time session occurrence date to match today', () => {
    expect(isWithinScheduleWindow(session({ recurring: false, occurrenceDate: '2026-06-08' }), NOW)).toBe(true);
    expect(isWithinScheduleWindow(session({ recurring: false, occurrenceDate: '2026-06-01' }), NOW)).toBe(false);
    expect(isWithinScheduleWindow(session({ recurring: false, occurrenceDate: null }), NOW)).toBe(false);
  });
});

describe('invalidateActiveSessionCache', () => {
  it('does not throw for a specific id or a full clear', () => {
    expect(() => invalidateActiveSessionCache('abc123')).not.toThrow();
    expect(() => invalidateActiveSessionCache()).not.toThrow();
  });
});


/**
 * Student-facing: this is what a check-in tap reports back. A missing course and
 * an archived one used to share one bare "Invalid course", which blamed the
 * request for something that had happened to the course.
 */
describe('resolveActiveSessionForCourse — course-level rejections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateActiveSessionCache('course-1');
    LectureSession.find.mockResolvedValue([]);
  });

  it('says the course is gone when it does not exist', async () => {
    Course.findById.mockResolvedValue(null);
    const result = await resolveActiveSessionForCourse('course-1');
    expect(result.error).toMatch(/no longer exists/i);
  });

  it('says the course was archived, and names it, when it is inactive', async () => {
    Course.findById.mockResolvedValue({ _id: 'course-1', code: 'CS101', active: false });
    const result = await resolveActiveSessionForCourse('course-1');
    expect(result.error).toMatch(/CS101/);
    expect(result.error).toMatch(/archived/i);
  });

  it('still explains an archived course that has no code', async () => {
    Course.findById.mockResolvedValue({ _id: 'course-1', active: false });
    const result = await resolveActiveSessionForCourse('course-1');
    expect(result.error).toMatch(/archived/i);
  });

  it('distinguishes "no session running" from a course-level problem', async () => {
    Course.findById.mockResolvedValue({ _id: 'course-1', code: 'CS101', active: true });
    const result = await resolveActiveSessionForCourse('course-1');
    expect(result.error).toMatch(/no active lecture session/i);
  });
});

/**
 * The resolve cache holds an *admission decision*, not just a lookup, so serving
 * it purely on age let a check-in tapped after the lecture ended through for the
 * remainder of the TTL. Time is not faked here: the cached document is the same
 * object the test holds, so shrinking its window stands in for the clock crossing
 * endTime, and exercises the same branch.
 */
describe('resolveActiveSessionForCourse — a cached admission must not outlive its window', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateActiveSessionCache('course-2');
  });

  it('re-resolves instead of serving a cached session whose window has since closed', async () => {
    const allDay = session({ lectureDay: DAY_INDEX[new Date().getDay()], startTime: '00:00', endTime: '23:59' });
    Course.findById.mockResolvedValue({ _id: 'course-2', code: 'CS102', active: true });
    LectureSession.find.mockResolvedValue([allDay]);

    const first = await resolveActiveSessionForCourse('course-2');
    expect(first.session).toBe(allDay);
    expect(Course.findById).toHaveBeenCalledTimes(1);

    allDay.endTime = '00:00'; // window now closed
    const second = await resolveActiveSessionForCourse('course-2');
    expect(second.error).toMatch(/no active lecture session/i);
    expect(Course.findById).toHaveBeenCalledTimes(2); // the cache was not trusted
  });

  it('still serves the cache while the window is genuinely open', async () => {
    const allDay = session({ lectureDay: DAY_INDEX[new Date().getDay()], startTime: '00:00', endTime: '23:59' });
    Course.findById.mockResolvedValue({ _id: 'course-2', code: 'CS102', active: true });
    LectureSession.find.mockResolvedValue([allDay]);

    await resolveActiveSessionForCourse('course-2');
    await resolveActiveSessionForCourse('course-2');
    expect(Course.findById).toHaveBeenCalledTimes(1);
  });
});
