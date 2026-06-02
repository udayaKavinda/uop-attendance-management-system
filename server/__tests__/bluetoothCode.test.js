'use strict';

const ROTATION_MS = 15000;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
});

afterEach(() => {
  jest.useRealTimers();
});

function loadFresh() {
  return require('../lib/bluetoothCode');
}

describe('generateDeviceName', () => {
  test('returns UOP- prefix with 8 hex chars', () => {
    const { generateDeviceName } = loadFresh();
    const name = generateDeviceName();
    expect(name).toMatch(/^UOP-[0-9A-F]{8}$/);
  });

  test('returns a different name each call', () => {
    const { generateDeviceName } = loadFresh();
    const names = new Set(Array.from({ length: 10 }, () => generateDeviceName()));
    expect(names.size).toBeGreaterThan(1);
  });
});

describe('getToken', () => {
  test('throws when sessionId is empty', () => {
    const { getToken } = loadFresh();
    expect(() => getToken('')).toThrow('sessionId required');
    expect(() => getToken(null)).toThrow('sessionId required');
  });

  test('returns a 16-char hex token and rotatesIn within ROTATION_MS/1000', () => {
    const { getToken } = loadFresh();
    const { token, rotatesIn } = getToken('session-1');
    expect(token).toMatch(/^[0-9a-f]{16}$/);
    expect(rotatesIn).toBeGreaterThan(0);
    expect(rotatesIn).toBeLessThanOrEqual(ROTATION_MS / 1000);
  });

  test('returns the same token when called again within the window', () => {
    const { getToken } = loadFresh();
    const { token: t1 } = getToken('session-2');
    jest.advanceTimersByTime(ROTATION_MS - 1000);
    const { token: t2 } = getToken('session-2');
    expect(t2).toBe(t1);
  });

  test('lazy-rotates the token when called after ROTATION_MS', () => {
    const { getToken } = loadFresh();
    const { token: t1 } = getToken('session-3');
    jest.advanceTimersByTime(ROTATION_MS + 1);
    const { token: t2 } = getToken('session-3');
    expect(t2).not.toBe(t1);
    expect(t2).toMatch(/^[0-9a-f]{16}$/);
  });

  test('rotatesIn decreases as time passes', () => {
    const { getToken } = loadFresh();
    getToken('session-4');
    jest.advanceTimersByTime(5000);
    const { rotatesIn } = getToken('session-4');
    expect(rotatesIn).toBeLessThanOrEqual(ROTATION_MS / 1000 - 5);
  });
});

describe('auto-rotation via setInterval', () => {
  test('background interval rotates token after ROTATION_MS', () => {
    const { getToken } = loadFresh();
    const { token: t1 } = getToken('session-auto');
    jest.advanceTimersByTime(ROTATION_MS + 1000);
    const { token: t2 } = getToken('session-auto');
    expect(t2).not.toBe(t1);
  });
});

describe('verifyToken', () => {
  test('returns true for the current token', () => {
    const { getToken, verifyToken } = loadFresh();
    const { token } = getToken('session-v1');
    expect(verifyToken('session-v1', token)).toBe(true);
  });

  test('returns false for an incorrect token', () => {
    const { getToken, verifyToken } = loadFresh();
    getToken('session-v2');
    expect(verifyToken('session-v2', 'deadbeefdeadbeef')).toBe(false);
  });

  test('returns false for unknown sessionId', () => {
    const { verifyToken } = loadFresh();
    expect(verifyToken('no-such-session', 'aabbccddaabbccdd')).toBe(false);
  });

  test('is case-insensitive', () => {
    const { getToken, verifyToken } = loadFresh();
    const { token } = getToken('session-v3');
    expect(verifyToken('session-v3', token.toUpperCase())).toBe(true);
  });

  test('returns false after token has been rotated', () => {
    const { getToken, verifyToken } = loadFresh();
    const { token: old } = getToken('session-v4');
    jest.advanceTimersByTime(ROTATION_MS + 1000);
    const { token: fresh } = getToken('session-v4');
    expect(verifyToken('session-v4', old)).toBe(false);
    expect(verifyToken('session-v4', fresh)).toBe(true);
  });
});

describe('removeToken', () => {
  test('removes the token so verifyToken returns false', () => {
    const { getToken, verifyToken, removeToken } = loadFresh();
    const { token } = getToken('session-r1');
    removeToken('session-r1');
    expect(verifyToken('session-r1', token)).toBe(false);
  });

  test('is a no-op for unknown sessionId', () => {
    const { removeToken } = loadFresh();
    expect(() => removeToken('ghost')).not.toThrow();
  });
});
