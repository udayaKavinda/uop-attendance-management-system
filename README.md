# UOP Attendance Management System

Native Android attendance administration and student attendance for the University of
Peradeniya Faculty of Engineering, backed by an Express/MongoDB API.


## How attendance is verified

Every session works the same way — there is no policy to pick. A check-in runs one
90-second window in which **Bluetooth and GPS are tried together**, and the first to
succeed marks the student present. If neither does, they can ask the lecturer for an
8-digit code; how far out their GPS put them decides whether that code marks them present
or records a `flagged` row instead. A student who never passes and never submits the code
leaves no record at all.

Two supporting mechanisms: **peer seeding**, where a few students who heard the lecturer
directly rebroadcast the token to extend range, and admin-tunable **distance bands** with
a selectable geofence strategy per band.

The Android app closes itself rather than submitting a GPS fix the platform reports as
mocked ([Android/README.md](Android/README.md#attendance-flow)), and every staff mutation
and rejected sign-in is appended to an audit collection
([server/README.md](server/README.md#audit-log)).

That is the whole shape of it. The exact bands, what each one writes, and the rules the
server enforces are in **[server/README.md](server/README.md#verification-contract)** —
that document is the contract. **[docs/attendance-verification-design.md](docs/attendance-verification-design.md)**
explains why the rules are what they are, and what the model's known limits are.

## Repository layout

- `Android/` — Kotlin/Jetpack Compose application for students, lecturers, and admins.
- `server/` — Express API, MongoDB models, authentication, attendance logic, and tests.
- `web/` — React student check-in client for iOS, served by Express at `/app`.
- `docs/attendance-verification-design.md` — implemented verification behavior and
  security decisions.
- `deploy/` — Nginx reverse-proxy example.
- `.github/workflows/deploy.yml` — tested, main-only production deployment with rollback.

Express also serves the public `/privacy` and `/delete` pages.

### Why there is a web client, and why it is iOS-only

No iOS browser can read a Bluetooth beacon, so `web/` is a GPS-only client that gives
iPhone users a way in ahead of a native iOS app; Android users get the notice to use the
native app instead. It is served from the API's own origin because the session cookie is
httpOnly and Safari blocks third-party cookies. [web/README.md](web/README.md) has the
reasoning and the platform gate's limits.

## Quick start

```bash
npm --prefix server ci
npm --prefix server test -- --runInBand
npm --prefix server start
```

Web client (optional; the API runs without it and answers `/app` with a 503 until built):

```bash
npm --prefix web ci
npm --prefix web run build
```

Android (JDK 17 and Android SDK required):

```bash
cd Android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

Server tests: 314 across 21 suites.

The API defaults to `http://localhost:5000`; the Android production base is
`https://attendance.eng.pdn.ac.lk`.

Configuration and deployment are described in [README_ENV.md](README_ENV.md). API and
Android details are in [server/README.md](server/README.md) and
[Android/README.md](Android/README.md).

## Access model

Students discover the courses that have sessions running right now — a searchable picker,
not a scrolling list, since campus-wide "running now" can be a lot of sessions at once.
**The repository has no enrolment data source**, so it does not attempt student-to-course
membership filtering; recording attendance still requires server-enforced evidence.

Lecturers act only on courses they own (any owner may add a co-owner); admins manage the
whole installation. New student accounts are gated on an admin-configured email domain,
and an admin-set minimum Android `versionCode` blocks outdated installs. "Delete" hides
rather than destroys, everywhere.

Each of those rules — who may do what, what "delete" does to sessions, courses, lecturers
and buildings, and what happens to a course whose last owner is removed — is specified in
[server/README.md](server/README.md).
