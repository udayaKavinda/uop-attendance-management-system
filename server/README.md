# UOP Attendance API

Express 5 and MongoDB API for the native UOP Attendance Android application. This is the
authoritative server reference for the implemented multi-mode system.

## What the server does

- Google Credential Manager ID-token sign-in with nonce replay protection.
- Browser Google OAuth fallback with a single-use native exchange code.
- Mongo-backed authenticated sessions, role checks, CSRF protection, CORS, Helmet, and
  endpoint rate limits.
- Staff course/session administration with lecturer ownership enforcement.
- Bluetooth, GPS-geofence, combined OR, and manual-code attendance.
- Peer BLE seeding with rotating tokens, bounded leases, and decoy windows.
- Active-building geofence administration and system policy settings.
- Attendance rosters preserve verification provenance; matrices remain compact present/absent reports.

Students see campus-wide active courses/running sessions. There is no enrolment data model
in this repository; do not describe these as membership-filtered “their courses.”

## Requirements and startup

- Node.js 20+
- MongoDB
- Production secrets/configuration from the root `README_ENV.md`

```bash
npm ci
npm test -- --runInBand
npm start
```

Default listen address: `PORT=5000`. Schedule dates use `TZ`, defaulting safely to
`Asia/Colombo`.

## Verification contract

`LectureSession.verification` is one of:

| Value | Student acceptance | Staff Bluetooth broadcast |
|---|---|---|
| `bluetooth` | valid live BLE token | allowed during the session window |
| `geofence` | stable GPS centroid in an active building | rejected/hidden |
| `both` | BLE or GPS, independently | allowed |

The server enforces this table on every target, broadcast, and submission endpoint; the
client cannot override it. A currently disabled global policy also fails closed for an
existing session and removes it from the running-course list.

Manual code is orthogonal. It works only when both the global
`Settings.manualCodeAllowed` and the session's `manualCodeEnabled` are true.

### GPS validation

- Android streams one precise fix at a time for up to 90 seconds.
- Fixes with unacceptable accuracy/outlier behavior are discarded.
- The server requires the configured active geofence(s) and accepts only after a stable
  centroid falls inside the polygon plus the configured buffer.
- Intermediate fixes live only in memory for the attempt. Accepted attendance stores the
  centroid and contributing fix count for audit.

### Bluetooth and peer seeding

- Primary and seeder tokens rotate every 15 seconds with a 2-second previous-token grace.
- Broadcast state is live only while its staff heartbeat is fresh and its session is in
  the configured window.
- Seeder selection uses capability reported by Android. Seeder leases are checked during
  token verification, not only by the cleanup sweep.
- Ending/deactivating/deleting a session removes its BLE token pool.

### One-time sessions

Weekly sessions have `recurring: true`. A one-time session receives an explicit local
`occurrenceDate` (`YYYY-MM-DD`) for the next selected weekday. It cannot run again on a
later week; expired one-time sessions must be recreated.

Times are strictly validated as zero-padded 24-hour `HH:mm` values.

## Data model summary

### Person

`email`, stable external `studentId`, `role` (`student|lecturer|admin`), `name`, `phone`,
`active`, and `deleted`.

### Course

`code`, `name`, `batch`, one-to-five lecturer owners, and `active`. Unique on
`{ code, batch }`.

### LectureSession

Course reference, weekday, start/end, `recurring`, optional `occurrenceDate`,
`verification`, building references, active/deleted state, BLE broadcast/heartbeat/device
name, and manual-code configuration.

### Geofence

Name, active/deleted state, and an ordered polygon of `[lng, lat]` vertices. Only
`active: true, deleted: false` buildings are listed, selectable, or accepted.

### Attendance

Student/course/session references, stable course/lecture labels, local attendance date,
timestamp, and one provenance field:

```text
method = bluetooth | gps | manual_code
```

GPS records may additionally store `{ centroid: { lat, lng, fixCount } }`. The unique
index `{ student, session, attendanceDate }` makes all methods idempotent.

### BleToken / ManualCode / Settings

- `BleToken` stores primary or student-seed rotating tokens and seed `leaseUntil`.
- `ManualCode` stores the separate rotating/paused 8-digit code; it is never merged with
  the high-entropy BLE token pool.
- `Settings` stores Bluetooth/geofence allow switches, GPS buffers, seeding parameters,
  and the manual-code global kill switch.

## API reference

All JSON mutation requests require `X-Requested-With: fetch`. `student`, `staff`, and
`admin` below refer to server-derived session roles, never trusted client headers.

