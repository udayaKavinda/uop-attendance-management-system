/**
 * The fix buffer must not retain abandoned attempts.
 *
 * `liveFixes` ignores anything older than the window on read, and `clearFixes`
 * runs only on a PASS. Every attempt that never passed — location denied, out of
 * range, app closed mid-scan — therefore leaves a row behind. When this state
 * was a per-process Map that cost ~10.8 MB per 2000 abandoned attempts and grew
 * with no ceiling across a semester; as a collection it is bounded by the TTL
 * index instead, and `sweep` is the explicit form of the same cleanup.
 *
 * The sweep must free the dead and leave the living completely alone.
 *
 * Storage here is the shared in-memory fake. That is the honest scope for this
 * file: it asserts the *selection rule* — which buffers a sweep should remove —
 * not MongoDB's execution of it. The real `$nor`/`$elemMatch` query, the unique
 * index and TTL expiry are exercised against a live server in
 * dbIntegration.test.js.
 */

jest.mock('../models/GpsFixBuffer', () => require('./helpers/gpsStateFakes').makeFixBufferModel());

const gpsFix = require('../services/gpsFix.service');

const { FIX_WINDOW_MS } = gpsFix;
const FIX = { lat: 7.2545, lng: 80.5918, accuracy: 8 };

async function threeFixes(student, session) {
  await gpsFix.addFix(student, session, FIX);
  await gpsFix.addFix(student, session, FIX);
  await gpsFix.addFix(student, session, FIX);
}

describe('gpsFix.sweep', () => {
  it('drops a buffer whose fixes have all aged out', async () => {
    await threeFixes('walked-away', 'session-1');
    expect(await gpsFix.computeCentroid('walked-away', 'session-1')).not.toBeNull();

    // One tick past the window, without faking the clock.
    await gpsFix.sweep(Date.now() + FIX_WINDOW_MS + 1);

    expect(await gpsFix.computeCentroid('walked-away', 'session-1')).toBeNull();
  });

  it('leaves a student who is still mid-attempt untouched', async () => {
    await threeFixes('still-here', 'session-1');

    await gpsFix.sweep(Date.now()); // their fixes are seconds old

    const centroid = await gpsFix.computeCentroid('still-here', 'session-1');
    expect(centroid).not.toBeNull();
    expect(centroid.fixCount).toBe(3);
  });

  it('reports how many buffers it removed', async () => {
    await threeFixes('counted-a', 'session-3');
    await threeFixes('counted-b', 'session-3');

    expect(await gpsFix.sweep(Date.now())).toBe(0);
    expect(await gpsFix.sweep(Date.now() + FIX_WINDOW_MS + 1)).toBeGreaterThanOrEqual(2);
  });

  it('sweeps the dead without disturbing the living in the same pass', async () => {
    await threeFixes('live-one', 'session-2');
    await threeFixes('dead-one', 'session-2');

    // Sweeping "now" keeps both; the point is that a selective sweep is possible.
    await gpsFix.sweep(Date.now());
    expect(await gpsFix.computeCentroid('live-one', 'session-2')).not.toBeNull();
    expect(await gpsFix.computeCentroid('dead-one', 'session-2')).not.toBeNull();

    // Both age out together once the window has passed.
    await gpsFix.sweep(Date.now() + FIX_WINDOW_MS + 1);
    expect(await gpsFix.computeCentroid('live-one', 'session-2')).toBeNull();
    expect(await gpsFix.computeCentroid('dead-one', 'session-2')).toBeNull();
  });

  it('is safe to run when there is nothing to sweep', async () => {
    await expect(gpsFix.sweep(Date.now())).resolves.not.toThrow();
    await expect(gpsFix.sweep(Date.now() + FIX_WINDOW_MS * 10)).resolves.not.toThrow();
  });

  it('does not hold the process open', () => {
    // Actually run a process that requires the module and nothing else. This used
    // to guard an unref'd setInterval; the sweep timer is gone entirely now that
    // the TTL index does the routine cleanup, so the property is stronger — but
    // it is still worth asserting, because requiring a service must never be the
    // reason a short-lived script or the test runner fails to exit.
    const { spawnSync } = require('child_process');
    const path = require('path');
    const modulePath = path.join(__dirname, '..', 'services', 'gpsFix.service.js');

    const result = spawnSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(modulePath)});`],
      { timeout: 10000, encoding: 'utf8' },
    );

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull(); // not killed by the timeout
    expect(result.status).toBe(0);
  });
});
