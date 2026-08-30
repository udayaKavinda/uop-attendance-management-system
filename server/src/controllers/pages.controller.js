const { WEB_APP_MOUNT_PATH } = require('../utils/constants');

const CONTACT_EMAIL = 'udayakavindadev@gmail.com';
const APP_NAME = 'UOP Attendance';
const ORG_NAME = 'University of Peradeniya, Faculty of Engineering';
const PRIVACY_LAST_UPDATED = '2026-08-19';

function layout(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ${APP_NAME}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; }
  p, li { font-size: 0.95rem; }
  .meta { color: #666; font-size: 0.85rem; margin-bottom: 2rem; }
  a { color: #7A1414; }
  code { background: #f2f2f2; padding: 0.1em 0.4em; border-radius: 4px; font-size: 0.9em; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px 20px; margin: 1rem 0; background: #fafafa; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * The domain root has no page of its own — the student client is mounted under
 * WEB_APP_MOUNT_PATH — but the bare domain is the address people type and share,
 * so send them there instead of answering 404.
 *
 * Deliberately a temporary redirect: browsers cache a 301 more or less forever,
 * which would make it painful to ever give "/" a page of its own.
 */
function home(req, res) {
  return res.redirect(302, `${WEB_APP_MOUNT_PATH}/`);
}

function privacy(req, res) {
  const html = layout('Privacy policy', `
<h1>Privacy policy</h1>
<p class="meta">${APP_NAME} · ${ORG_NAME} · Last updated: ${PRIVACY_LAST_UPDATED}</p>

<p>${APP_NAME} is a lecture-attendance app for ${ORG_NAME}. This page explains what
information the app collects, how it is used, and how you can request that your data be
deleted.</p>

<h2>Information we collect</h2>
<ul>
  <li><strong>Google account information</strong> — when you sign in with Google, we
  receive your name, email address, and a stable Google account identifier. We do not
  receive your Google password.</li>
  <li><strong>Phone number</strong> — optionally, for lecturer/staff directory records
  (entered by an administrator, not required for students).</li>
  <li><strong>Attendance records</strong> — the course, lecture session, date, and time
  you recorded attendance, whether it was accepted outright or is awaiting your
  lecturer's review, and the method used (Bluetooth proximity, GPS geofence, or a
  lecturer-provided attendance code).</li>
  <li><strong>Location information</strong> — every session is verified by GPS
  alongside Bluetooth, so precise location fixes are processed during the short
  (90-second) verification window whenever you check in. Intermediate and rejected
  fixes are held only in server memory for that attempt and are never written to the
  database. When attendance is accepted, the resulting averaged position, its
  contributing-fix count, and its distance from the lecture building are stored with
  the attendance record for academic-integrity auditing.</li>
  <li><strong>Bluetooth tokens</strong> — short-lived rotating codes used only to verify
  physical presence in a classroom during attendance. These are not personal data and
  automatically expire.</li>
</ul>

<h2>How we use this information</h2>
<p>Solely to operate the app: authenticating you, determining your role (student,
lecturer, or admin), recording and reporting lecture attendance, and academic
record-keeping for ${ORG_NAME}.</p>

<h2>Sharing</h2>
<p>We do not sell or share your information with advertisers or data brokers. Google is
used only as the sign-in provider (Google OAuth); no attendance or profile data is sent
to Google or any other third party.</p>

<h2>Data retention</h2>
<p>Account and attendance records, including an accepted GPS centroid when GPS was used,
are retained for academic record-keeping while your account is active. Bluetooth tokens,
manual codes, and temporary location fixes are short-lived and are removed or invalidated
when their session/window ends.</p>

<h2>Your rights</h2>
<p>You can request a copy of your data or request that your account and associated
attendance records be deleted at any time. See our
<a href="/delete">account deletion page</a> for instructions.</p>

<h2>Contact</h2>
<p>Questions about this policy or your data can be sent to
<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`);
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
}

function deleteAccount(req, res) {
  const html = layout('Delete your account', `
<h1>Delete your account</h1>
<p class="meta">${APP_NAME} · ${ORG_NAME}</p>

<p>You can request deletion of your ${APP_NAME} account and all associated data at any
time.</p>

<div class="card">
  <h2 style="margin-top:0">How to request deletion</h2>
  <p>Send an email to <a href="mailto:${CONTACT_EMAIL}?subject=Account%20deletion%20request">${CONTACT_EMAIL}</a>
  from the same address you use to sign in to the app (or otherwise identify your
  registered Google account email), with the subject line
  <code>Account deletion request</code>.</p>
  <p>We will confirm your identity against our records and delete your data within
  30 days of receiving the request.</p>
</div>

<h2>What gets deleted</h2>
<ul>
  <li>Your account record (name, email, role).</li>
  <li>Your attendance history (course, session, date, and time of each recorded
  attendance).</li>
</ul>

<h2>What we keep</h2>
<p>We may retain minimal information where required for academic integrity or legal
recordkeeping (for example, an anonymized count of attendance for a course), but this
will no longer be linked to your name or email address.</p>

<p>See our <a href="/privacy">privacy policy</a> for more detail on what we collect and
why.</p>
`);
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
}

module.exports = { home, privacy, deleteAccount };
