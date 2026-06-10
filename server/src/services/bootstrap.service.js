const Person = require('../models/Person');
const { BOOTSTRAP_ADMIN_EMAIL } = require('../utils/constants');

async function ensureBootstrapAdmin() {
  const email = String(BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return;
  let person = await Person.findOne({ email });
  if (!person) {
    person = await Person.create({
      email,
      studentId: `bootstrap:${email}`,
      role: 'admin',
      active: true,
      deleted: false,
    });
    console.log(`Bootstrap admin created: ${email}`);
    return;
  }
  let changed = false;
  if (person.role !== 'admin') {
    person.role = 'admin';
    changed = true;
  }
  if (person.deleted) {
    person.deleted = false;
    changed = true;
  }
  if (!person.active) {
    person.active = true;
    changed = true;
  }
  if (changed) {
    await person.save();
    console.log(`Bootstrap admin updated: ${email}`);
  }
}

module.exports = { ensureBootstrapAdmin };
