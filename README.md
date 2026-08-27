# UOP Attendance Management System

Native Android attendance administration and student attendance for the University of
Peradeniya Faculty of Engineering, backed by an Express/MongoDB API.

## How attendance is verified

Every session works the same way — there is no policy to pick. A student's check-in runs
one 90-second window in which **Bluetooth and GPS are tried together**, and the first to
succeed marks them present:

- **Bluetooth** — a lecturer phone broadcasts a rotating BLE token. Hearing it is proof
  of being in the room, and passes outright. If the student's Bluetooth is off, the app
  fires the system "turn on Bluetooth?" prompt (on the first attempt and every **Try
  again**) while GPS keeps running regardless of what they pick.
- **GPS geofence** — the phone streams precise fixes; whether the result counts as
  "within the near/far buffer" is decided by an admin-selectable strategy per band
  (accuracy-weighted centroid by default, or any/majority/all points within the buffer,
  median distance, or best-accuracy-fix-only) — see `services/geofenceLogic.service.js`.

If neither succeeds, the student gets **Try again** (another window) or **Get help**,
which asks for the 8-digit code the lecturer reads out. How far away they were decides
what the code does: near the building (including the suspicious band, which always
passes on a correct code) it marks them present; beyond the far buffer, it's written as a
`flagged` record with a reason instead — there is no lecturer review queue and nobody
approves or rejects anything.

Two supporting mechanisms:

- **Peer seeding** — a few students who heard the lecturer directly rebroadcast the token
  to extend range; they cannot tell whether they were really picked.
- **Distance bands** — the near/far radii and each band's geofence-logic strategy are
  admin settings.

Attendance records retain the method, band, and position internally for auditing. The
on-screen matrix shows only presence/flagged; the downloadable Excel export additionally
red-fills a flagged cell and attaches the reason as a cell comment.

## Repository layout

- `Android/` — Kotlin/Jetpack Compose application for students, lecturers, and admins.
- `server/` — Express API, MongoDB models, authentication, attendance logic, and tests.
- `docs/attendance-verification-design.md` — implemented verification behavior and
  security decisions.
- `deploy/` — Nginx reverse-proxy example.
- `.github/workflows/deploy.yml` — tested, main-only production deployment with rollback.

There is no React/web application. Express serves the API plus public `/privacy` and
`/delete` pages.

## Quick start

```bash
npm --prefix server ci
npm --prefix server test -- --runInBand
npm --prefix server start
```

Android (JDK 17 and Android SDK required):

```bash
cd Android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

The API defaults to `http://localhost:5000`; the Android production base is
`https://attendance.eng.pdn.ac.lk`.

Configuration and deployment are described in [README_ENV.md](README_ENV.md). API and
Android details are in [server/README.md](server/README.md) and
[Android/README.md](Android/README.md).

## Access model

Students discover the courses that have sessions running right now — a searchable
picker, not a scrolling list, since campus-wide "running now" can be a lot of sessions
at once. The repository does not contain an enrolment/registration data source, so it
does not claim or attempt student-to-course membership filtering. Recording attendance
still requires a valid server-enforced session method and physical/manual proof.
New student accounts must sign in with an admin-configured email domain (default
`eng.pdn.ac.lk`; empty disables the check) — existing accounts and lecturers/admins
provisioned directly by an admin are never subject to it. Lecturer actions are restricted
to owned courses, though any owner may add a co-owner; admins may manage the whole
installation, including reassigning or removing owners outright.

An admin-set minimum Android `versionCode` blocks the app with a full-screen, non-dismissible
update prompt below that version — there is no live Play Store lookup, so this is bumped
by hand after publishing a release that must not be skipped.

"Delete" on a course or lecturer hides it rather than destroying data — the same as
disabling — and hidden entries sort to the bottom of admin lists instead of disappearing
outright.
