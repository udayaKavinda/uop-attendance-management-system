# UOP Attendance Management System

Native Android attendance administration and student attendance for the University of
Peradeniya Faculty of Engineering, backed by an Express/MongoDB API.

## How attendance is verified

Every session works the same way — there is no policy to pick. A student's check-in runs
one 90-second window in which **Bluetooth and GPS are tried together**, and the first to
succeed marks them present:

- **Bluetooth** — a lecturer phone broadcasts a rotating BLE token. Hearing it is proof
  of being in the room, and passes outright.
- **GPS geofence** — the phone streams precise fixes; a stable centroid inside the
  session's building polygon, or within the admin's pass distance of it, also passes.

If neither succeeds, the student gets **Try again** (another window) or **Get help**,
which asks for the 8-digit code the lecturer reads out. How far away they were decides
what the code does: near the building it marks them present, further out it only queues
them for the lecturer's **review**, where they are approved or rejected by name.

Two supporting mechanisms:

- **Peer seeding** — a few students who heard the lecturer directly rebroadcast the token
  to extend range; they cannot tell whether they were really picked.
- **Distance bands** — the pass and outer radii, and whether the outer band's code
  passes or reviews, are admin settings.

Attendance records retain the method, band, and position internally for auditing. The
matrix and CSV show only presence and "awaiting review".

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

Students discover the courses that have sessions running right now. The repository
does not contain an enrolment/registration data source, so it does not claim or attempt
student-to-course membership filtering. Recording attendance still requires a valid
server-enforced session method and physical/manual proof. Lecturer actions are restricted
to owned courses; admins may manage the whole installation.
