/**
 * BLE token generation and verification tests
 * Run with: npm run test:server
 */

const mockDoc = { token: null, prevToken: null, generatedAt: 0 };
const mockModel = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  deleteOne: jest.fn(),
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

  describe('getToken', () => {
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

  describe('verifyToken', () => {
    it('returns true for current token', async () => {
      mockModel.findOne.mockResolvedValue({
        token: 'validtoken12345', prevToken: null, generatedAt: Date.now(),
      });
      expect(await bluetoothCode.verifyToken('session1', 'validtoken12345')).toBe(true);
    });

    it('returns false for wrong token', async () => {
      mockModel.findOne.mockResolvedValue({
        token: 'validtoken12345', prevToken: null, generatedAt: Date.now(),
      });
      expect(await bluetoothCode.verifyToken('session1', 'wrongtoken12345')).toBe(false);
    });

    it('returns false when no token exists for session', async () => {
      mockModel.findOne.mockResolvedValue(null);
      expect(await bluetoothCode.verifyToken('session1', 'sometoken12345')).toBe(false);
    });

    it('accepts previous token within grace window', async () => {
      mockModel.findOne.mockResolvedValue({
        token: 'newtoken123456789', prevToken: 'oldtoken123456789',
        generatedAt: Date.now() - 1000,
      });
      expect(await bluetoothCode.verifyToken('session1', 'oldtoken123456789')).toBe(true);
    });

    it('rejects previous token after grace window', async () => {
      mockModel.findOne.mockResolvedValue({
        token: 'newtoken123456789', prevToken: 'oldtoken123456789',
        generatedAt: Date.now() - (GRACE_MS + 1000),
      });
      expect(await bluetoothCode.verifyToken('session1', 'oldtoken123456789')).toBe(false);
    });

    it('is case-insensitive', async () => {
      mockModel.findOne.mockResolvedValue({
        token: 'abcdef1234567890', prevToken: null, generatedAt: Date.now(),
      });
      expect(await bluetoothCode.verifyToken('session1', 'ABCDEF1234567890')).toBe(true);
    });

    it('returns false for empty submission', async () => {
      mockModel.findOne.mockResolvedValue({ token: 'valid', prevToken: null, generatedAt: Date.now() });
      expect(await bluetoothCode.verifyToken('session1', '')).toBe(false);
    });
  });

  describe('removeToken', () => {
    it('deletes the token document', async () => {
      mockModel.deleteOne.mockResolvedValue({ deletedCount: 1 });
      await bluetoothCode.removeToken('session1');
      expect(mockModel.deleteOne).toHaveBeenCalledWith({ sessionId: 'session1' });
    });

    it('does nothing for empty sessionId', async () => {
      await bluetoothCode.removeToken('');
      expect(mockModel.deleteOne).not.toHaveBeenCalled();
    });
  });
});
