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

  describe('generateDeviceName', () => {
    it('returns a string matching UOP-XXXXXXXX', () => {
      const name = bluetoothCode.generateDeviceName();
      expect(name).toMatch(/^UOP-[0-9A-F]{8}$/);
    });

    it('generates unique names', () => {
      const names = new Set(Array.from({ length: 20 }, () => bluetoothCode.generateDeviceName()));
      expect(names.size).toBe(20);
    });
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
    it('returns true for the primary token', async () => {
      mockModel.find.mockResolvedValue([
        { token: 'validtoken12345', prevToken: null, generatedAt: Date.now() },
      ]);
      expect(await bluetoothCode.verifyToken('session1', 'validtoken12345')).toBe(true);
    });

    it('returns true for a live seeder token even when it does not match the primary', async () => {
      mockModel.find.mockResolvedValue([
        { token: 'primarytoken1234', prevToken: null, generatedAt: Date.now() },
        { token: 'seedertoken1234', prevToken: null, generatedAt: Date.now() },
      ]);
      expect(await bluetoothCode.verifyToken('session1', 'seedertoken1234')).toBe(true);
    });

    it('rejects an expired seeder token even before the cleanup sweep removes it', async () => {
      mockModel.find.mockResolvedValue([{
        role: 'seed',
        token: 'expiredseed1234',
        prevToken: null,
        generatedAt: Date.now() - 1000,
        leaseUntil: Date.now() - 1,
      }]);
      expect(await bluetoothCode.verifyToken('session1', 'expiredseed1234')).toBe(false);
    });

    it('returns false for wrong token', async () => {
      mockModel.find.mockResolvedValue([
        { token: 'validtoken12345', prevToken: null, generatedAt: Date.now() },
      ]);
      expect(await bluetoothCode.verifyToken('session1', 'wrongtoken12345')).toBe(false);
    });

    it('returns false when no tokens exist for session', async () => {
      mockModel.find.mockResolvedValue([]);
      expect(await bluetoothCode.verifyToken('session1', 'sometoken12345')).toBe(false);
    });

    it('accepts previous token within grace window', async () => {
      mockModel.find.mockResolvedValue([{
        token: 'newtoken123456789', prevToken: 'oldtoken123456789', generatedAt: Date.now() - 1000,
      }]);
      expect(await bluetoothCode.verifyToken('session1', 'oldtoken123456789')).toBe(true);
    });

    it('rejects previous token after grace window', async () => {
      mockModel.find.mockResolvedValue([{
        token: 'newtoken123456789', prevToken: 'oldtoken123456789', generatedAt: Date.now() - (GRACE_MS + 1000),
      }]);
      expect(await bluetoothCode.verifyToken('session1', 'oldtoken123456789')).toBe(false);
    });

    it('is case-insensitive', async () => {
      mockModel.find.mockResolvedValue([
        { token: 'abcdef1234567890', prevToken: null, generatedAt: Date.now() },
      ]);
      expect(await bluetoothCode.verifyToken('session1', 'ABCDEF1234567890')).toBe(true);
    });

    it('returns false for empty submission', async () => {
      mockModel.find.mockResolvedValue([{ token: 'valid', prevToken: null, generatedAt: Date.now() }]);
      expect(await bluetoothCode.verifyToken('session1', '')).toBe(false);
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
    it('mintSeedToken creates a row scoped to (sessionId, owner, role: seed)', async () => {
      mockModel.findOneAndUpdate.mockResolvedValue({ token: 'seed1234seed5678', leaseUntil: 12345 });
      const result = await bluetoothCode.mintSeedToken('session1', 'student1', 12345);
      expect(result.token).toHaveLength(16);
      const [filter, update] = mockModel.findOneAndUpdate.mock.calls[0];
      expect(filter).toEqual({ sessionId: 'session1', owner: 'student1', role: 'seed' });
      expect(update.leaseUntil).toBe(12345);
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

    it('countLiveSeeders counts only non-expired seed rows', async () => {
      mockModel.countDocuments.mockResolvedValue(2);
      const count = await bluetoothCode.countLiveSeeders('session1');
      expect(count).toBe(2);
      const filter = mockModel.countDocuments.mock.calls[0][0];
      expect(filter.role).toBe('seed');
    });
  });
});
