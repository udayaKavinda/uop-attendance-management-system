# UOP Attendance API

Express 5 and MongoDB API for the native UOP Attendance Android application. This is the
authoritative server reference for the implemented system.

## What the server does

- Google Credential Manager ID-token sign-in with nonce replay protection, gated to an
  admin-configured email domain for brand-new student accounts (existing accounts and
  lecturers/admins provisioned by an admin are never subject to it).
- Browser Google OAuth fallback with a single-use native exchange code.
- Mongo-backed authenticated sessions, role checks, CSRF protection, CORS, Helmet, and
  endpoint rate limits.
- A public app-version check the client uses to enforce an admin-set minimum Android
  `versionCode`, blocking outdated installs with a mandatory update prompt.
- Staff course/session administration with lecturer ownership enforcement; any existing
  owner (not just an admin) may add and remove co-owners on their own course, same as an
  admin can on any course.
- One verification model for every session: Bluetooth and GPS together, with a
  lecturer-read code as the escalation path. There is no lecturer review queue — a
  `far`/`unknown` code submission is written as a `flagged` record directly, visible only
  in the Excel attendance export.
- Selectable GPS geofence logic: the near and far distance bands each independently pick
  a strategy (accuracy-weighted centroid, any/majority/all points within the buffer,
  median distance, or best-accuracy-fix-only) for deciding "is this student within the
  buffer" — see `services/geofenceLogic.service.js`.
- Peer BLE seeding with rotating tokens, bounded leases, and decoy windows.
- Active-building geofence administration and system policy settings.
- Attendance records preserve verification provenance internally; matrices report
  present / flagged / absent only. The downloadable Excel export additionally red-fills
  and comments flagged cells with a plain-language reason.

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
| within the near buffer (near-buffer logic) | `inside`/`near` | present |
| within the far buffer (far-buffer logic), not the near one | `suspicious` | correct code → present |
| outside the far buffer | `far` | correct code → flagged¹ |
| no usable fix / accuracy above the ceiling | `unknown` | correct code → flagged¹ |

¹ "Flagged" is not a queue — it's an `Attendance` row with `status: 'flagged'` and a
`reason`, visible only in the Excel attendance export (red fill + cell comment). Nobody
approves or rejects it. `suspicious` always passes on a correct code now — there is no
admin switch for it, unlike `far`/`unknown` which never pass. Crucially, `suspicious`,
`far`, and `unknown` all require the student to actually submit the "get help" code to
produce **any** `Attendance` record at all — raw GPS fixes alone never write one for
these three bands, so a student who never falls back to the code leaves no trace, exactly
like one who never checked in.

"Within the near/far buffer" is deliberately not just a fixed distance check — each band
independently runs a selectable strategy (`Settings.nearBufferLogic`/`farBufferLogic`)
against `nearBufferM`/`farBufferM`. See `services/geofenceLogic.service.js`'s
`STRATEGIES` for the full list (accuracy-weighted centroid, any/majority/all points
within, median distance, best-accuracy-fix-only) — near is always evaluated first, and
far only runs if near didn't already pass.

The client is never told its band: `status: "collecting"` covers both "still gathering
fixes" and "gathered enough but not passing", so a modified app cannot learn how far out
it is. See `docs/attendance-verification-design.md` for the full rationale.

`Settings.bleEnabled` is the single global kill switch. Off, it stops lecturer
broadcasts, student scanning, and peer seeding; GPS keeps running, since every session
depends on it.

### GPS validation

- Android streams one precise fix at a time for up to 90 seconds.
- Outliers are dropped against the median; survivors are averaged weighted by 1/accuracy².
  If trimming leaves fewer than 4 trustworthy fixes the attempt reports "not ready" and
  waits for more, rather than banding on fixes it has already judged unreliable.
- A reported accuracy of `0` means "unknown" (Android returns it when `hasAccuracy()` is
  false), not "perfect", and is normalised to a pessimistic 50 m for both centroid
  weighting and best-fix selection.
