const Attendance = require('../models/Attendance');
const { localYmd } = require('../utils/date');

/**
 * Lecturer-facing queue for `under_review` submissions — students who gave the
 * correct code from outside the trusted distance bands.
 *
 * The queue exposes the student's identity and when they submitted, but not the
 * raw evidence (`method`, `band`, centroid): the lecturer's judgement is meant
 * to rest on "do I recognise this person as being in my class", not on a
 * distance readout they have no way to sanity-check.
 */
async function listPending(sessionItem, attendanceDate = localYmd()) {
  const docs = await Attendance.find({
    session: sessionItem._id,
    attendanceDate,
    status: 'under_review',
  })
    .populate('student', 'name email studentId')
    .sort({ timestamp: 1 });

  return docs.map((doc) => ({
    _id: doc._id,
    name: doc.student?.name || null,
    email: doc.student?.email || null,
    submittedAt: doc.timestamp,
  }));
}

/** Count only — cheap enough to poll alongside the broadcast heartbeat. */
async function countPending(sessionItem, attendanceDate = localYmd()) {
  return Attendance.countDocuments({
    session: sessionItem._id,
    attendanceDate,
    status: 'under_review',
  });
}

/**
 * Approve or reject one pending submission. Scoped to the session from the route
 * guard, so a lecturer can never review a record belonging to someone else's
 * session by guessing an id.
 */
async function review(sessionItem, attendanceId, decision, reviewerId) {
  const doc = await Attendance.findOne({ _id: attendanceId, session: sessionItem._id });
  if (!doc) return { ok: false, status: 404, error: 'Submission not found' };
  if (doc.status !== 'under_review') {
    return { ok: false, status: 409, error: 'This submission has already been decided' };
  }
  doc.status = decision === 'approve' ? 'present' : 'rejected';
  doc.reviewedAt = new Date();
  doc.reviewedBy = reviewerId;
  await doc.save();
  return { ok: true, attendance: doc };
}

module.exports = { listPending, countPending, review };
