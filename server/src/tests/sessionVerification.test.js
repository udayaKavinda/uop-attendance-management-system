const mockGetSettings = jest.fn();
jest.mock('../services/settings.service', () => ({
  getSettings: (...args) => mockGetSettings(...args),
  isVerificationAllowed: (allowedModes, verification) => {
    if (allowedModes === 'both') return true;
    return allowedModes === verification;
  },
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
});

describe('checkVerificationAllowed', () => {
  it('permits any mode when allowedModes is "both"', async () => {
    mockGetSettings.mockResolvedValue({ allowedModes: 'both' });
    expect((await checkVerificationAllowed('geofence')).ok).toBe(true);
    expect((await checkVerificationAllowed('bluetooth')).ok).toBe(true);
  });

  it('rejects geofence/both sessions when the server is locked to "bluetooth"', async () => {
    mockGetSettings.mockResolvedValue({ allowedModes: 'bluetooth' });
    expect((await checkVerificationAllowed('geofence')).ok).toBe(false);
    expect((await checkVerificationAllowed('both')).ok).toBe(false);
    expect((await checkVerificationAllowed('bluetooth')).ok).toBe(true);
  });

  it('rejects bluetooth/both sessions when the server is locked to "geofence"', async () => {
    mockGetSettings.mockResolvedValue({ allowedModes: 'geofence' });
    expect((await checkVerificationAllowed('bluetooth')).ok).toBe(false);
    expect((await checkVerificationAllowed('geofence')).ok).toBe(true);
  });
});

test('VERIFICATION_MODES matches the three documented modes', () => {
  expect(VERIFICATION_MODES).toEqual(['bluetooth', 'geofence', 'both']);
});