- If no contributing fix beat 75 m accuracy the attempt bands `unknown` rather than being
  trusted — a ±200 m "fix" near a building must not pass as `near`.
- Intermediate fixes live only in memory for the attempt. Accepted attendance stores the
  centroid, contributing fix count, and distance for audit.
- The band survives the attempt for 10 minutes so a later code submission can be judged
  against it (`services/attemptVerdict.service.js`).

### Bluetooth and peer seeding

- Primary and seeder tokens rotate every 15 seconds with an 8-second previous-token grace.
  The grace must exceed the broadcaster's 5-second poll interval: rotation is lazy (it
  happens on the first poll that finds the token stale, and only that caller gets the new
  value), so with several devices broadcasting one session every other device keeps
  advertising the old token until its own next poll.
- Broadcast state is live only while its staff heartbeat is fresh and its session is in
  the configured window.
- Seeder selection uses capability reported by Android. Seeder leases are checked during
  token verification, not only by the cleanup sweep.
- **Only students who heard the lecturer's own primary token may seed.** A GPS-passed
  student can be up to `nearBufferM` from the building, and a student who heard a seeder
  is already one hop out; letting either re-broadcast would grow the effective radius.
- Ending/deactivating/deleting a session removes its BLE token pool.
- **Multiple staff devices may broadcast the same session simultaneously** (the "Join"
  client action) — the primary token is per-session, not per-device, so every broadcasting
  phone just advertises whatever the server currently hands back, extending physical
  range in a large room. One device's radio failing (or that device stopping) never
  affects the others or the session's `active` state; only the heartbeat-staleness sweep
  or an explicit deactivate ends the channel for everyone.

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

`code` (capital letters and numbers only), `name`, `batch` (`E` followed by two digits,
e.g. `E23`), one or more lecturer owners (no upper limit), and `active`. Unique on
`{ code, batch }` — creating a course accepts multiple `batches` at once and makes one
Course document per batch, all sharing the same owners. There is no separate hard delete:
`DELETE`-equivalent behavior is the same as disabling (`active: false`), which hides the
course rather than destroying its data; disabled courses sort after active ones in listings.

### LectureSession

Course reference, weekday, start/end, `recurring`, `occurrenceDate`, building references,
active/deleted state, BLE broadcast/heartbeat, and code-rotation configuration.
`occurrenceDate` is required for one-time sessions and null for recurring sessions.
`buildings` requires at least one entry — GPS runs for every session and needs a polygon
to measure against. There is no `verification` field.

**`active` means "collecting attendance right now"** — created `false` always, and the
*only* way it becomes `true` is `PATCH /:id/activate` ("Collect"/"Join" client-side),
which itself requires being inside the session's own scheduled window
(`isScheduledNow`) — collecting outside class time is rejected, not just hidden client-side.
Three states fall out of `active` combined with the window:

| `active` | in window | client-facing stage |
|---|---|---|
| — | no | Inactive |
| `false` | yes | Within-session |
| `true` | yes | Collecting |

GPS verification runs for every student throughout Collecting regardless of Bluetooth —
it has no on/off switch — so a broadcasting phone's radio failing never touches `active`;
only an explicit `PATCH /:id/deactivate` or the window closing does. Recurring sessions
have no expiry date, so nothing else would ever clear `active` between weekly
occurrences — a background sweep (`deactivateRecurringSessionsPastWindow`, alongside the
existing one-time-session expiry sweep) resets it once each day's window closes, so every
occurrence needs its own explicit Collect tap.

### Geofence

Name, active/deleted state, and an ordered polygon of `[lng, lat]` vertices. Only
`active: true, deleted: false` buildings are listed, selectable, or accepted.

### Attendance

Student/course/session references, stable course/lecture labels, local attendance date,
timestamp, and:

```text
status = present | flagged                     ← the only field the lecturer sees
method = bluetooth | gps | code_override       ← server-internal
band   = inside | near | suspicious | far | unknown   ← server-internal
reason = human-readable string, `flagged` only ← surfaced only in the Excel export
```

