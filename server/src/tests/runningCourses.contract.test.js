const mockLectureFind = jest.fn();

jest.mock('../models/Course', () => ({ findById: jest.fn() }));
jest.mock('../models/LectureSession', () => ({
  find: (...args) => mockLectureFind(...args),
}));
jest.mock('../services/settings.service', () => ({
  getSettings: jest.fn().mockResolvedValue({
    manualCodeAllowed: true,
    bluetoothAllowed: true,
    geofenceAllowed: true,
  }),
  isVerificationAllowed: jest.requireActual('../services/settings.service').isVerificationAllowed,
}));

const { getRunningCoursesForStudent } = require('../services/session.service');
const { DAY_INDEX } = require('../utils/schedule');

describe('GET /courses/running service contract', () => {
  test('includes the active session verification mode for Android dispatch', async () => {
    const now = new Date(2026, 7, 19, 9, 0);
    const course = { _id: 'course-1', code: 'CO321', batch: '2024', name: 'Networks', active: true };
    const sessions = [{
      _id: 'session-1',
      course,
      lectureDay: DAY_INDEX[now.getDay()],
      startTime: '08:00',
      endTime: '10:00',
      recurring: true,
      active: true,
      deleted: false,
      verification: 'geofence',
      manualCodeEnabled: true,
    }];
    mockLectureFind.mockReturnValue({ populate: jest.fn().mockResolvedValue(sessions) });

    const result = await getRunningCoursesForStudent(now);

    expect(result).toEqual([expect.objectContaining({
      _id: 'course-1',
      verification: 'geofence',
      manualCodeEnabled: true,
    })]);
  });
});
