const mongoose = require('mongoose');

/**
 * Append-only record of every staff/admin mutation and every rejected
 * authentication or authorization attempt.
 *
 * Attendance is an academic-integrity record, so "who deleted that session?" or
 * "who changed the geofence buffers before the exam?" has to be answerable
 * months later. Nothing else in the system could answer it: process logs cover
 * lifecycle events only.
 *
 * Deliberately its own collection rather than a log file — it has to survive
 * redeploys and be queryable by actor and target, and it is small: a semester of
 * staff activity is a few thousand rows.
 */
const auditLogSchema = new mongoose.Schema({
  /** Person who acted, or null for an unauthenticated attempt. */
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
  /** Denormalised so the entry stays readable after the Person is deleted. */
  actorEmail: { type: String, default: null },
  actorRole: { type: String, default: null },
  /** `${METHOD} ${route}`, e.g. "DELETE /api/admin/sessions/:sessionId". */
  action: { type: String, required: true },
  /** The object acted on, taken from the route parameters. */
  target: { type: String, default: null },
  /** HTTP status actually returned, so denials are distinguishable from successes. */
  status: { type: Number, required: true },
  outcome: { type: String, enum: ['allowed', 'denied'], required: true },
  ip: { type: String, default: null },
  at: { type: Date, default: Date.now },
});

// The two questions this collection exists to answer: "what happened to X?" and
// "what has this person been doing?" — both newest-first.
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ target: 1, at: -1 });
auditLogSchema.index({ actor: 1, at: -1 });

/**
 * Two years, then the row expires on its own. Long enough to outlast any
 * academic appeal window, short enough that the collection never needs managing.
 */
auditLogSchema.index({ at: 1 }, { expireAfterSeconds: 2 * 365 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
