const mockLectureFind = jest.fn();

jest.mock('../models/Course', () => ({ findById: jest.fn() }));
jest.mock('../models/LectureSession', () => ({
  find: (...args) => mockLectureFind(...args),
}));

const { getRunningCoursesForStudent } = require('../services/session.service');
const { DAY_INDEX } = require('../utils/schedule');

function runningSession(now, overrides = {}) {
  return {
    _id: 'session-1',
    course: {
      _id: 'course-1', code: 'CO321', batch: '2024', name: 'Networks', active: true,
    },
    lectureDay: DAY_INDEX[now.getDay()],
    startTime: '08:00',
    endTime: '10:00',
    recurring: true,
    active: true,
    deleted: false,
    ...overrides,
  };
}

describe('GET /courses/running service contract', () => {
  test('returns course identity only — the flow no longer branches per session', async () => {
    const now = new Date(2026, 7, 19, 9, 0);
    mockLectureFind.mockReturnValue({ populate: jest.fn().mockResolvedValue([runningSession(now)]) });

    const result = await getRunningCoursesForStudent(now);

    expect(result).toEqual([{
      _id: 'course-1', code: 'CO321', batch: '2024', name: 'Networks',
    }]);
  });

  test('omits sessions outside their scheduled window', async () => {
    const now = new Date(2026, 7, 19, 11, 0); // session ends 10:00
    mockLectureFind.mockReturnValue({ populate: jest.fn().mockResolvedValue([runningSession(now)]) });

    expect(await getRunningCoursesForStudent(now)).toEqual([]);
  });

  test('omits sessions whose course has been disabled', async () => {
    const now = new Date(2026, 7, 19, 9, 0);
    const session = runningSession(now);
    session.course.active = false;
    mockLectureFind.mockReturnValue({ populate: jest.fn().mockResolvedValue([session]) });

    expect(await getRunningCoursesForStudent(now)).toEqual([]);
  });

  test('de-duplicates a course running two sessions at once', async () => {
    const now = new Date(2026, 7, 19, 9, 0);
    const a = runningSession(now);
    const b = runningSession(now, { _id: 'session-2' });
    b.course = a.course;
    mockLectureFind.mockReturnValue({ populate: jest.fn().mockResolvedValue([a, b]) });

    expect(await getRunningCoursesForStudent(now)).toHaveLength(1);
  });
});
