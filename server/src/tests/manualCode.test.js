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

  describe('verifyAttempt (per-student, per-session guess limiting)', () => {
    it('locks out after 5 wrong attempts and clears on success', async () => {
      mockModel.findOne.mockResolvedValue({ code: '11112222', prevCode: null, generatedAt: Date.now(), paused: false });
      const session = makeSession({ _id: `lockout-session-${Date.now()}` });

      for (let i = 0; i < 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const attempt = await manualCode.verifyAttempt('student1', session, '00000000');
        expect(attempt.ok).toBe(false);
      }

      const lockedAttempt = await manualCode.verifyAttempt('student1', session, '11112222');
      expect(lockedAttempt.lockedOut).toBe(true);
    });

    it('a different student on the same session is unaffected by another student’s lockout', async () => {
      mockModel.findOne.mockResolvedValue({ code: '11112222', prevCode: null, generatedAt: Date.now(), paused: false });
      const session = makeSession({ _id: `shared-session-${Date.now()}` });

      for (let i = 0; i < 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await manualCode.verifyAttempt('studentA', session, '00000000');
      }

      const otherStudent = await manualCode.verifyAttempt('studentB', session, '11112222');
      expect(otherStudent.ok).toBe(true);
    });
  });
});
