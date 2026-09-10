const mongoose = require('mongoose');
const { validateSessionCreateBody, checkSessionOverlap } = require('../validators/session.validator');

function validId() {
  return new mongoose.Types.ObjectId().toHexString();
}

describe('validateSessionCreateBody', () => {
  const base = () => ({
    lectureDay: 'MON',
    startTime: '08:00',
    endTime: '10:00',
    recurring: true,
    buildings: [validId()],
  });

  describe('buildings are mandatory', () => {
    it('rejects a session with no buildings field at all', () => {
      const { buildings, ...noBuildings } = base();
      const result = validateSessionCreateBody(noBuildings);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/building/i);
    });

    it('rejects an empty buildings array', () => {
      const result = validateSessionCreateBody({ ...base(), buildings: [] });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/building/i);
    });

    it('rejects a malformed building id', () => {
      const result = validateSessionCreateBody({ ...base(), buildings: ['not-an-id'] });
      expect(result.ok).toBe(false);
    });

    it('accepts one valid building id', () => {
      const id = validId();
      const result = validateSessionCreateBody({ ...base(), buildings: [id] });
      expect(result.ok).toBe(true);
      expect(result.buildings).toEqual([id]);
    });

    it('accepts several building ids', () => {
      const ids = [validId(), validId()];
      const result = validateSessionCreateBody({ ...base(), buildings: ids });
      expect(result.ok).toBe(true);
      expect(result.buildings).toEqual(ids);
    });
  });

  describe('no verification policy is accepted or stored any more', () => {
    it('ignores a client-supplied verification field entirely', () => {
      const result = validateSessionCreateBody({ ...base(), verification: 'bluetooth' });
      expect(result.ok).toBe(true);
      expect(result.verification).toBeUndefined();
    });

    it('does not reject an unrecognized verification value — the field is simply gone', () => {
      const result = validateSessionCreateBody({ ...base(), verification: 'lasers' });
      expect(result.ok).toBe(true);
    });
  });

  describe('schedule', () => {
    it('strictly rejects malformed or out-of-range HH:mm values', () => {
      expect(validateSessionCreateBody({ ...base(), startTime: '8:00' }).ok).toBe(false);
      expect(validateSessionCreateBody({ ...base(), startTime: '25:00' }).ok).toBe(false);
      expect(validateSessionCreateBody({ ...base(), endTime: '10:99' }).ok).toBe(false);
    });

    it('rejects an end time at or before the start time', () => {
      expect(validateSessionCreateBody({ ...base(), endTime: '08:00' }).ok).toBe(false);
      expect(validateSessionCreateBody({ ...base(), endTime: '07:00' }).ok).toBe(false);
    });

    it('requires an explicit recurring flag', () => {
      expect(validateSessionCreateBody({ ...base(), recurring: undefined }).ok).toBe(false);
    });

    it('rejects a weekday outside MON..SUN', () => {
      expect(validateSessionCreateBody({ ...base(), lectureDay: 'FUNDAY' }).ok).toBe(false);
    });

    it('upper-cases the weekday', () => {
      expect(validateSessionCreateBody({ ...base(), lectureDay: 'wed' }).lectureDay).toBe('WED');
    });
  });

  describe('lecturer code rotation', () => {
    it('defaults to a non-rotating code', () => {
      const result = validateSessionCreateBody(base());
      expect(result).toMatchObject({ ok: true, manualCodeRotationMode: 'none' });
    });

    it('accepts interval rotation with a valid period', () => {
      const result = validateSessionCreateBody({
        ...base(),
        manualCodeRotationMode: 'interval',
        manualCodeRotationSeconds: 30,
      });
      expect(result).toMatchObject({
        ok: true, manualCodeRotationMode: 'interval', manualCodeRotationSeconds: 30,
      });
    });

    it('rejects a rotation period outside the allowed range', () => {
      expect(validateSessionCreateBody({
        ...base(), manualCodeRotationMode: 'interval', manualCodeRotationSeconds: 2,
      }).ok).toBe(false);
      expect(validateSessionCreateBody({
        ...base(), manualCodeRotationMode: 'interval', manualCodeRotationSeconds: 99_999,
      }).ok).toBe(false);
    });

    it('rejects an unrecognized rotation mode', () => {
      expect(validateSessionCreateBody({ ...base(), manualCodeRotationMode: 'random' }).ok).toBe(false);
    });

    it('no longer accepts an enabled flag — the code exists for every session', () => {
      const result = validateSessionCreateBody({ ...base(), manualCodeEnabled: false });
      expect(result.ok).toBe(true);
      expect(result.manualCodeEnabled).toBeUndefined();
    });
  });
});


/**
 * A rejected session used to say only "This session overlaps with an existing
 * session for the same course", which on Android arrived as a bare
 * "Request failed (400)". The message now has to carry enough for a lecturer to
 * fix it without opening the sessions list: which slot is in the way, and what
 * to do about it.
 */
describe('checkSessionOverlap — the message names the clashing session', () => {
  function fakeModel(sessions) {
    return { find: jest.fn().mockResolvedValue(sessions) };
  }

  it('reports the clashing weekly session by day and time', async () => {
    const model = fakeModel([
      { lectureDay: 'MON', startTime: '09:00', endTime: '11:00', recurring: true },
    ]);
    const result = await checkSessionOverlap(model, 'course-1', 'MON', '10:00', '12:00');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('10:00-12:00');
    expect(result.error).toContain('09:00-11:00');
    expect(result.error).toContain('MON');
    expect(result.error).toMatch(/weekly/i);
    expect(result.error).toMatch(/delete the other session/i);
  });

  it('reports a clashing one-time session with its date', async () => {
    const model = fakeModel([
      {
        lectureDay: 'MON', startTime: '09:00', endTime: '11:00', recurring: false, occurrenceDate: '2099-01-05',
      },
    ]);
    const result = await checkSessionOverlap(model, 'course-1', 'MON', '10:00', '12:00');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('2099-01-05');
    expect(result.error).toMatch(/one-time/i);
  });

  it('passes when the new slot butts up against an existing one without overlapping', async () => {
    const model = fakeModel([
      { lectureDay: 'MON', startTime: '09:00', endTime: '11:00', recurring: true },
    ]);
    expect(await checkSessionOverlap(model, 'course-1', 'MON', '11:00', '12:00')).toEqual({ ok: true });
  });
});
