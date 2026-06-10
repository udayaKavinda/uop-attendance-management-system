const mongoose = require('mongoose');
const { MAX_COURSE_LECTURERS } = require('./constants');

function normalizeLecturerIds(rawLecturerIds) {
  if (!Array.isArray(rawLecturerIds)) return [];
  const uniq = [];
  const seen = new Set();
  for (const value of rawLecturerIds) {
    const id = String(value || '').trim();
    if (!mongoose.isValidObjectId(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
    if (uniq.length >= MAX_COURSE_LECTURERS) break;
  }
  return uniq;
}

module.exports = { normalizeLecturerIds };
