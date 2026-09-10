'use strict';

/**
 * The create form takes a weekday, not a date, and the server derives the date for
 * one-time sessions. These pin the confirmation that reports which date it picked —
 * the only feedback a lecturer gets before the session silently expires unused.
 */

const { sessionCreatedMessage } = require('../utils/sessionLabels');
const { localYmd } = require('../utils/date');

// Local noon, so no offset can shift the reference day.
const MON_14_SEP = new Date(2026, 8, 14, 12, 0, 0);

function oneTime(overrides = {}) {
  return {
    recurring: false, occurrenceDate: '2026-09-14', startTime: '10:00', endTime: '12:00', ...overrides,
  };
}

describe('sessionCreatedMessage — one-time sessions name their resolved date', () => {
  test('calls out "today" when the session landed on today', () => {
    const msg = sessionCreatedMessage(oneTime({ occurrenceDate: '2026-09-14' }), MON_14_SEP);
    expect(msg).toBe('One-time session created for today (Mon 14 Sep), 10:00-12:00.');
  });

  test('names the date plainly when it rolled to another day', () => {
    // The failure this exists for: the same taps at 15:00 instead of 09:00 push the
    // session a week out, and the absence of "today" is what tells the lecturer.
    const msg = sessionCreatedMessage(oneTime({ occurrenceDate: '2026-09-21' }), MON_14_SEP);
    expect(msg).toBe('One-time session created for Mon 21 Sep, 10:00-12:00.');
    expect(msg).not.toMatch(/today/);
  });

  test('renders month and weekday names without depending on the ICU build', () => {
    // toLocaleDateString would render these from whatever locale data Node ships,
    // and a small-icu build falls back to en-US silently.
    expect(sessionCreatedMessage(oneTime({ occurrenceDate: '2026-01-01' }), MON_14_SEP))
      .toContain('Thu 1 Jan');
    expect(sessionCreatedMessage(oneTime({ occurrenceDate: '2026-12-31' }), MON_14_SEP))
      .toContain('Thu 31 Dec');
  });

  test('a date at the very start of the day is not rolled onto the day before', () => {
    // Parsed at local noon precisely so a negative UTC offset cannot shift it back.
    expect(sessionCreatedMessage(oneTime({ occurrenceDate: '2026-03-01' }), MON_14_SEP))
      .toContain('Sun 1 Mar');
  });

  test('falls back to the generic line when the date is missing or malformed', () => {
    expect(sessionCreatedMessage(oneTime({ occurrenceDate: null }), MON_14_SEP)).toBe('Session created.');
    expect(sessionCreatedMessage(oneTime({ occurrenceDate: '14/09/2026' }), MON_14_SEP)).toBe('Session created.');
  });

  test('defaults "today" to the real clock when no time is injected', () => {
    const msg = sessionCreatedMessage(oneTime({ occurrenceDate: localYmd() }));
    expect(msg).toMatch(/^One-time session created for today \(/);
  });
});

describe('sessionCreatedMessage — weekly sessions', () => {
  test('names the weekday in full and says nothing about a date', () => {
    const msg = sessionCreatedMessage({
      recurring: true, lectureDay: 'MON', startTime: '10:00', endTime: '12:00',
    }, MON_14_SEP);
    expect(msg).toBe('Weekly session created for every Monday, 10:00-12:00.');
  });

  test('accepts a lower-case weekday', () => {
    const msg = sessionCreatedMessage({
      recurring: true, lectureDay: 'thu', startTime: '08:00', endTime: '09:30',
    }, MON_14_SEP);
    expect(msg).toBe('Weekly session created for every Thursday, 08:00-09:30.');
  });

  test('falls back to the generic line for an unrecognised weekday', () => {
    expect(sessionCreatedMessage({
      recurring: true, lectureDay: 'XXX', startTime: '08:00', endTime: '09:30',
    }, MON_14_SEP)).toBe('Session created.');
  });

  test('omits the time range when the session has no usable times', () => {
    expect(sessionCreatedMessage({ recurring: true, lectureDay: 'MON' }, MON_14_SEP))
      .toBe('Weekly session created for every Monday.');
  });
});

/**
 * Wiring: the message is worthless if it never reaches the wire. Mocks the service
 * so this asserts the controller's response shape and nothing else.
 */
jest.mock('../services/lectureSession.service', () => ({ createSession: jest.fn() }));
jest.mock('../services/course.service', () => ({}));
jest.mock('../services/attendance.service', () => ({}));
jest.mock('../services/attendanceExport.service', () => ({}));

const lectureSessionService = require('../services/lectureSession.service');
const coursesController = require('../controllers/admin/courses.controller');

function fakeRes() {
  return {
    body: null,
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('POST /api/admin/courses/:courseId/sessions — the response carries the message', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the resolved date alongside the created session', async () => {
    const session = {
      _id: 's1', recurring: false, occurrenceDate: '2026-09-21', startTime: '10:00', endTime: '12:00',
    };
    lectureSessionService.createSession.mockResolvedValue({ ok: true, session });

    const res = fakeRes();
    await coursesController.createSession({ course: { _id: 'c1' }, body: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.session).toBe(session);
    expect(res.body.message).toBe('One-time session created for Mon 21 Sep, 10:00-12:00.');
  });

  it('carries no message on the failure path, only the error', async () => {
    lectureSessionService.createSession.mockResolvedValue({ ok: false, status: 400, error: 'nope' });

    const res = fakeRes();
    await coursesController.createSession({ course: { _id: 'c1' }, body: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'nope' });
  });
});
