# UOP Attendance API

Express 5 and MongoDB API for the native UOP Attendance Android application. This is the
authoritative server reference for the implemented system.

## What the server does

- Google Credential Manager ID-token sign-in with nonce replay protection.
- Browser Google OAuth fallback with a single-use native exchange code.
- Mongo-backed authenticated sessions, role checks, CSRF protection, CORS, Helmet, and
  endpoint rate limits.
- Staff course/session administration with lecturer ownership enforcement.
- One verification model for every session: Bluetooth and GPS together, with a
  lecturer-read code as the escalation path and a review queue behind it.
- Peer BLE seeding with rotating tokens, bounded leases, and decoy windows.
- Active-building geofence administration and system policy settings.
- Attendance records preserve verification provenance internally; matrices report
  present / under-review / absent only.

Students see campus-wide sessions that are running now. There is no enrolment data model
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

The server supports only the schema documented here. It does not migrate or repair older
database shapes; recreate or explicitly transform an existing database before upgrading.

## Verification contract

Every session verifies the same way — there is no per-session policy. A student's 90
second window runs Bluetooth and GPS together, and the server bands the result:

| Evidence | Band | Result |
|---|---|---|
| valid live BLE token | `inside` | present |
| GPS centroid inside the building polygon | `inside` | present |
| GPS centroid within `nearBufferM` | `near` | present |
| GPS centroid within `farBufferM` | `suspicious` | correct code → present¹ |
| GPS centroid beyond `farBufferM` | `far` | correct code → under review |
| no usable fix / accuracy above the ceiling | `unknown` | correct code → under review |

¹ While `Settings.suspiciousBandAutoPass` is on (default). Off routes it to review too.

The client is never told its band: `status: "collecting"` covers both "still gathering
fixes" and "gathered enough but not passing", so a modified app cannot learn how far out
it is. See `docs/attendance-verification-design.md` for the full rationale.

`Settings.bleEnabled` is the single global kill switch. Off, it stops lecturer
broadcasts, student scanning, and peer seeding; GPS keeps running, since every session
depends on it.

### GPS validation

- Android streams one precise fix at a time for up to 90 seconds.
- Outliers are dropped against the median; survivors are averaged weighted by 1/accuracy².
- If no contributing fix beat 75 m accuracy the attempt bands `unknown` rather than being
  trusted — a ±200 m "fix" near a building must not pass as `near`.
- Intermediate fixes live only in memory for the attempt. Accepted attendance stores the
  centroid, contributing fix count, and distance for audit.
- The band survives the attempt for 10 minutes so a later code submission can be judged
  against it (`services/attemptVerdict.service.js`).

### Bluetooth and peer seeding

- Primary and seeder tokens rotate every 15 seconds with a 2-second previous-token grace.
- Broadcast state is live only while its staff heartbeat is fresh and its session is in
  the configured window.
- Seeder selection uses capability reported by Android. Seeder leases are checked during
  token verification, not only by the cleanup sweep.
- **Only students who heard the lecturer's own primary token may seed.** A GPS-passed
  student can be up to `nearBufferM` from the building, and a student who heard a seeder
  is already one hop out; letting either re-broadcast would grow the effective radius.
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

Course reference, weekday, start/end, `recurring`, `occurrenceDate`, building references,
active/deleted state, BLE broadcast/heartbeat, and code-rotation configuration.
`occurrenceDate` is required for one-time sessions and null for recurring sessions.
`buildings` requires at least one entry — GPS runs for every session and needs a polygon
to measure against. There is no `verification` field.

### Geofence

Name, active/deleted state, and an ordered polygon of `[lng, lat]` vertices. Only
`active: true, deleted: false` buildings are listed, selectable, or accepted.

### Attendance

Student/course/session references, stable course/lecture labels, local attendance date,
timestamp, and:

```text
status = present | under_review | rejected     ← the only field the lecturer sees
method = bluetooth | gps | code_override       ← server-internal
band   = inside | near | suspicious | far | unknown   ← server-internal
```

GPS and code records may additionally store
`{ centroid: { lat, lng, fixCount, distanceM } }`, plus `seedRelayed` for BLE. All of
these except `status` are audit-only and never leave the server. The unique index
`{ student, session, attendanceDate }` makes every path idempotent; a genuine automatic
pass upgrades an existing `under_review`/`rejected` row to `present`.

### BleToken / ManualCode / Settings

