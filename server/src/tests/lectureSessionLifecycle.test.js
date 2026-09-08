'use strict';

/**
 * Closes documented-but-untested gaps flagged in server/README.md's Testing
 * section: sessionSortRank's weekday check (a real regression shipped once —
 * a wrong-weekday session ranked as "running now" whenever its time-of-day
 * window happened to overlap the current clock time), activateSession's
 * schedule-window gate, and the recurring-session window-close sweep.
 *
 * listAllForStaff and activateSession both resolve "now" internally via
 * `new Date()` — neither accepts an injectable clock — so tests that need a
 * fixed time install a Date subclass for the duration of one call.
 */

jest.mock('../models/LectureSession', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  updateMany: jest.fn(),
}));
jest.mock('../models/Course', () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock('../models/Geofence', () => ({ countDocuments: jest.fn() }));
jest.mock('../services/bluetoothCode.service', () => ({ removeToken: jest.fn() }));
jest.mock('../services/manualCode.service', () => ({ removeCode: jest.fn() }));

const LectureSession = require('../models/LectureSession');
const Course = require('../models/Course');
const {
  listAllForStaff, activateSession,
} = require('../services/lectureSession.service');
const { deactivateRecurringSessionsPastWindow } = require('../services/sessionExpiry.service');
const { DAY_INDEX } = require('../utils/schedule');

// Fixed local time: Friday 2026-06-05 09:30. Chosen so a THU-configured
// session's 09:00-11:00 time-of-day window overlaps the current clock time
// even though today is Friday — exactly the collision the old bug missed.
const FRIDAY_0930 = new Date(2026, 5, 5, 9, 30, 0);
const TODAY = DAY_INDEX[FRIDAY_0930.getDay()];

async function withFixedNow(fixed, fn) {
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(fixed);
      return new RealDate(...args);
    }
    static now() { return new RealDate(fixed).getTime(); }
  };
  try {
    return await fn();
  } finally {
    global.Date = RealDate;
  }
}

function makeSession(overrides = {}) {
  return {
    _id: overrides._id || 'sess-1',
    course: { _id: 'course-1', code: 'CS101', name: 'Intro', active: true, batch: 'E23' },
    lectureDay: 'THU',
    startTime: '09:00',
    endTime: '11:00',
    recurring: true,
    active: false,
    deleted: false,
    save: jest.fn().mockResolvedValue(undefined),
    populated: () => true,
    ...overrides,
  };
}

describe('sessionSortRank (via listAllForStaff) — regression: wrong-weekday session must not rank as running', () => {
  beforeEach(() => jest.clearAllMocks());

  test(
    'a THU-only session whose time-of-day window overlaps the current clock time on a '
    + 'FRIDAY ranks behind a session that is genuinely running today',
    async () => {
      const wrongWeekday = makeSession({ _id: 'wrong-weekday', lectureDay: 'THU' });
      const runningToday = makeSession({ _id: 'running-today', lectureDay: TODAY, startTime: '09:00', endTime: '11:00' });
      LectureSession.find.mockReturnValue({
        populate: jest.fn().mockResolvedValue([wrongWeekday, runningToday]),
      });

      const sorted = await withFixedNow(
        FRIDAY_0930,
        () => listAllForStaff({ isAdmin: true, person: { _id: 'admin-1' } }, null),
      );
      expect(sorted[0]._id).toBe('running-today');
    },
  );

  test('among two sessions both scheduled today, the one running right now ranks before one later today', async () => {
    const runningNow = makeSession({ _id: 'running-now', lectureDay: TODAY, startTime: '09:00', endTime: '11:00' });
    const laterToday = makeSession({ _id: 'later-today', lectureDay: TODAY, startTime: '14:00', endTime: '15:00' });
    LectureSession.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([laterToday, runningNow]),
    });

    const sorted = await withFixedNow(
      FRIDAY_0930,
      () => listAllForStaff({ isAdmin: true, person: { _id: 'admin-1' } }, null),
    );
    expect(sorted[0]._id).toBe('running-now');
  });
});

describe('activateSession — schedule-window gate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('refuses to activate a session outside its own scheduled window', async () => {
    const session = makeSession({
      lectureDay: 'THU', startTime: '09:00', endTime: '11:00', populated: () => false,
    });
    Course.findById.mockResolvedValue({ _id: 'course-1', active: true });
    const result = await withFixedNow(FRIDAY_0930, () => activateSession(session));
    expect(result.ok).toBe(false);
  });

  test('refuses to activate when the course is disabled', async () => {
    const session = makeSession({
      lectureDay: TODAY, startTime: '09:00', endTime: '11:00', populated: () => false,
    });
    Course.findById.mockResolvedValue({ _id: 'course-1', active: false });
    const result = await withFixedNow(FRIDAY_0930, () => activateSession(session));
    expect(result).toMatchObject({ ok: false, status: 400, error: 'Course is disabled' });
  });

  test('refuses to re-activate an expired one-time session', async () => {
    const session = makeSession({
      recurring: false,
      occurrenceDate: '2020-01-01',
      lectureDay: TODAY,
      populated: () => false,
    });
    Course.findById.mockResolvedValue({ _id: 'course-1', active: true });
    const result = await withFixedNow(FRIDAY_0930, () => activateSession(session));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  test('activates a recurring session that is genuinely inside its window right now', async () => {
    const session = makeSession({
      lectureDay: TODAY, startTime: '00:00', endTime: '23:59', populated: () => false,
    });
    Course.findById.mockResolvedValue({ _id: 'course-1', active: true });
    const result = await withFixedNow(FRIDAY_0930, () => activateSession(session));
    expect(result).toMatchObject({ ok: true });
    expect(session.active).toBe(true);
  });
});

describe('deactivateRecurringSessionsPastWindow — the weekly reset sweep', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deactivates a recurring session once its window has closed for today', async () => {
    const pastWindow = makeSession({
      lectureDay: TODAY, startTime: '06:00', endTime: '07:00', active: true,
    });
    LectureSession.find.mockResolvedValue([pastWindow]);
    LectureSession.updateMany.mockResolvedValue({});

    await deactivateRecurringSessionsPastWindow(FRIDAY_0930);

    expect(LectureSession.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [pastWindow._id] } },
      { $set: { active: false } },
    );
  });

  test('leaves a recurring session alone while it is still inside its window', async () => {
    const stillRunning = makeSession({
      lectureDay: TODAY, startTime: '00:00', endTime: '23:59', active: true,
    });
    LectureSession.find.mockResolvedValue([stillRunning]);

    await deactivateRecurringSessionsPastWindow(FRIDAY_0930);

    expect(LectureSession.updateMany).not.toHaveBeenCalled();
  });

  test(
    'the same recurring session document goes inactive after week 1\'s window closes, '
    + 'so week 2 needs its own explicit Collect tap',
    async () => {
      const recurring = makeSession({
        _id: 'weekly-1', lectureDay: TODAY, startTime: '06:00', endTime: '07:00', active: true,
      });
      LectureSession.find.mockResolvedValue([recurring]);
      await deactivateRecurringSessionsPastWindow(FRIDAY_0930);
      expect(LectureSession.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['weekly-1'] } },
        { $set: { active: false } },
      );
    },
  );
});
