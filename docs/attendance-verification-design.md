# Attendance Verification Design — Implemented System

Status: implemented and aligned with the Android/server READMEs as of 2026-08-19.

This document records the intended end-to-end behavior and security invariants. It does
not override runtime configuration or instruct deployment; those belong in the READMEs.

## Goals

1. Verify physical classroom presence through Bluetooth proximity, a GPS building
   geofence, or either signal.
2. Keep method policy controlled by staff/admin settings and enforced by the server.
3. Provide a deliberately weaker but tightly controlled human-readable fallback code.
4. Extend Bluetooth reach through privacy-preserving peer seeding.
5. Preserve the accepted verification method internally for auditing while keeping the
   standard matrix and CSV as simple present/absent reports.

## Explicit product boundaries

- Course discovery is campus-wide. No enrolment/registration source exists in this
  repository, so the server does not infer membership from course batch or email format.
- GPS verification is foreground and permission-based; the app does not continuously
  track students.
- In-memory nonce, manual-attempt, GPS-fix, and exchange-code state assumes one server
  process. A shared store is required before horizontal scaling.

## Session modes

| `LectureSession.verification` | Android behavior | Server acceptance | Staff broadcast |
|---|---|---|---|
| `bluetooth` | scan BLE, 30 s | live valid primary/seeder token | available in window |
| `geofence` | stream GPS, 90 s | stable centroid in active building | hidden and rejected |
| `both` | BLE and GPS concurrently | either valid method | available |

The server returns `verification` in `/api/courses/running`. Android must never guess a
missing value for newly returned sessions; the server retains `bluetooth` as a legacy data
default only.

Global Bluetooth/geofence allow switches apply immediately. A disabled policy:

- prevents creating that mode;
- removes existing sessions using it from student running discovery;
- rejects new automatic submissions; and
- rejects/ends incompatible BLE broadcast activity.

This fail-closed rule avoids a settings UI that says “disabled” while old sessions still
accept the method.

## Runtime flows

### Bluetooth

1. Staff starts broadcast for a running `bluetooth` or `both` session.
2. The server verifies role/course ownership, session/course state, policy, schedule, and
   method compatibility.
3. Android's foreground service polls approximately every five seconds. The poll refreshes
   the broadcast heartbeat and returns the current 15-second rotating token.
4. Student scans for the token and submits it through `POST /api/attendance`.
5. Server repeats method/schedule/broadcast checks and matches against the primary plus
   unexpired seeder token pool.
6. Attendance is created idempotently with `method: "bluetooth"`.

The previous token is accepted only for the 2-second rotation grace period. A stale
broadcast heartbeat, disabled/out-of-window session, or expired seeder lease is rejected
at read/verification time, independent of cleanup jobs.

### GPS geofence

1. Android requests precise foreground location and starts a 90-second fix stream.
2. Each fix contains latitude, longitude, and accuracy; the unified API accepts one fix
   per request.
3. Server accumulates a short-lived attempt buffer, filters unacceptable fixes/outliers,
   and returns `pending` until enough stable evidence exists.
4. The surviving centroid is tested against every configured **active, non-deleted**
   building polygon with the mode-specific buffer.
5. On success, server clears the attempt buffer and creates attendance with
   `method: "gps"`. The accepted centroid/fix count are retained for audit.

Intermediate/rejected fixes are not attendance records and are not persisted.

### Both

Android starts every available path concurrently. Bluetooth denial, disabled adapter, or
unsupported hardware must not prevent GPS; location denial must not prevent Bluetooth.
Both call the same idempotent attendance API. The first accepted method creates the record;
a racing accepted request receives the existing record.

### Manual code

Manual code is orthogonal to all three automatic modes.

- It is available when `Settings.manualCodeAllowed` and
  `LectureSession.manualCodeEnabled` are both true.
- The student can submit it while an automatic attempt is active; Android cancels that
  attempt and sends the code immediately.
- The code is exactly eight digits, separate from BLE secrets, optionally rotating, and
  visible only to authorized staff.
- Five failed attempts within the attempt window cause a temporary per-student/session
  lockout.
- Pause freezes presentation; resume or manual regenerate invalidates the exposed code
  immediately. Automatic rotation has only the 2-second grace window.
- Success records `method: "manual_code"`.

Session creation carries manual enable/rotation fields in the same server request. This
prevents a “session created” success followed by an invisible failed configuration call.

## Peer seeding

After successful automatic verification, the server may assign a real seeder, a decoy, or
no role.

