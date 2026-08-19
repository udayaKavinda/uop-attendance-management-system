/**
 * Remembers the last GPS band a student's automatic attempt reached, so that a
 * later "get help" code submission can be judged against it.
 *
 * This cannot read the raw fix buffer instead: that buffer drops anything older
 * than the 90s window, and by the time a student reads the failure screen, asks
 * the lecturer and types 8 digits, their fixes are long gone. The verdict has to
 * outlive them.
 *
 * In-memory, single-process — same caveat as the OAuth exchange-code store, the
 * sign-in nonce store, and the GPS fix buffer itself.
 */

const VERDICT_TTL_MS = 10 * 60 * 1000;

const store = new Map(); // key -> { band, centroid, distanceM, ts }

function key(studentId, sessionId) {
  return `${studentId}:${sessionId}`;
}

/** Overwrites with the latest verdict — the newest evidence is the truthful one. */
function record(studentId, sessionId, { band, centroid = null, distanceM = null }) {
  store.set(key(studentId, sessionId), {
    band, centroid, distanceM, ts: Date.now(),
  });
}

/**
 * Returns the stored verdict, or null when there is none — which happens when
 * the student never produced a usable fix at all (location denied, no provider,
 * indoors with no lock). Callers must treat null as `unknown`, not as a pass.
 */
function get(studentId, sessionId, now = Date.now()) {
  const rec = store.get(key(studentId, sessionId));
  if (!rec) return null;
  if (now - rec.ts > VERDICT_TTL_MS) {
    store.delete(key(studentId, sessionId));
    return null;
  }
  return rec;
}

function clear(studentId, sessionId) {
  store.delete(key(studentId, sessionId));
}

function sweep(now = Date.now()) {
  for (const [k, rec] of store) {
    if (now - rec.ts > VERDICT_TTL_MS) store.delete(k);
  }
}

const timer = setInterval(() => sweep(), VERDICT_TTL_MS);
if (typeof timer.unref === 'function') timer.unref();

module.exports = {
  VERDICT_TTL_MS, record, get, clear, sweep,
};
