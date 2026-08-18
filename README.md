# UOP Attendance Management System

Native Android attendance administration and student attendance for the University of
Peradeniya Faculty of Engineering, backed by an Express/MongoDB API.

## Implemented verification modes

- **Bluetooth** — a lecturer phone broadcasts a rotating BLE token.
- **GPS geofence** — the student submits precise fixes during a 90-second window; the
  server accepts a stable centroid inside one of the session's active building polygons.
- **Both** — Bluetooth and GPS run as independent concurrent alternatives; either may
  accept attendance.
- **Manual code** — optional 8-digit lecturer-controlled fallback alongside any mode.
- **Peer seeding** — selected, capable students briefly rebroadcast rotating BLE tokens;
  expired leases are rejected at verification time.

Attendance records retain the accepted method internally; the standard matrix and CSV use
only the generic present marker `P`.

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