GPS and code records may additionally store
`{ centroid: { lat, lng, fixCount, distanceM } }`, plus `seedRelayed` for BLE. All of
these except `status` (and `reason`, in the Excel export only) are audit-only and never
leave the server. The unique index `{ student, session, attendanceDate }` makes every
path idempotent; a genuine automatic pass upgrades an existing `flagged` row to
`present`, and a fresh `flagged` verdict from a repeat code submission overwrites an
existing `flagged` one so the stored reason/distance reflects the latest evidence rather
than freezing on the first submission. **Raw GPS fixes never write anything to
`Attendance` for `suspicious`/`far`/`unknown`** — only an actual "get help" code
submission does (see `recordHelpCodeAttendance`); a student who never falls back to the
code leaves no record at all, same as a student who never checked in.

### BleToken / ManualCode / Settings

- `BleToken` stores primary or student-seed rotating tokens and seed `leaseUntil`.
  `verifyToken` reports which row matched, because only a primary match may seed.
- `ManualCode` stores the rotating/paused 8-digit lecturer code; it is never merged with
  the high-entropy BLE token pool. Every session has one.
- `Settings` stores the Bluetooth kill switch, the two distance buffers, the
  independently selectable near/far buffer-logic strategy ids (`nearBufferLogic`,
  `farBufferLogic`, default `accuracy_weighted_centroid` — see
  `services/geofenceLogic.service.js`), the seeding parameters, the student sign-in email
  domain (`studentEmailDomain`, empty disables the check), and the minimum Android
  `versionCode` (`minSupportedVersionCode`, `0` disables the check).

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
| GET | `/api/app-version` | public | `{ minSupportedVersionCode }` — client blocks below this |
| GET | `/privacy` | public | current privacy policy |
| GET | `/delete` | public | account deletion instructions |

