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

describe('listAllForStaff — sessions belonging to archived courses', () => {
  beforeEach(() => jest.clearAllMocks());

  function listAll() {
    return withFixedNow(
      FRIDAY_0930,
      () => listAllForStaff({ isAdmin: true, person: { _id: 'admin-1' } }, null),
    );
  }

  test('a session on an archived course is not listed, while its active-course sibling is', async () => {
    const archived = makeSession({
      _id: 'on-archived-course',
      course: { _id: 'course-2', code: 'CS999', active: false },
    });
    const live = makeSession({ _id: 'on-active-course', lectureDay: TODAY });
    LectureSession.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([archived, live]),
    });

    const sorted = await listAll();
    expect(sorted.map((s) => s._id)).toEqual(['on-active-course']);
  });

  test('pagination counts only the visible sessions, so `total` cannot include hidden ones', async () => {
    LectureSession.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([
        makeSession({ _id: 'a', course: { _id: 'c2', code: 'CS999', active: false } }),
        makeSession({ _id: 'b', course: { _id: 'c3', code: 'CS998', active: false } }),
        makeSession({ _id: 'c', lectureDay: TODAY }),
      ]),
    });

    const page = await withFixedNow(
      FRIDAY_0930,
      () => listAllForStaff(
        { isAdmin: true, person: { _id: 'admin-1' } },
        { hasLimit: true, page: 1, limit: 50 },
      ),
    );
    expect(page.total).toBe(1);
    expect(page.hasMore).toBe(false);
    expect(page.items.map((s) => s._id)).toEqual(['c']);
  });

  test('a session whose course failed to populate stays visible rather than being silently dropped', async () => {
    LectureSession.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([makeSession({ _id: 'dangling', course: null })]),
    });
    const sorted = await listAll();
    expect(sorted.map((s) => s._id)).toEqual(['dangling']);
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
    Course.findById.mockResolvedValue({ _id: 'course-1', code: 'CS101', active: false });
    const result = await withFixedNow(FRIDAY_0930, () => activateSession(session));
    expect(result).toMatchObject({ ok: false, status: 400 });
    // Names the course and the remedy, not just the state — see the archived-course
    // messaging work; a bare "Course is disabled" left staff with nowhere to go.
    expect(result.error).toMatch(/CS101 is archived/i);
    expect(result.error).toMatch(/unarchive/i);
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
    expect(result.error).toMatch(/2020-01-01/);
    expect(result.error).toMatch(/passed/i);
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

describe('listAllForStaff — spent one-time sessions are hidden', () => {
  beforeEach(() => jest.clearAllMocks());

  const listAll = () => withFixedNow(
    FRIDAY_0930,
    () => listAllForStaff({ isAdmin: true, person: { _id: 'admin-1' } }, null),
  );

  test('a one-time session whose date has passed is dropped from the list', async () => {
    const expired = makeSession({
      _id: 'expired-one-time', recurring: false, occurrenceDate: '2026-06-04', lectureDay: 'THU',
    });
    const upcoming = makeSession({ _id: 'upcoming-weekly', lectureDay: 'THU' });
    LectureSession.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([expired, upcoming]),
    });

    expect((await listAll()).map((s) => s._id)).toEqual(['upcoming-weekly']);
  });

  test('a one-time session that already ended earlier TODAY is dropped too', async () => {
    const endedToday = makeSession({
      _id: 'ended-today', recurring: false, occurrenceDate: '2026-06-05', lectureDay: TODAY, startTime: '07:00', endTime: '08:00',
    });
    const upcoming = makeSession({ _id: 'upcoming-weekly', lectureDay: 'THU' });
    LectureSession.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([endedToday, upcoming]),
    });

    expect((await listAll()).map((s) => s._id)).toEqual(['upcoming-weekly']);
  });

  test('a one-time session still to come today is kept', async () => {
    const laterToday = makeSession({
      _id: 'later-today', recurring: false, occurrenceDate: '2026-06-05', lectureDay: TODAY, startTime: '14:00', endTime: '15:00',
    });
    LectureSession.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([laterToday]),
    });

    expect((await listAll()).map((s) => s._id)).toEqual(['later-today']);
  });

  test('a one-time session running right now is kept, and still ranks first', async () => {
    const runningOneTime = makeSession({
      _id: 'running-one-time', recurring: false, occurrenceDate: '2026-06-05', lectureDay: TODAY, startTime: '09:00', endTime: '11:00',
    });
    const upcoming = makeSession({ _id: 'upcoming-weekly', lectureDay: 'THU' });
    LectureSession.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([upcoming, runningOneTime]),
    });

    expect((await listAll())[0]._id).toBe('running-one-time');
  });

  // The expiry sweep treats a row missing `recurring`/`occurrenceDate` as expired
  // (fail closed). This list must NOT, or the only visible evidence of a broken
  // row disappears — same principle as keeping a dangling course ref listed.
  test('a malformed session missing its weekly/one-time setting stays visible', async () => {
    const malformed = makeSession({ _id: 'malformed', recurring: undefined, lectureDay: 'THU' });
    LectureSession.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([malformed]),
    });

    expect((await listAll()).map((s) => s._id)).toEqual(['malformed']);
  });

  test('a one-time row that is expired but missing its occurrenceDate stays visible', async () => {
    const broken = makeSession({ _id: 'broken-one-time', recurring: false, occurrenceDate: null, lectureDay: 'THU' });
    LectureSession.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([broken]),
    });

    expect((await listAll()).map((s) => s._id)).toEqual(['broken-one-time']);
  });
});