- `BleToken` stores primary or student-seed rotating tokens and seed `leaseUntil`.
  `verifyToken` reports which row matched, because only a primary match may seed.
- `ManualCode` stores the rotating/paused 8-digit lecturer code; it is never merged with
  the high-entropy BLE token pool. Every session has one.
- `Settings` stores the Bluetooth kill switch, the two distance buffers, the
  suspicious-band auto-pass switch, and the seeding parameters.

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
| GET | `/api/courses/running` | authenticated | running courses — identity only; the flow never branches |
| GET | `/api/attendance-status?courseId=` | student | `{ status: present\|under_review\|rejected\|none }` |
| POST | `/api/attendance` | student | unified `{ courseId, token? | fix? | code?, canAdvertise }` |
| GET | `/api/attendance/seed-token?sessionId=` | student | rotate/re-fetch owned live seed token |
| DELETE | `/api/attendance/seed-token?sessionId=` | student | relinquish owned lease after radio failure |
| GET | `/api/bluetooth-target?courseId=` | student | `{ available }` — whether scanning is worth the window |

Exactly one of `token`, `fix`, or `code` is accepted by `POST /api/attendance`. The
response `status` is `collecting` (keep going — deliberately ambiguous between "not
enough fixes yet" and "not in a passing band"), `accepted`, `under_review`, or
`rejected`, plus optional `duplicate` and peer-seeding instructions. Attendance record
details are never echoed to the student.

### Courses and reports

Base path: `/api/admin/courses`.

| Method/path | Access | Purpose |
|---|---|---|
| `GET /` | staff | owned courses; admins see all |
| `POST /` | staff | create a course |
| `PATCH /:courseId/assign-lecturer` | admin | set one-to-five owners |
| `PATCH /:courseId/disable` / `enable` | owner/admin | toggle course |
| `DELETE /:courseId` | owner/admin | delete course and associated data |
| `POST /:courseId/sessions` | owner/admin | atomically create schedule, buildings (≥1, required), and code rotation |
| `GET /:courseId/attendance-matrix` | owner/admin | per-student `present` / `under_review` / absent matrix |

### Sessions

Base path: `/api/admin/sessions` (owner/admin session guard applies).

| Method/path | Purpose |
|---|---|
| `GET /` | list accessible sessions |
| `GET /running` | running session broadcast reconciliation |
| `PATCH /:id/activate` / `deactivate` | change active state |
| `DELETE /:id` | soft-delete and revoke secrets |
| `PATCH /:id/broadcast` | set `{ on }`; 403 while the global BLE switch is off |
| `GET /:id/broadcast` | staff token poll/heartbeat and live counts |
| `GET /:id/manual-code` | current staff-only lecturer code/status |
| `PATCH /:id/manual-code` | pause, resume, rotate, or regenerate (no enable flag) |
| `GET /:id/reviews` | students awaiting a decision (identity only, no distance evidence) |
| `PATCH /:id/reviews/:attendanceId` | `{ decision: approve\|reject }` |

### Admin policy and directories

| Method/path | Access | Purpose |
|---|---|---|
| `GET /api/admin/settings` | staff | current policies |
| `PATCH /api/admin/settings` | admin | BLE kill switch, distance buffers, auto-pass switch, seeding |
| `GET /api/admin/geofences` | staff | active selectable buildings |
| `POST/PATCH/DELETE /api/admin/geofences/:id?` | admin | building polygon management |
| `GET/POST/DELETE /api/admin/lecturers/:id?` | admin | lecturer directory |

## Background jobs and caches

- Non-recurring session expiry.
- Stale/out-of-window broadcast closure.
- Out-of-window lecturer-code removal (every session, since every session has a code).
- Expired seed-token cleanup (verification independently checks leases).
- Expired attempt-verdict sweep (10-minute TTL).
- Short active-session cache invalidated on relevant staff mutations.
- OAuth exchange/nonces, code guess limiting, GPS attempt fixes, and attempt verdicts are
  in-memory and therefore assume a single Node process; use a shared store before
  horizontal scaling.

## Testing

```bash
npm test -- --runInBand
```

249 tests across 16 suites, covering authentication, route access, BLE rotation and
broadcasting, distance banding and the accuracy ceiling, the code-escalation outcomes for
every band, the lecturer review queue, running-course DTO contracts, strict
schedules/one-time dates, GPS geometry and fix filtering, active geofences, seeder
eligibility, pages, and unified attendance. Keep Android and server contract tests
aligned whenever a response changes.