### Student discovery and attendance

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/courses/running` | authenticated | running courses — identity only; the flow never branches |
| GET | `/api/attendance-status?courseId=` | student | `{ status: present\|flagged\|none }` |
| POST | `/api/attendance` | student | unified `{ courseId, token? | fix? | code?, canAdvertise }` |
| GET | `/api/attendance/seed-token?sessionId=` | student | rotate/re-fetch owned live seed token |
| DELETE | `/api/attendance/seed-token?sessionId=` | student | relinquish owned lease after radio failure |
| GET | `/api/bluetooth-target?courseId=` | student | `{ available }` — whether scanning is worth the window |

Exactly one of `token`, `fix`, or `code` is accepted by `POST /api/attendance`. The
response `status` is `collecting` (keep going — deliberately ambiguous between "not
enough fixes yet" and "not in a passing band"), `accepted`, or `flagged`, plus optional
`duplicate` and peer-seeding instructions. Attendance record details (band, method,
centroid, reason) are never echoed to the student.

### Courses and reports

Base path: `/api/admin/courses`.

| Method/path | Access | Purpose |
|---|---|---|
| `GET /?page=&limit=&lecturerId=` | staff | owned courses; admins see all, or one lecturer's with `lecturerId`. Omitting `limit` returns everything; passing it pages (`{ items, total, page, limit, hasMore }`) |
| `POST /` | staff | create a course — `batches: string[]` creates one Course document per batch |
| `PATCH /:courseId/assign-lecturer` | owner/admin | wholesale reassignment — set any number of owners (add or remove); a lecturer may only do this on a course they already own |
| `PATCH /:courseId/disable` / `enable` | owner/admin | toggle course — this is also what "delete" means; no destructive delete exists |
| `POST /:courseId/sessions` | owner/admin | atomically create schedule, buildings (≥1, required), and code rotation |
| `GET /:courseId/attendance-matrix` | owner/admin | per-student `present` / `flagged` / absent matrix (JSON) |
| `GET /:courseId/attendance-matrix.xlsx` | owner/admin | the same matrix as a downloadable Excel file — flagged cells are red-filled with the reason as a cell comment |

### Sessions

Base path: `/api/admin/sessions` (owner/admin session guard applies).

| Method/path | Purpose |
|---|---|
| `GET /?page=&limit=` | list accessible sessions, soonest/currently-running first. Omitting `limit` returns everything; passing it pages (`{ items, total, page, limit, hasMore }`) |
| `GET /running` | sessions whose scheduled window is open right now, **not** filtered by `active` — `{ sessionId, active, broadcasting }` per entry, refreshed on a faster cadence than the full list so a client can tell Within-session apart from Collecting without a full reload |
| `PATCH /:id/activate` / `deactivate` | "Collect"/"Join" and "Deactivate" client-side — `activate` requires being inside the session's own window right now (see LectureSession above) |
| `DELETE /:id` | soft-delete and revoke secrets |
| `PATCH /:id/broadcast` | set `{ on }`; 403 while the global BLE switch is off |
| `GET /:id/broadcast` | staff token poll/heartbeat and live counts |
| `GET /:id/manual-code` | current staff-only lecturer code/status |
| `PATCH /:id/manual-code` | pause, resume, rotate, or regenerate (no enable flag) |

There is no reviews endpoint — a `far`/`unknown` code submission is written directly as a
`flagged` `Attendance` record (see "Verification contract" above); the only place it
becomes visible to staff is the Excel export under `/api/admin/courses`.

### Admin policy and directories

| Method/path | Access | Purpose |
|---|---|---|
| `GET /api/admin/settings` | staff | current policies |
| `PATCH /api/admin/settings` | admin | BLE kill switch, distance buffers, per-band geofence-logic strategy, seeding, student email domain, minimum app version |
| `GET /api/admin/geofences` | staff | active selectable buildings |
| `POST/PATCH/DELETE /api/admin/geofences/:id?` | admin | building polygon management |
| `GET/POST/DELETE /api/admin/lecturers/:id?` | admin | lecturer directory — `GET ?q=&page=&limit=`; `DELETE` hides (soft-deletes) rather than destroying |

## Background jobs and caches

- Non-recurring session expiry.
- Recurring-session `active` reset once each day's window closes.
- Stale/out-of-window broadcast closure.
- Out-of-window lecturer-code removal (every session, since every session has a code).
- Expired seed-token cleanup (verification independently checks leases).
- Expired attempt-verdict sweep (10-minute TTL).
- Short active-session cache invalidated on relevant staff mutations.
- OAuth exchange/nonces, GPS attempt fixes, and attempt verdicts are in-memory and
  therefore assume a single Node process; use a shared store before
  horizontal scaling.

## Testing

```bash
npm test -- --runInBand
```

250 tests across 17 suites, covering authentication, route access, BLE rotation and
broadcasting (including the previous-token grace vs. the broadcaster poll interval),
distance banding, the accuracy ceiling and accuracy-unknown normalisation, outlier
trimming, the code-escalation outcomes for every band, flag-reason rendering,
the geofence-logic strategy registry, the flagged-record Excel export,
running-course DTO contracts, strict schedules/one-time dates, GPS geometry and fix
filtering, active geofences, seeder eligibility, pages, and unified attendance. Keep
Android and server contract tests aligned whenever a response changes.

Not yet covered by a dedicated test: multi-batch course creation, the lecturer-owner path
through `assign-lecturer` (as opposed to the admin path), pagination on the three admin
list endpoints, the lecturer directory's staff-wide (not admin-only) access, the student
email domain gate, the
`minSupportedVersionCode` app-version check, the Collect/`activateSession` schedule-window
gate, the recurring-session window-close sweep, `isScheduledNow`/`getRunningSessionsForStaff`'s
active-independent window check, `sessionSortRank`'s "is this session's day today"
check (a real regression here already shipped once — a wrong-weekday session tied for
rank 0 whenever its time-of-day window happened to overlap the current clock time; fixed,
but the fix has no regression test yet), and the `any_point_within`/`median_distance`/
`best_accuracy_fix` geofence-logic strategies end-to-end through `POST /api/attendance`
(they're unit-tested directly against `geofenceLogic.service.js`, but not exercised
through a live GPS-band request the way `accuracy_weighted_centroid` is). Add contract
tests for these before relying on CI to catch a regression there.
