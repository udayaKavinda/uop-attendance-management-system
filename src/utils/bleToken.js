// BLE token transport helpers.
//
// The native Android APK broadcaster packs the rotating 16-hex-char session token
// into a 128-bit service UUID with a fixed "UOPA" namespace prefix. Chrome on this
// branch listens for those advertised service UUIDs only (not manufacturer data).

// ASCII "UOPA" → identifies one of our attendance beacons.
export const UOP_BLE_UUID_PREFIX = '554f5041';

// Server tokens are 8 random bytes rendered as lowercase hex (see server/lib/bluetoothCode.js).
const TOKEN_HEX_LEN = 16;

function stripUuid(uuid) {
  return String(uuid || '').replace(/-/g, '').toLowerCase();
}

/**
 * Pack a 16-char hex token into a 128-bit service UUID.
 * Layout: 554f5041-TTTT-TTTT-TTTT-TTTT00000000
 */
export function tokenToServiceUuid(token) {
  const t = String(token || '').toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(t)) {
    throw new Error('BLE token must be 16 hex characters');
  }
  return [
    UOP_BLE_UUID_PREFIX,
    t.slice(0, 4),
    t.slice(4, 8),
    t.slice(8, 12),
    `${t.slice(12, 16)}00000000`,
  ].join('-');
}

/** Pull the token back out of a single UUID, or null if it is not one of ours. */
export function serviceUuidToToken(uuid) {
  const hex = stripUuid(uuid);
  if (hex.length !== 32 || !hex.startsWith(UOP_BLE_UUID_PREFIX)) return null;
  const token = hex.slice(8, 8 + TOKEN_HEX_LEN);
  return /^[0-9a-f]{16}$/.test(token) ? token : null;
}

/** Find the first UOP attendance token across a list of advertised service UUIDs. */
export function extractTokenFromUuids(uuids) {
  if (!Array.isArray(uuids)) return null;
  for (const uuid of uuids) {
    const token = serviceUuidToToken(uuid);
    if (token) return token;
  }
  return null;
}
