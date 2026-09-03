const mockClaimSeedSlot = jest.fn();
jest.mock('../services/bluetoothCode.service', () => ({
  claimSeedSlot: (...args) => mockClaimSeedSlot(...args),
}));

const mockGetSettings = jest.fn();
jest.mock('../services/settings.service', () => ({
  getSettings: (...args) => mockGetSettings(...args),
}));

const peerSeeding = require('../services/peerSeeding.service');

function session(overrides = {}) {
  return { _id: 'session1', ...overrides };
}

describe('peerSeeding.selectSeedingRole', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns role "none" for a student who passed by GPS rather than Bluetooth', async () => {
    mockGetSettings.mockResolvedValue({ bleEnabled: true, seedRate: 5, seedWindowMs: 60000 });
    const result = await peerSeeding.selectSeedingRole(session(), 'student1', true, null);
    expect(result).toEqual({ role: 'none' });
    expect(mockClaimSeedSlot).not.toHaveBeenCalled();
  });

  it('returns role "none" for a student who only heard another seeder, not the lecturer', async () => {
    mockGetSettings.mockResolvedValue({ bleEnabled: true, seedRate: 5, seedWindowMs: 60000 });
    const result = await peerSeeding.selectSeedingRole(session(), 'student1', true, 'seed');
    expect(result).toEqual({ role: 'none' });
    expect(mockClaimSeedSlot).not.toHaveBeenCalled();
  });

  it('returns role "none" when Bluetooth is globally killed', async () => {
    mockGetSettings.mockResolvedValue({ bleEnabled: false, seedRate: 5, seedWindowMs: 60000 });
    const result = await peerSeeding.selectSeedingRole(session(), 'student1', true, 'primary');
    expect(result).toEqual({ role: 'none' });
    expect(mockClaimSeedSlot).not.toHaveBeenCalled();
  });

  it('returns role "none" when seeding is globally disabled (seedRate 0)', async () => {
    mockGetSettings.mockResolvedValue({ bleEnabled: true, seedRate: 0, seedWindowMs: 60000 });
    const result = await peerSeeding.selectSeedingRole(session(), 'student1', true, 'primary');
    expect(result).toEqual({ role: 'none' });
  });

  it('returns role "decoy" for a device that cannot advertise', async () => {
    mockGetSettings.mockResolvedValue({ bleEnabled: true, seedRate: 3, seedWindowMs: 45000 });
    const result = await peerSeeding.selectSeedingRole(session(), 'student1', false, 'primary');
    expect(result).toEqual({ role: 'decoy', durationMs: 45000 });
    expect(mockClaimSeedSlot).not.toHaveBeenCalled();
  });

  it('returns role "decoy" once every seeder slot is already held', async () => {
    mockGetSettings.mockResolvedValue({ bleEnabled: true, seedRate: 2, seedWindowMs: 60000 });
    // null is claimSeedSlot's "the cap is full" answer - it is the only signal
    // here now, so the cap can no longer be read stale and then exceeded.
    mockClaimSeedSlot.mockResolvedValue(null);
    const result = await peerSeeding.selectSeedingRole(session(), 'student1', true, 'primary');
    expect(result).toEqual({ role: 'decoy', durationMs: 60000 });
  });

  it('returns role "seed" with the claimed token when a slot was free', async () => {
    mockGetSettings.mockResolvedValue({ bleEnabled: true, seedRate: 3, seedWindowMs: 60000 });
    mockClaimSeedSlot.mockResolvedValue({ token: 'abc123', leaseUntil: 999, slot: 1 });
    const result = await peerSeeding.selectSeedingRole(session(), 'student1', true, 'primary');
    expect(result.role).toBe('seed');
    expect(result.token).toBe('abc123');
    expect(result.durationMs).toBe(60000);
    expect(mockClaimSeedSlot).toHaveBeenCalledWith('session1', 'student1', expect.any(Number), 3);
  });

  it('passes seedRate through as the cap, so the claim can enforce it', async () => {
    mockGetSettings.mockResolvedValue({ bleEnabled: true, seedRate: 7, seedWindowMs: 60000 });
    mockClaimSeedSlot.mockResolvedValue({ token: 'tok', leaseUntil: 1, slot: 0 });
    await peerSeeding.selectSeedingRole(session(), 'student1', true, 'primary');
    expect(mockClaimSeedSlot.mock.calls[0][3]).toBe(7);
  });

  it('decoy and seed durations are identical for the same settings', async () => {
    mockGetSettings.mockResolvedValue({ bleEnabled: true, seedRate: 1, seedWindowMs: 45000 });
    mockClaimSeedSlot.mockResolvedValue({ token: 'xyz', leaseUntil: 999, slot: 0 });
    const seeder = await peerSeeding.selectSeedingRole(session(), 'student1', true, 'primary');

    mockClaimSeedSlot.mockResolvedValue(null); // now at capacity
    const decoy = await peerSeeding.selectSeedingRole(session(), 'student2', true, 'primary');

    expect(seeder.durationMs).toBe(decoy.durationMs);
  });
});
