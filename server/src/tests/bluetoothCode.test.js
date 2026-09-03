/**
 * BLE token generation and verification tests
 * Run with: npm run test:server
 */

const mockModel = {
  findOne: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  deleteOne: jest.fn(),
  deleteMany: jest.fn(),
  countDocuments: jest.fn(),
};
jest.mock('../models/BleToken', () => mockModel);

const bluetoothCode = require('../services/bluetoothCode.service');
const { ROTATION_MS, GRACE_MS } = bluetoothCode;

describe('bluetoothCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getToken (primary)', () => {
    it('creates a new token when none exists', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.findOneAndUpdate.mockResolvedValue({
        token: 'abc123de45678901', prevToken: null, generatedAt: Date.now(),
      });
      const result = await bluetoothCode.getToken('session1');
      expect(result.token).toHaveLength(16);
      expect(result.rotatesIn).toBeLessThanOrEqual(ROTATION_MS / 1000);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('queries the primary row specifically (owner: null, role: primary)', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.findOneAndUpdate.mockResolvedValue({ token: 'x'.repeat(16), prevToken: null, generatedAt: Date.now() });
      await bluetoothCode.getToken('session1');
      expect(mockModel.findOne).toHaveBeenCalledWith({ sessionId: 'session1', owner: null, role: 'primary' });
    });

    it('returns existing token if within rotation window', async () => {
      const generatedAt = Date.now() - 5000;
      mockModel.findOne.mockResolvedValue({ token: 'existingtoken12', prevToken: null, generatedAt });
      const result = await bluetoothCode.getToken('session1');
      expect(result.token).toBe('existingtoken12');
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rotates token when window expires', async () => {
      const generatedAt = Date.now() - ROTATION_MS - 1000;
      mockModel.findOne.mockResolvedValue({ token: 'oldtoken1234567', prevToken: null, generatedAt });
      mockModel.findOneAndUpdate.mockResolvedValue({
        token: 'newtoken1234567', prevToken: 'oldtoken1234567', generatedAt: Date.now(),
      });
      await bluetoothCode.getToken('session1');
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      const upsertCall = mockModel.findOneAndUpdate.mock.calls[0][1];
      expect(upsertCall.prevToken).toBe('oldtoken1234567');
    });

    it('throws if sessionId is empty', async () => {
      await expect(bluetoothCode.getToken('')).rejects.toThrow('sessionId required');
    });
  });

  describe('verifyToken (whole pool)', () => {
    it('accepts the primary token and reports the primary role', async () => {
      mockModel.find.mockResolvedValue([
        { token: 'validtoken12345', prevToken: null, generatedAt: Date.now() },
      ]);
      expect(await bluetoothCode.verifyToken('session1', 'validtoken12345'))
        .toEqual({ ok: true, role: 'primary' });
    });

    it('accepts a live seeder token and reports the seed role', async () => {
      mockModel.find.mockResolvedValue([
        { role: 'primary', token: 'primarytoken1234', prevToken: null, generatedAt: Date.now() },
        {
          role: 'seed', token: 'seedertoken1234', prevToken: null, generatedAt: Date.now(), leaseUntil: Date.now() + 60_000,
        },
      ]);
      expect(await bluetoothCode.verifyToken('session1', 'seedertoken1234'))
        .toEqual({ ok: true, role: 'seed' });
    });

    it('rejects an expired seeder token even before the cleanup sweep removes it', async () => {
      mockModel.find.mockResolvedValue([{
        role: 'seed',
        token: 'expiredseed1234',
        prevToken: null,
        generatedAt: Date.now() - 1000,
        leaseUntil: Date.now() - 1,
      }]);
      expect(await bluetoothCode.verifyToken('session1', 'expiredseed1234'))
        .toEqual({ ok: false, role: null });
    });

    it('prefers the primary role when the same value somehow lives in both pools', async () => {
      const token = 'sharedtoken1234';
      mockModel.find.mockResolvedValue([
        {
          role: 'seed', token, prevToken: null, generatedAt: Date.now(), leaseUntil: Date.now() + 60_000,
        },
        {
          role: 'primary', token, prevToken: null, generatedAt: Date.now(),
        },
      ]);
      expect(await bluetoothCode.verifyToken('session1', token))
        .toEqual({ ok: true, role: 'primary' });
    });

    it('rejects a wrong token', async () => {
      mockModel.find.mockResolvedValue([
        { token: 'validtoken12345', prevToken: null, generatedAt: Date.now() },
      ]);
      expect(await bluetoothCode.verifyToken('session1', 'wrongtoken12345'))
        .toEqual({ ok: false, role: null });
    });

    it('rejects when no tokens exist for the session', async () => {
      mockModel.find.mockResolvedValue([]);
      expect((await bluetoothCode.verifyToken('session1', 'sometoken12345')).ok).toBe(false);
    });

    it('accepts the previous token within the grace window', async () => {
      mockModel.find.mockResolvedValue([{
        token: 'newtoken123456789', prevToken: 'oldtoken123456789', generatedAt: Date.now() - 1000,
      }]);
      expect((await bluetoothCode.verifyToken('session1', 'oldtoken123456789')).ok).toBe(true);
    });

    it('rejects the previous token after the grace window', async () => {
      mockModel.find.mockResolvedValue([{
        token: 'newtoken123456789', prevToken: 'oldtoken123456789', generatedAt: Date.now() - (GRACE_MS + 1000),
      }]);
      expect((await bluetoothCode.verifyToken('session1', 'oldtoken123456789')).ok).toBe(false);
    });

    /**
     * Regression: rotation is lazy, so only the device whose poll triggers it gets
     * the new token — every other device broadcasting the same session (the "Join"
     * action) keeps advertising the old one until its own next ~5s poll. With the
     * old 2s grace that left a ~3s window per 15s cycle where a joined phone
     * advertised a token this service rejected (measured up to 20% of wall-clock
     * time). The grace must therefore cover a full broadcaster poll interval.
     */
    it('accepts the previous token for at least one full broadcaster poll interval', async () => {
      const BROADCASTER_POLL_MS = 5000;
      expect(GRACE_MS).toBeGreaterThan(BROADCASTER_POLL_MS);
      expect(GRACE_MS).toBeLessThan(ROTATION_MS);

      mockModel.find.mockResolvedValue([{
        token: 'newtoken123456789',
        prevToken: 'oldtoken123456789',
        generatedAt: Date.now() - BROADCASTER_POLL_MS,
      }]);
      expect((await bluetoothCode.verifyToken('session1', 'oldtoken123456789')).ok).toBe(true);
    });

    it('is case-insensitive', async () => {
      mockModel.find.mockResolvedValue([
        { token: 'abcdef1234567890', prevToken: null, generatedAt: Date.now() },
      ]);
      expect((await bluetoothCode.verifyToken('session1', 'ABCDEF1234567890')).ok).toBe(true);
    });

    it('rejects an empty submission', async () => {
      mockModel.find.mockResolvedValue([{ token: 'valid', prevToken: null, generatedAt: Date.now() }]);
      expect((await bluetoothCode.verifyToken('session1', '')).ok).toBe(false);
    });
  });

  describe('removeToken', () => {
    it('deletes every row for the session (primary + all seeders)', async () => {
      mockModel.deleteMany.mockResolvedValue({ deletedCount: 3 });
      await bluetoothCode.removeToken('session1');
      expect(mockModel.deleteMany).toHaveBeenCalledWith({ sessionId: 'session1' });
    });

    it('does nothing for empty sessionId', async () => {
      await bluetoothCode.removeToken('');
      expect(mockModel.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('seed tokens', () => {
    it('claimSeedSlot takes the first free slot and mints that seeder token', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.findOneAndUpdate.mockResolvedValue({ token: 'seed1234seed5678', leaseUntil: 12345 });
      const result = await bluetoothCode.claimSeedSlot('session1', 'student1', 12345, 3);
      expect(result.slot).toBe(0);
      expect(result.token).toHaveLength(16);
      const [filter, update] = mockModel.findOneAndUpdate.mock.calls[0];
      expect(filter.sessionId).toBe('session1');
      expect(filter.role).toBe('seed');
      expect(filter.slot).toBe(0);
      expect(update.$set.owner).toBe('student1');
      expect(update.$set.leaseUntil).toBe(12345);
    });

    it('claimSeedSlot moves to the next slot when it loses the race for one', async () => {
      mockModel.findOne.mockResolvedValue(null);
      const duplicate = Object.assign(new Error('E11000'), { code: 11000 });
      mockModel.findOneAndUpdate
        .mockRejectedValueOnce(duplicate)
        .mockRejectedValueOnce(duplicate)
        .mockResolvedValue({ token: 'c'.repeat(16), leaseUntil: 999 });
      const result = await bluetoothCode.claimSeedSlot('session1', 'student1', 999, 4);
      expect(result.slot).toBe(2);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledTimes(3);
    });

    it('claimSeedSlot returns null once every slot is held - this is the cap', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.findOneAndUpdate.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));
      const result = await bluetoothCode.claimSeedSlot('session1', 'student1', 999, 3);
      expect(result).toBeNull();
      // Exactly seedRate attempts - it never invents a slot beyond the cap.
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledTimes(3);
    });

    it('claimSeedSlot refreshes an existing holder instead of consuming a second slot', async () => {
      const existing = {
        token: 'old', prevToken: null, generatedAt: 0, leaseUntil: 1, slot: 2, save: jest.fn(),
      };
      mockModel.findOne.mockResolvedValue(existing);
      const result = await bluetoothCode.claimSeedSlot('session1', 'student1', 5555, 3);
      expect(result.slot).toBe(2);
      expect(existing.leaseUntil).toBe(5555);
      expect(existing.save).toHaveBeenCalled();
      expect(mockModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('claimSeedSlot mints nothing when seeding is disabled (seedRate 0)', async () => {
      expect(await bluetoothCode.claimSeedSlot('session1', 'student1', 1, 0)).toBeNull();
      expect(mockModel.findOne).not.toHaveBeenCalled();
    });

    it('getSeedToken returns null once the lease has expired', async () => {
      mockModel.findOne.mockResolvedValue({
        token: 'a'.repeat(16), prevToken: null, generatedAt: Date.now(), leaseUntil: Date.now() - 1000,
      });
      expect(await bluetoothCode.getSeedToken('session1', 'student1')).toBeNull();
    });

    it('getSeedToken rotates on the same cadence as the primary token', async () => {
      const generatedAt = Date.now() - ROTATION_MS - 1000;
      mockModel.findOne.mockResolvedValue({
        token: 'old1234old123456', prevToken: null, generatedAt, leaseUntil: Date.now() + 60_000,
      });
      mockModel.findOneAndUpdate.mockResolvedValue({
        token: 'new1234new123456', prevToken: 'old1234old123456', generatedAt: Date.now(), leaseUntil: Date.now() + 60_000,
      });
      const result = await bluetoothCode.getSeedToken('session1', 'student1');
      expect(result.token).toBe('new1234new123456');
    });

    it('removeSeedToken deletes only that student\'s row', async () => {
      mockModel.deleteOne.mockResolvedValue({ deletedCount: 1 });
      await bluetoothCode.removeSeedToken('session1', 'student1');
      expect(mockModel.deleteOne).toHaveBeenCalledWith({ sessionId: 'session1', owner: 'student1', role: 'seed' });
    });
  });
});
