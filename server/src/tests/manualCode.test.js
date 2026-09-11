/**
 * Manual attendance code generation, rotation, and verification tests.
 * Run with: npm test
 */

const mockModel = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  // The service refreshes a stale `updatedAt` on plain reads so the model's 1h TTL
  // cannot delete a code out from under a running lecture — see TTL_REFRESH_AFTER_MS.
  updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
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

    /**
     * The model TTL-deletes a code an hour after its last write. Reads used to not
     * count as writes, so a `none`-mode code — the default — was deleted one hour
     * into a two-hour lecture and silently replaced, and the code the lecturer had
     * already read out started being rejected. These pin the refresh-on-read that
     * stops that, including the throttle that keeps it from writing on every poll.
     */
    describe('TTL keep-alive on read', () => {
      const staleBy = (ms) => ({
        code: 'existing1', prevCode: null, generatedAt: Date.now() - ms, paused: false,
        updatedAt: new Date(Date.now() - ms),
      });

      it('refreshes updatedAt when a non-rotating code is going stale, without changing the code', async () => {
        mockModel.findOne.mockResolvedValue(staleBy(20 * 60 * 1000));
        const before = Date.now();
        const result = await manualCode.getOrRotateCode(
          makeSession({ manualCodeRotationMode: 'none' }),
        );

        expect(result.code).toBe('existing1');
        expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
        expect(mockModel.updateOne).toHaveBeenCalledTimes(1);
        const [filter, update, options] = mockModel.updateOne.mock.calls[0];
        expect(filter).toEqual({ session: 'session1' });
        expect(update.$set.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
        // Explicit stamp, not a side effect of writing some unrelated field.
        expect(options).toEqual({ timestamps: false });
      });

      it('leaves a recently-touched code alone, so polling does not write every time', async () => {
        mockModel.findOne.mockResolvedValue(staleBy(60 * 1000));
        await manualCode.getOrRotateCode(makeSession({ manualCodeRotationMode: 'none' }));
        expect(mockModel.updateOne).not.toHaveBeenCalled();
      });

      it('refreshes a paused interval code too — pausing takes the same early return', async () => {
        mockModel.findOne.mockResolvedValue({ ...staleBy(20 * 60 * 1000), paused: true });
        await manualCode.getOrRotateCode(
          makeSession({ manualCodeRotationMode: 'interval', manualCodeRotationSeconds: 60 }),
        );
        expect(mockModel.updateOne).toHaveBeenCalledTimes(1);
        expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
      });

      it('keeps a code alive across a two-hour lecture polled every 30s', async () => {
        const TTL_MS = 60 * 60 * 1000;
        const doc = staleBy(0);
        mockModel.findOne.mockImplementation(() => Promise.resolve(doc));
        mockModel.updateOne.mockImplementation((_f, update) => {
          Object.assign(doc, update.$set);
          return Promise.resolve({ matchedCount: 1 });
        });

        const session = makeSession({ manualCodeRotationMode: 'none' });
        const start = Date.now();
        const realNow = Date.now;
        try {
          // 240 polls at 30s covers 2h; assert the TTL never comes due in between.
          for (let i = 1; i <= 240; i++) {
            const t = start + i * 30 * 1000;
            Date.now = () => t;
            expect(t - doc.updatedAt.getTime()).toBeLessThan(TTL_MS);
            const state = await manualCode.getOrRotateCode(session);
            expect(state.code).toBe('existing1');
          }
        } finally {
          Date.now = realNow;
        }
        // ~4 writes an hour, not one per poll.
        expect(mockModel.updateOne.mock.calls.length).toBeLessThanOrEqual(10);
        expect(mockModel.updateOne.mock.calls.length).toBeGreaterThanOrEqual(6);
      });
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
