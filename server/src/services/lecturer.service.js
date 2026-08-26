const mongoose = require('mongoose');
const Person = require('../models/Person');
const Course = require('../models/Course');
const { escapeRegex } = require('../utils/regex');

/**
 * `pagination` omitted (or `hasLimit: false`) returns every matching lecturer,
 * as before. Passed with `hasLimit: true`, returns a page instead.
 */
async function listLecturers(query, pagination) {
  const q = String(query || '').trim();
  const filter = { role: 'lecturer', deleted: false };
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: re }, { email: re }, { phone: re }];
  }
  const dbQuery = Person.find(filter).sort({ name: 1, email: 1 });
  if (!pagination || !pagination.hasLimit) return dbQuery;

  const { page, limit } = pagination;
  const [items, total] = await Promise.all([
    dbQuery.skip((page - 1) * limit).limit(limit),
    Person.countDocuments(filter),
  ]);
  return { items, total, page, limit, hasMore: page * limit < total };
}

async function createOrUpdateLecturer({ name, email, phone }) {
  let p = await Person.findOne({ email });
  if (!p) {
    p = await Person.create({
      email,
      studentId: `dir:${new mongoose.Types.ObjectId().toString()}`,
      role: 'lecturer',
      name,
      phone,
      active: true,
      deleted: false,
    });
    return { ok: true, lecturer: p };
  }
  if (p.role === 'admin') return { ok: false, status: 400, error: 'Cannot convert this account to lecturer' };
  p.role = 'lecturer';
  p.name = name;
  p.phone = phone;
  p.active = true;
  p.deleted = false;
  await p.save();
  return { ok: true, lecturer: p };
}

async function deleteLecturer(lecturerId) {
  const lec = await Person.findOne({ _id: lecturerId, role: 'lecturer', deleted: false });
  if (!lec) return { ok: false, status: 404, error: 'Lecturer not found' };

  const affectedCourses = await Course.find({ lecturers: lec._id }).select('_id lecturers');
  let fallbackLecturerId = null;
  const needsFallback = affectedCourses.some((courseDoc) => {
    const remaining = (courseDoc.lecturers || []).filter((id) => String(id) !== String(lec._id));
    return remaining.length === 0;
  });
  if (needsFallback) {
    const fallbackLecturer = await Person.findOne({
      _id: { $ne: lec._id },
      role: 'lecturer',
      deleted: false,
    }).sort({ createdAt: 1 }).select('_id');
    if (!fallbackLecturer) {
      return {
        ok: false,
        status: 400,
        error: 'Cannot remove this lecturer because one or more courses would have no assigned lecturer.',
      };
    }
    fallbackLecturerId = fallbackLecturer._id;
  }

  for (const courseDoc of affectedCourses) {
    const nextLecturers = (courseDoc.lecturers || []).filter((id) => String(id) !== String(lec._id));
    courseDoc.lecturers = nextLecturers.length > 0
      ? nextLecturers
      : [fallbackLecturerId];
    await courseDoc.save();
  }

  lec.deleted = true;
  lec.active = false;
  lec.role = 'student';
  await lec.save();
  return { ok: true };
}

module.exports = {
  listLecturers,
  createOrUpdateLecturer,
  deleteLecturer,
};