### Authentication and public routes

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/auth/google-nonce` | public/rate-limited | nonce for native sign-in |
| POST | `/api/auth/google-id-token` | public/rate-limited | verify Google ID token and create session |
| GET | `/auth/google` | public/rate-limited | browser OAuth fallback |
| GET | `/auth/google/callback` | public/rate-limited | OAuth callback |
| POST | `/api/auth/exchange-code` | public/rate-limited | consume native fallback exchange code |
| GET | `/api/me` | authenticated | current account and role |
| POST | `/api/logout` | authenticated | destroy session |
| GET | `/api/healthz` | public | process/database health |
| GET | `/privacy` | public | current privacy policy |
| GET | `/delete` | public | account deletion instructions |

### Student discovery and attendance

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/courses` | authenticated | campus-wide active courses |
| GET | `/api/courses/running` | authenticated | running courses with `verification` and `manualCodeEnabled` |
| GET | `/api/attendance-status?courseId=` | student | current/today status including `method` |
| POST | `/api/attendance` | student | unified `{ courseId, token? | fix? | code?, canAdvertise }` |
| GET | `/api/attendance/seed-token?sessionId=` | student | rotate/re-fetch owned live seed token |
| DELETE | `/api/attendance/seed-token?sessionId=` | student | relinquish owned lease after radio failure |
| GET | `/api/bluetooth-target?courseId=` | student | device target for BLE-compatible sessions |
| POST | `/api/bluetooth-attendance` | student | backward-compatible BLE alias |
| POST | `/api/manual-attendance` | student | backward-compatible manual-code alias |

Exactly one of `token`, `fix`, or `code` is accepted by `POST /api/attendance`. GPS may
return `{ status: "pending" }`; accepted records return `status`, `attendance`, optional
`duplicate`, and optional peer-seeding instructions.

### Courses and reports

Base path: `/api/admin/courses`.

| Method/path | Access | Purpose |
|---|---|---|
| `GET /` | staff | owned courses; admins see all |
| `POST /` | staff | create a course |
| `PATCH /:courseId/assign-lecturer` | admin | set one-to-five owners |
| `PATCH /:courseId/disable` / `enable` | owner/admin | toggle course |
| `DELETE /:courseId` | owner/admin | delete course and associated data |
| `GET /:courseId/sessions` | owner/admin | course sessions |
| `POST /:courseId/sessions` | owner/admin | atomically create schedule, verification, buildings, and manual config |
| `GET /:courseId/attendance-matrix` | owner/admin | compact present/absent matrix per student |

### Sessions

Base path: `/api/admin/sessions` (owner/admin session guard applies).

| Method/path | Purpose |
|---|---|
| `GET /` | list accessible sessions |
| `GET /running` | running session broadcast reconciliation |
| `PATCH /:id/activate` / `deactivate` | change active state |
| `DELETE /:id` | soft-delete and revoke secrets |
| `PATCH /:id/broadcast` | set `{ on }`; rejects GPS-only sessions |
| `GET /:id/broadcast` | staff token poll/heartbeat and live counts |
| `GET /:id/attendance` | roster with per-record `method` |
| `GET /:id/manual-code` | current staff-only manual code/status |
| `PATCH /:id/manual-code` | enable, pause, resume, rotate, or regenerate |

### Admin policy and directories

| Method/path | Access | Purpose |
|---|---|---|
| `GET /api/admin/settings` | staff | current policies |
| `PATCH /api/admin/settings` | admin | policy/buffer/seeding/manual kill-switch changes |
| `GET /api/admin/geofences` | staff | active selectable buildings |
| `POST/PATCH/DELETE /api/admin/geofences/:id?` | admin | building polygon management |
| `GET/POST/PATCH/DELETE /api/admin/lecturers/:id?` | admin | lecturer directory |

## Background jobs and caches

- Non-recurring session expiry.
- Stale/out-of-window broadcast closure.
- Out-of-window manual-code removal.
- Expired seed-token cleanup (verification independently checks leases).
- Short active-session cache invalidated on relevant staff mutations.
- OAuth exchange/nonces, manual guess limiting, and GPS attempt fixes are in-memory and
  therefore assume a single Node process; use a shared store before horizontal scaling.

## Testing

```bash
npm test -- --runInBand
```

The suite covers authentication, route access, BLE rotation and broadcasting, mode-policy
enforcement, running-course DTO contracts, strict schedules/one-time dates, GPS geometry
and fix filtering, active geofences, manual codes, peer seeding, pages, and unified
attendance. Keep Android and server contract tests aligned whenever a response changes.
