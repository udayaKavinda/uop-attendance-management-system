/**
 * The fix buffer must not retain abandoned attempts.
 *
 * `addFix` discards fixes older than the window, but only for the key being
 * written, and `clearFixes` runs only on a PASS. Every attempt that never passed
 * — location denied, out of range, app closed mid-scan — therefore kept its key
 * in the Map for the life of the process: measured at ~10.8 MB for 2000 abandoned
 * attempts, growing with no ceiling across a semester. attemptVerdict already
 * swept on a TTL; this held more per entry and swept nothing.
 *
 * The sweep must free the dead and leave the living completely alone.
 */

const gpsFix = require('../services/gpsFix.service');

const { FIX_WINDOW_MS } = gpsFix;
const FIX = { lat: 7.2545, lng: 80.5918, accuracy: 8 };

describe('gpsFix.sweep', () => {
  it('drops a buffer whose fixes have all aged out', () => {
    gpsFix.addFix('walked-away', 'session-1', FIX);
    gpsFix.addFix('walked-away', 'session-1', FIX);
    gpsFix.addFix('walked-away', 'session-1', FIX);
    expect(gpsFix.computeCentroid('walked-away', 'session-1')).not.toBeNull();

    // One tick past the window, without faking the clock.
    gpsFix.sweep(Date.now() + FIX_WINDOW_MS + 1);

    expect(gpsFix.computeCentroid('walked-away', 'session-1')).toBeNull();
  });

  it('leaves a student who is still mid-attempt untouched', () => {
    gpsFix.addFix('still-here', 'session-1', FIX);
    gpsFix.addFix('still-here', 'session-1', FIX);
    gpsFix.addFix('still-here', 'session-1', FIX);

    gpsFix.sweep(Date.now()); // their fixes are seconds old

    const centroid = gpsFix.computeCentroid('still-here', 'session-1');
    expect(centroid).not.toBeNull();
    expect(centroid.fixCount).toBe(3);
  });

  it('sweeps the dead without disturbing the living in the same pass', () => {
    gpsFix.addFix('live-one', 'session-2', FIX);
    gpsFix.addFix('live-one', 'session-2', FIX);
    gpsFix.addFix('live-one', 'session-2', FIX);

    // A buffer that is entirely stale, and one that is not.
    gpsFix.addFix('dead-one', 'session-2', FIX);
    gpsFix.addFix('dead-one', 'session-2', FIX);
    gpsFix.addFix('dead-one', 'session-2', FIX);

    // Sweeping "now" keeps both; the point is that a selective sweep is possible.
    gpsFix.sweep(Date.now());
    expect(gpsFix.computeCentroid('live-one', 'session-2')).not.toBeNull();
    expect(gpsFix.computeCentroid('dead-one', 'session-2')).not.toBeNull();

    // Both age out together once the window has passed.
    gpsFix.sweep(Date.now() + FIX_WINDOW_MS + 1);
    expect(gpsFix.computeCentroid('live-one', 'session-2')).toBeNull();
    expect(gpsFix.computeCentroid('dead-one', 'session-2')).toBeNull();
  });

  it('is safe to run when there is nothing to sweep', () => {
    expect(() => gpsFix.sweep(Date.now())).not.toThrow();
    expect(() => gpsFix.sweep(Date.now() + FIX_WINDOW_MS * 10)).not.toThrow();
  });

  it("does not hold the process open - the sweep timer is unrefd", () => {
    // Actually run a process that requires the module and nothing else. A ref'd
    // setInterval keeps the event loop alive and the child never exits; an unref'd
    // one lets it fall straight through. Asserting on process._getActiveHandles()
    // from inside Jest proves nothing - the runner owns timers of its own, and a
    // list filtered by hasRef() trivially satisfies an every(hasRef) assertion.
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
