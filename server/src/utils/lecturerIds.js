const mongoose = require('mongoose');

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
  }
  return uniq;
}

module.exports = { normalizeLecturerIds };
