/**
 * Manual attendance code generation, rotation, and verification tests.
 * Run with: npm test
 */

const mockModel = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  deleteOne: jest.fn(),
};
jest.mock('../models/ManualCode', () => mockModel);

// isWithinScheduleWindow is required lazily inside the service — mock the whole
// module so tests control "is this session currently running" directly.
const mockIsWithinScheduleWindow = jest.fn().mockReturnValue(true);
jest.mock('../services/session.service', () => ({
  isWithinScheduleWindow: (...args) => mockIsWithinScheduleWindow(...args),
}));

const manualCode = require('../services/manualCode.service');
const { GRACE_MS } = manualCode;

function makeSession(overrides = {}) {
  return {
    _id: 'session1',
    manualCodeRotationMode: 'none',
    manualCodeRotationSeconds: 60,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('manualCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsWithinScheduleWindow.mockReturnValue(true);
  });

  describe('generateCode', () => {
    it('returns an 8-digit numeric string', () => {
      const code = manualCode.generateCode();
      expect(code).toMatch(/^[0-9]{8}$/);
    });

    it('generates varied codes', () => {
      const codes = new Set(Array.from({ length: 20 }, () => manualCode.generateCode()));
      expect(codes.size).toBeGreaterThan(1);
    });
  });

  describe('getOrRotateCode', () => {
    it('creates a fresh code when none exists', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.findOneAndUpdate.mockResolvedValue({
        code: '12345678', prevCode: null, generatedAt: Date.now(), paused: false,
      });
      const result = await manualCode.getOrRotateCode(makeSession());
      expect(result.code).toHaveLength(8);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('does not rotate when rotationMode is "none"', async () => {
      mockModel.findOne.mockResolvedValue({
        code: 'existing1', prevCode: null, generatedAt: Date.now() - 1000 * 60 * 60, paused: false,
      });
      const result = await manualCode.getOrRotateCode(makeSession({ manualCodeRotationMode: 'none' }));
      expect(result.code).toBe('existing1');
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('does not rotate before the interval elapses', async () => {
      mockModel.findOne.mockResolvedValue({
        code: 'existing1', prevCode: null, generatedAt: Date.now() - 5000, paused: false,
      });
      const session = makeSession({ manualCodeRotationMode: 'interval', manualCodeRotationSeconds: 60 });
      const result = await manualCode.getOrRotateCode(session);
      expect(result.code).toBe('existing1');
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rotates once the interval elapses, keeping the old code as prevCode', async () => {
      mockModel.findOne.mockResolvedValue({
        code: 'oldcode1', prevCode: null, generatedAt: Date.now() - 61_000, paused: false,
      });
      mockModel.findOneAndUpdate.mockResolvedValue({
        code: 'newcode1', prevCode: 'oldcode1', generatedAt: Date.now(), paused: false,
      });
      const session = makeSession({ manualCodeRotationMode: 'interval', manualCodeRotationSeconds: 60 });
      await manualCode.getOrRotateCode(session);
      const [, update] = mockModel.findOneAndUpdate.mock.calls[0];
      expect(update.prevCode).toBe('oldcode1');
    });

    it('does not rotate while paused, even past the interval', async () => {
      mockModel.findOne.mockResolvedValue({
        code: 'frozen1', prevCode: null, generatedAt: Date.now() - 61_000, paused: true,
      });
      const session = makeSession({ manualCodeRotationMode: 'interval', manualCodeRotationSeconds: 60 });
      const result = await manualCode.getOrRotateCode(session);
      expect(result.code).toBe('frozen1');
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('verifyCode', () => {
    it('accepts the current code', async () => {
      mockModel.findOne.mockResolvedValue({
        code: '11112222', prevCode: null, generatedAt: Date.now(), paused: false,
      });
      expect(await manualCode.verifyCode(makeSession(), '11112222')).toBe(true);
    });

    it('rejects a wrong code', async () => {
      mockModel.findOne.mockResolvedValue({
        code: '11112222', prevCode: null, generatedAt: Date.now(), paused: false,
      });
      expect(await manualCode.verifyCode(makeSession(), '99998888')).toBe(false);
    });

    it('rejects non-8-digit input without touching the model', async () => {
      expect(await manualCode.verifyCode(makeSession(), '123')).toBe(false);
      expect(mockModel.findOne).not.toHaveBeenCalled();
    });

    it('accepts the previous code within the rotation grace window', async () => {
      mockModel.findOne.mockResolvedValue({
        code: '22223333', prevCode: '11112222', generatedAt: Date.now() - 500, paused: false,
      });
      expect(await manualCode.verifyCode(makeSession(), '11112222')).toBe(true);
    });

    it('rejects the previous code after the grace window', async () => {
      mockModel.findOne.mockResolvedValue({
        code: '22223333', prevCode: '11112222', generatedAt: Date.now() - (GRACE_MS + 500), paused: false,
      });
      expect(await manualCode.verifyCode(makeSession(), '11112222')).toBe(false);
    });
  });

  describe('resume / regenerate — no grace window', () => {
    it('resume clears prevCode so the paused code stops working immediately', async () => {
      mockModel.findOne.mockResolvedValue({ code: 'oldcode1', prevCode: null, generatedAt: Date.now(), paused: true });
      mockModel.findOneAndUpdate.mockResolvedValue({ code: 'newcode1', prevCode: null, generatedAt: Date.now(), paused: false });
      await manualCode.resume(makeSession());
      const [, update] = mockModel.findOneAndUpdate.mock.calls[0];
      expect(update.prevCode).toBeNull();
      expect(update.paused).toBe(false);
    });

    it('regenerate clears prevCode so the old code stops working immediately', async () => {
      mockModel.findOne.mockResolvedValue({ code: 'oldcode1', prevCode: null, generatedAt: Date.now(), paused: false });
      mockModel.findOneAndUpdate.mockResolvedValue({ code: 'newcode1', prevCode: null, generatedAt: Date.now(), paused: false });
      await manualCode.regenerate(makeSession());
      const [, update] = mockModel.findOneAndUpdate.mock.calls[0];
      expect(update.prevCode).toBeNull();
    });
  });

  describe('getStatus', () => {
    it('reports no live code when the session is outside its schedule window', async () => {
      mockIsWithinScheduleWindow.mockReturnValue(false);
      const status = await manualCode.getStatus(makeSession());
      expect(status).toMatchObject({ running: false, code: null, rotatesIn: null });
      expect(mockModel.findOne).not.toHaveBeenCalled();
    });

    it('returns the live code while running — every session has one', async () => {
      mockModel.findOne.mockResolvedValue({ code: '55556666', prevCode: null, generatedAt: Date.now(), paused: false });
      const status = await manualCode.getStatus(makeSession());
      expect(status).toMatchObject({ running: true, code: '55556666' });
    });

    it('reports the rotation config back to the lecturer', async () => {
      mockModel.findOne.mockResolvedValue({ code: '55556666', prevCode: null, generatedAt: Date.now(), paused: false });
      const status = await manualCode.getStatus(makeSession({
        manualCodeRotationMode: 'interval', manualCodeRotationSeconds: 45,
      }));
      expect(status).toMatchObject({ rotationMode: 'interval', rotationSeconds: 45 });
    });
  });

  describe('removeCode', () => {
    it('deletes the document for the session', async () => {
      await manualCode.removeCode(makeSession({ _id: 'session1' }));
      expect(mockModel.deleteOne).toHaveBeenCalledWith({ session: 'session1' });
    });
  });

  describe('verifyCode (no attempt cap or lockout)', () => {
    it('keeps rejecting a wrong code no matter how many times it is retried', async () => {
      mockModel.findOne.mockResolvedValue({ code: '11112222', prevCode: null, generatedAt: Date.now(), paused: false });
      const session = makeSession({ _id: `no-lockout-session-${Date.now()}` });

      for (let i = 0; i < 8; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        expect(await manualCode.verifyCode(session, '00000000')).toBe(false);
      }

      // The correct code still works afterwards — nothing was ever locked out.
      expect(await manualCode.verifyCode(session, '11112222')).toBe(true);
    });
  });
});

/**
 * Found by a multi-week usage simulation, not by unit testing: rotation is lazy,
 * and `verifyCode` is itself one of the callers that triggers it. A rotation
 * triggered by the submission stamped `generatedAt: now`, so the code it had just
 * demoted to `prevCode` measured 0 ms old and passed the grace check — no matter
 * how long it had really been the live code. It only showed up when nothing else
 * polled in between, i.e. the lecturer's dashboard was closed or the phone asleep.
 */
describe('manualCode — the rotation grace must not revive an overdue code', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsWithinScheduleWindow.mockReturnValue(true);
  });

  const interval = makeSession({ manualCodeRotationMode: 'interval', manualCodeRotationSeconds: 30 });

  function rotateWith(ageMs) {
    mockModel.findOne.mockResolvedValue({
      code: 'oldcode1', prevCode: null, generatedAt: Date.now() - ageMs, paused: false,
    });
    mockModel.findOneAndUpdate.mockImplementation((_f, update) => Promise.resolve({
      ...update, paused: false,
    }));
    return manualCode.getOrRotateCode(interval);
  }

  it('keeps the old code as prevCode when the rotation is due right now', async () => {
    await rotateWith(30_000);
    const [, update] = mockModel.findOneAndUpdate.mock.calls[0];
    expect(update.prevCode).toBe('oldcode1');
  });

  it('still keeps it when the rotation is only barely late (inside the grace)', async () => {
    await rotateWith(30_000 + GRACE_MS - 1);
    const [, update] = mockModel.findOneAndUpdate.mock.calls[0];
    expect(update.prevCode).toBe('oldcode1');
  });

  it('drops prevCode once the rotation is overdue by more than the grace', async () => {
    await rotateWith(30_000 + GRACE_MS + 1);
    const [, update] = mockModel.findOneAndUpdate.mock.calls[0];
    expect(update.prevCode).toBeNull();
  });

  it('drops prevCode for a badly overdue rotation — the ten-minute case', async () => {
    await rotateWith(10 * 60_000);
    const [, update] = mockModel.findOneAndUpdate.mock.calls[0];
    expect(update.prevCode).toBeNull();
  });

  it('verifyCode rejects a code that was live ten minutes ago and never rotated', async () => {
    mockModel.findOne.mockResolvedValue({
      code: 'oldcode1', prevCode: null, generatedAt: Date.now() - 10 * 60_000, paused: false,
    });
    mockModel.findOneAndUpdate.mockImplementation((_f, update) => Promise.resolve({
      ...update, paused: false,
    }));
    expect(await manualCode.verifyCode(interval, '12345678')).toBe(false);
  });
});
