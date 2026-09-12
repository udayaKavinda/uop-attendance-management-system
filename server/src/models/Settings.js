const mongoose = require('mongoose');

/**
 * Singleton document (exactly one row, found via findOne({}) — no fixed id needed).
 * Global toggles that apply instantly across every session, unlike per-session config.
 */
const settingsSchema = new mongoose.Schema({
  /**
   * Global Bluetooth kill switch. Off stops lecturer broadcasts, stops student BLE
   * scanning, and disables peer seeding — leaving the GPS geofence as the only
   * automatic path. GPS itself has no kill switch: every session depends on it.
   */
  bleEnabled: { type: Boolean, default: true },

  /**
   * Whether the browser client at /app serves non-iOS devices.
   *
   * Off by default: Android has the native app, which verifies over Bluetooth as
   * well as GPS, so routing Android users to a GPS-only browser build is a
   * downgrade. This exists as an operational escape hatch — if the Android app
   * is broken or unavailable, an admin can open the web client to everyone
   * without a release.
   *
   * It is a UX gate, not a security control: the client decides by reading its
   * own user agent, which anyone can spoof. It changes what ordinary users
   * experience, not what is possible — and it does not need to do more, because
   * the web client only uses the GPS and lecturer-code paths the native app
   * already exposes.
   */
  webAllowNonIos: { type: Boolean, default: false },

  /**
   * Distance bands, in meters from the nearest active building polygon of the
   * session. `near` and `suspicious` both auto-pass; beyond `far` (or when no
   * usable GPS fix exists at all) a student is flagged instead — see
   * `geofenceLogic.service.js` for what "within a buffer" means for each band.
   */
  nearBufferM: { type: Number, default: 50, min: 0 },
  farBufferM: { type: Number, default: 100, min: 0 },

  /**
   * Which strategy decides "is this student within the near/far buffer",
   * independently selectable per band. See `geofenceLogic.service.js`'s
   * `STRATEGIES` for the full list and what each one means.
   */
  nearBufferLogic: { type: String, default: 'accuracy_weighted_centroid' },
  farBufferLogic: { type: String, default: 'accuracy_weighted_centroid' },

  /**
   * How many live GPS fixes each strategy needs before it may decide, keyed by
   * strategy id. Sparse on purpose: a strategy absent from this map uses its own
   * `defaultMinFixes`, so shipping a new strategy does not require a migration
   * and an admin only stores the ones they actually changed.
   *
   * Keyed by strategy rather than by band because the number is a property of
   * how the strategy reads its sample, not of which buffer it is checking — and
   * near and far pick strategies independently, so a per-band field would have
   * to be set twice to say one thing. Bounds (`floorMinFixes`, `MAX_MIN_FIXES`)
   * live with the strategies in `services/geofenceLogic.service.js`; the write
   * path rejects out-of-range values and the read path clamps, so stored data
   * that predates a bounds change still resolves.
   */
  minFixesByStrategy: { type: Map, of: Number, default: undefined },

  /** Target concurrent BLE seeder count. 0 disables peer seeding entirely. */
  seedRate: { type: Number, default: 0, min: 0 },
  /** Real seeder AND decoy window duration, ms — identical for both so neither is distinguishable. */
  seedWindowMs: { type: Number, default: 60_000, min: 10_000 },

  /**
   * Email domain new self-registering students must match (case-insensitive
   * suffix on the part after '@'). Empty string disables the restriction.
   * Lecturers/admins are provisioned by an admin and are never subject to this.
   */
  studentEmailDomain: { type: String, default: 'eng.pdn.ac.lk', trim: true, lowercase: true },

  /**
   * Android `versionCode` an installed app must meet or exceed. 0 disables the
   * check. Bumped by an admin after publishing a release that must not be skipped.
   */
  minSupportedVersionCode: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
