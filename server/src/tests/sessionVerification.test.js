const mockGetSettings = jest.fn();
jest.mock('../services/settings.service', () => ({
  getSettings: (...args) => mockGetSettings(...args),
  isVerificationAllowed: jest.requireActual('../services/settings.service').isVerificationAllowed,
}));

const mongoose = require('mongoose');
const {
  validateSessionCreateBody, checkVerificationAllowed, VERIFICATION_MODES,
} = require('../validators/session.validator');

function validId() {
  return new mongoose.Types.ObjectId().toHexString();
}

describe('validateSessionCreateBody — verification/buildings', () => {
  const base = {
    lectureDay: 'MON', startTime: '08:00', endTime: '10:00', recurring: true,
  };

  it('defaults verification to "bluetooth" and buildings to [] when omitted', () => {
    const result = validateSessionCreateBody(base);
    expect(result.ok).toBe(true);
    expect(result.verification).toBe('bluetooth');
    expect(result.buildings).toEqual([]);
  });

  it('rejects an unrecognized verification value', () => {
    const result = validateSessionCreateBody({ ...base, verification: 'lasers' });
    expect(result.ok).toBe(false);
  });

  it('requires at least one building when verification is "geofence"', () => {
    const result = validateSessionCreateBody({ ...base, verification: 'geofence' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/building/i);
  });

  it('requires at least one building when verification is "both"', () => {
    const result = validateSessionCreateBody({ ...base, verification: 'both', buildings: [] });
    expect(result.ok).toBe(false);
  });

  it('accepts "geofence" with a valid building id', () => {
    const id = validId();
    const result = validateSessionCreateBody({ ...base, verification: 'geofence', buildings: [id] });
    expect(result.ok).toBe(true);
    expect(result.buildings).toEqual([id]);
  });

  it('rejects a malformed building id', () => {
    const result = validateSessionCreateBody({ ...base, verification: 'geofence', buildings: ['not-an-id'] });
    expect(result.ok).toBe(false);
  });

  it('does not require buildings for plain "bluetooth"', () => {
    const result = validateSessionCreateBody({ ...base, verification: 'bluetooth' });
    expect(result.ok).toBe(true);
    expect(result.buildings).toEqual([]);
  });

  it('strictly rejects malformed or out-of-range HH:mm values', () => {
    expect(validateSessionCreateBody({ ...base, startTime: '8:00' }).ok).toBe(false);
    expect(validateSessionCreateBody({ ...base, startTime: '25:00' }).ok).toBe(false);
    expect(validateSessionCreateBody({ ...base, endTime: '10:99' }).ok).toBe(false);
  });

  it('validates and returns atomic manual-code creation settings', () => {
    const result = validateSessionCreateBody({
      ...base,
      manualCodeEnabled: true,
      manualCodeRotationMode: 'interval',
      manualCodeRotationSeconds: 30,
    });
    expect(result).toMatchObject({
      ok: true,
      manualCodeEnabled: true,
      manualCodeRotationMode: 'interval',
      manualCodeRotationSeconds: 30,
    });
  });
});

describe('checkVerificationAllowed — per-policy admin switches', () => {
  it('permits every mode when the admin enabled both policies', async () => {
    mockGetSettings.mockResolvedValue({ bluetoothAllowed: true, geofenceAllowed: true });
    expect((await checkVerificationAllowed('bluetooth')).ok).toBe(true);
    expect((await checkVerificationAllowed('geofence')).ok).toBe(true);
    expect((await checkVerificationAllowed('both')).ok).toBe(true);
  });

  it('rejects geofence and both when only Bluetooth is enabled', async () => {
    mockGetSettings.mockResolvedValue({ bluetoothAllowed: true, geofenceAllowed: false });
    expect((await checkVerificationAllowed('bluetooth')).ok).toBe(true);
    expect((await checkVerificationAllowed('geofence')).ok).toBe(false);
    expect((await checkVerificationAllowed('both')).ok).toBe(false);
  });

  it('rejects bluetooth and both when only geofence is enabled', async () => {
    mockGetSettings.mockResolvedValue({ bluetoothAllowed: false, geofenceAllowed: true });
    expect((await checkVerificationAllowed('bluetooth')).ok).toBe(false);
    expect((await checkVerificationAllowed('geofence')).ok).toBe(true);
    expect((await checkVerificationAllowed('both')).ok).toBe(false);
  });

  it('rejects everything when the admin disabled both policies', async () => {
    mockGetSettings.mockResolvedValue({ bluetoothAllowed: false, geofenceAllowed: false });
    expect((await checkVerificationAllowed('bluetooth')).ok).toBe(false);
    expect((await checkVerificationAllowed('geofence')).ok).toBe(false);
    expect((await checkVerificationAllowed('both')).ok).toBe(false);
  });
});

test('VERIFICATION_MODES matches the three documented modes', () => {
  expect(VERIFICATION_MODES).toEqual(['bluetooth', 'geofence', 'both']);
});
