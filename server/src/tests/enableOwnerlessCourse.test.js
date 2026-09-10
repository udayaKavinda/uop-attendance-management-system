/**
 * Re-activating an archived course that has lost its last lecturer.
 *
 * deleteLecturer deliberately allows an ARCHIVED course to drop to zero owners
 * (it runs nothing, so an empty owner list is inert). The Course schema then
 * forbids that same course being active, so `enableCourse` used to reach
 * `course.save()` and throw a ValidationError, which the global error handler
 * turned into "These fields are missing or invalid: lecturers." — a field the
 * admin never touched, on a button labelled Enable.
 */

const courseService = require('../services/course.service');

jest.mock('../models/Course', () => ({}));
jest.mock('../models/LectureSession', () => ({}));
jest.mock('../models/ManualCode', () => ({}));
jest.mock('../services/bluetoothCode.service', () => ({ removeToken: jest.fn() }));
jest.mock('../services/session.service', () => ({ invalidateActiveSessionCache: jest.fn() }));
jest.mock('../validators/course.validator', () => ({ validateLecturerIds: jest.fn() }));

function makeCourse(lecturers) {
  return {
    _id: 'c1',
    active: false,
    lecturers,
    save: jest.fn().mockResolvedValue(undefined),
    populate: jest.fn().mockResolvedValue(undefined),
  };
}

describe('enableCourse with no assigned lecturer', () => {
  test('is refused with a message naming the actual problem', async () => {
    const course = makeCourse([]);
    const result = await courseService.enableCourse(course);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/no assigned lecturer/i);
    expect(result.error).toMatch(/assign at least one lecturer/i);
  });

  test('does not save, so the course is left archived rather than half-changed', async () => {
    const course = makeCourse([]);
    await courseService.enableCourse(course);

    expect(course.save).not.toHaveBeenCalled();
    expect(course.active).toBe(false);
  });

  test('a missing lecturers array is treated the same as an empty one', async () => {
    const course = makeCourse(undefined);
    const result = await courseService.enableCourse(course);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  test('a course that still has an owner activates as before', async () => {
    const course = makeCourse(['lecturer-1']);
    const result = await courseService.enableCourse(course);

    expect(result.ok).toBe(true);
    expect(course.active).toBe(true);
    expect(course.save).toHaveBeenCalled();
  });
});