- Android reports `canAdvertise=true` only when BLE advertising is supported **and** the
  runtime advertise/connect permission is granted.
- Android requests advertising permission together with attendance permissions on Android
  12+, but denial never blocks the student's own attendance.
- Real and decoy windows use identical duration and UI so a student cannot learn their
  role from the screen.
- Real seeders receive their own rotating token row and poll for rotation/heartbeat.
- If the local advertiser fails after selection, Android removes its own lease and still
  waits out the same UI window so role privacy is preserved.
- `leaseUntil` is checked both by token verification and the background deletion sweep.

Ending/deactivating/deleting a session removes all primary and seed token rows.

## Geofences and map

`Geofence` stores a named polygon as ordered `[lng, lat]` points plus active/deleted flags.
At least three valid in-range vertices are required. Only active, non-deleted buildings
are returned to staff selectors or GPS validation.

The Android admin tool is native osmdroid/OpenStreetMap. Its initial camera is the Faculty
of Engineering, University of Peradeniya; administrators may pan/zoom before drawing. No
Google Maps key, billing account, or WebView is required.

Create-session building selection is searchable and multi-select. Selected items have
explicit selected color/state and removable chips. At least one building is required for
`geofence` and `both`.

## Scheduling

- Times use strict, zero-padded 24-hour `HH:mm` and must satisfy start < end.
- Recurring sessions run weekly on the configured weekday.
- One-time sessions receive an explicit local `occurrenceDate` for the next selected
  weekday, including today. Window resolution requires both date and weekday to match.
- A one-time session is deactivated after its occurrence and cannot silently reappear the
  next week after server downtime.
- Schedule logic uses the configured IANA `TZ`, default `Asia/Colombo`.

## Data contracts

### LectureSession additions

```text
verification: bluetooth | geofence | both
buildings: ObjectId[] -> Geofence
manualCodeEnabled: Boolean
manualCodeRotationMode: none | interval
manualCodeRotationSeconds: Number
occurrenceDate: YYYY-MM-DD | null
```

### Attendance provenance

The existing single field is retained and extended; there is no redundant
`acceptedVia` field:

```text
method: bluetooth | gps | manual_code
centroid?: { lat, lng, fixCount }
```

Roster responses expose `method`. Matrix cells intentionally map `sessionId -> Boolean`;
Android and CSV use the compact generic present marker `P`.

### Secrets

- `BleToken`: high-entropy primary/seed tokens, owner/role, rotation state, optional
  seeder lease.
- `ManualCode`: separate eight-digit code, previous code, rotation timestamp, paused state.

Keeping the stores separate avoids treating a human-readable fallback as if it had BLE
token entropy.

## API contract

`POST /api/attendance` accepts exactly one proof:

```json
{
  "courseId": "...",
  "token": "optional BLE token",
  "fix": { "lat": 7.25, "lng": 80.59, "accuracy": 8 },
  "code": "optional 8-digit code",
  "canAdvertise": false
}
```

Only one of `token`, `fix`, or `code` may be present. Responses are:

```json
{ "status": "pending" }
```

or

```json
{
  "status": "accepted",
  "attendance": { "method": "gps" },
  "duplicate": false,
  "seeding": { "role": "seed", "durationMs": 60000, "sessionId": "..." }
}
```

Legacy Bluetooth/manual submission endpoints remain thin aliases for installed clients,
but receive the same server-side method and schedule enforcement.

## Security and privacy invariants

- Roles and lecturer ownership are derived from the authenticated server session.
- Mutation requests require the CSRF header; sensitive routes are rate-limited.
- GPS-only sessions cannot start or accept BLE broadcast/token attendance.
- Inactive/deleted geofences never validate GPS attendance.
- Manual code has both global and per-session gates plus guess lockout.
- Attendance is idempotent per student/session/local date.
- The public privacy policy discloses Bluetooth, GPS/manual methods, transient GPS fixes,
  and stored accepted centroids. Its revision date is static and intentional.

## Test and deployment gates

Required before production:

```bash
npm --prefix server test -- --runInBand
cd Android && ./gradlew testDebugUnitTest lintDebug assembleDebug
```

Regression coverage includes the running-course verification DTO, mode bypass rejection,
active geofences, strict time and one-time dates, manual config validation, expired seeder
leases, authentication, GPS geometry/fix filtering, broadcasts, and public pages.

Production deployment is main-only, waits for both server and Android verification jobs,
health-checks the restarted service, and rolls back to the previous Git revision on
failure.
