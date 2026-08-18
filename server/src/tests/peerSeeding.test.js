const mockCountLiveSeeders = jest.fn();
const mockMintSeedToken = jest.fn();
jest.mock('../services/bluetoothCode.service', () => ({
  countLiveSeeders: (...args) => mockCountLiveSeeders(...args),
  mintSeedToken: (...args) => mockMintSeedToken(...args),
}));

const mockGetSettings = jest.fn();
jest.mock('../services/settings.service', () => ({
  getSettings: (...args) => mockGetSettings(...args),
}));

const peerSeeding = require('../services/peerSeeding.service');

function session(overrides = {}) {
  return { _id: 'session1', verification: 'bluetooth', ...overrides };
}

describe('peerSeeding.selectSeedingRole', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns role "none" for geofence-only sessions (decision 4)', async () => {
    mockGetSettings.mockResolvedValue({ seedRate: 5, seedWindowMs: 60000 });
    const result = await peerSeeding.selectSeedingRole(session({ verification: 'geofence' }), 'student1', true);
    expect(result).toEqual({ role: 'none' });
    expect(mockCountLiveSeeders).not.toHaveBeenCalled();
  });

  it('returns role "none" when seeding is globally disabled (seedRate 0)', async () => {
    mockGetSettings.mockResolvedValue({ seedRate: 0, seedWindowMs: 60000 });
    const result = await peerSeeding.selectSeedingRole(session(), 'student1', true);
    expect(result).toEqual({ role: 'none' });
  });

  it('returns role "decoy" for a device that cannot advertise', async () => {
    mockGetSettings.mockResolvedValue({ seedRate: 3, seedWindowMs: 45000 });
    const result = await peerSeeding.selectSeedingRole(session(), 'student1', false);
    expect(result).toEqual({ role: 'decoy', durationMs: 45000 });
    expect(mockMintSeedToken).not.toHaveBeenCalled();
  });

  it('returns role "decoy" once the seeder pool is already at target capacity', async () => {
    mockGetSettings.mockResolvedValue({ seedRate: 2, seedWindowMs: 60000 });
    mockCountLiveSeeders.mockResolvedValue(2);
    const result = await peerSeeding.selectSeedingRole(session(), 'student1', true);
    expect(result).toEqual({ role: 'decoy', durationMs: 60000 });
    expect(mockMintSeedToken).not.toHaveBeenCalled();
  });

  it('mints a seeder token and returns role "seed" when under target capacity', async () => {
    mockGetSettings.mockResolvedValue({ seedRate: 3, seedWindowMs: 60000 });
    mockCountLiveSeeders.mockResolvedValue(1);
    mockMintSeedToken.mockResolvedValue({ token: 'abc123', leaseUntil: 999 });
    const result = await peerSeeding.selectSeedingRole(session(), 'student1', true);
    expect(result.role).toBe('seed');
    expect(result.token).toBe('abc123');
    expect(result.durationMs).toBe(60000);
    expect(mockMintSeedToken).toHaveBeenCalledWith('session1', 'student1', expect.any(Number));
  });

  it('decoy and seed durations are identical for the same settings (decision 3)', async () => {
    mockGetSettings.mockResolvedValue({ seedRate: 1, seedWindowMs: 45000 });
    mockCountLiveSeeders.mockResolvedValue(0);
    mockMintSeedToken.mockResolvedValue({ token: 'xyz', leaseUntil: 999 });
    const seeder = await peerSeeding.selectSeedingRole(session(), 'student1', true);

    mockCountLiveSeeders.mockResolvedValue(1); // now at capacity
    const decoy = await peerSeeding.selectSeedingRole(session(), 'student2', true);

    expect(seeder.durationMs).toBe(decoy.durationMs);
  });
});
