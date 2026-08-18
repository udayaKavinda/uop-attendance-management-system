# Design — Multi-Mode Attendance Verification

Status: **implemented** (server + Android), phases 1–5, verified against a real build —
server: `npm test`, 191/191 passing across 15 suites; Android: `./gradlew assembleDebug`,
full APK build green. Play Integrity / mock-location hardening is **explicitly out of
scope** by product decision, not an oversight — see the Security notes and Open Questions
below. A handful of practical deviations from the original text are called out inline
where they happen, each with its reasoning.

This document supersedes and merges two earlier drafts (`geofencing-and-seeding-design.md`
and `manual-attendance-code-design.md`); their content lives here now.

See also [`../server/README.md`](../server/README.md) and
[`../Android/README.md`](../Android/README.md) for the current (Bluetooth-only) system.

---

## Table of Contents

- [Goals](#goals)
- [Confirmed Decisions](#confirmed-decisions)
- [Concepts & Terminology](#concepts--terminology)
- [How the Four Verification Paths Relate](#how-the-four-verification-paths-relate)
- [Two-Tier Mode Model](#two-tier-mode-model)
- [Strictness Ladder & Buffers](#strictness-ladder--buffers)
- [Runtime Flows](#runtime-flows)
- [Peer Seeding](#peer-seeding)
- [Geofence Validation](#geofence-validation)
- [Manual Attendance Code](#manual-attendance-code)
- [Data Model Changes](#data-model-changes)
- [API Changes](#api-changes)
- [Admin Dashboard](#admin-dashboard)
- [Android App Changes](#android-app-changes)
- [Migration & Backward Compatibility](#migration--backward-compatibility)
- [Security & Robustness Notes](#security--robustness-notes)
- [Open Questions](#open-questions)
- [Phased Implementation Plan](#phased-implementation-plan)

---

## Goals

1. Let staff verify a student is *physically present* using **Bluetooth proximity**,
   **GPS geofence**, or **both**, selectable per session within limits the admin sets
   globally.
2. Let the admin draw **named building geofences** on a map and configure global
   attendance behaviour (allowed modes, GPS buffers, seeding).
3. Extend Bluetooth range/reliability inside a room by letting a few validated students
   **re-broadcast ("seed")** the rotating token — without any student knowing whether they
   were picked to seed.
4. Give lecturers a **human-readable manual code**, independent of which primary mode is
   active, as a last-resort fallback for a student whose device can't complete Bluetooth
   or GPS verification — without ever letting that fallback become the primary or only
   protection for anyone else.
5. Do all of this on **one shared data model** — one token pool, one attendance-provenance
   field — so the four verification paths compose instead of drifting into parallel,
   inconsistent implementations.

---

## Confirmed Decisions

| # | Decision |
|---|----------|
| 1 | **Capability-gated seeder selection.** The app reports whether the device can BLE-advertise when it submits attendance; the server only ever picks advertise-capable devices as real seeders. |
| 2 | **`seedRate` = target concurrent seeder count.** The server keeps roughly `seedRate` seeders broadcasting at once, topping the pool back up as windows expire. |
| 3 | **Decoys match the full duration.** A non-seeder's "seeding" window lasts exactly as long as a real seeder's, so the two are indistinguishable to the student. |
| 4 | **No seeding UI in geofence-only mode.** With no Bluetooth token there is nothing to seed, so neither real nor decoy windows appear. |
| 5 | **Settings apply-timing:** seeding params (`seedRate`, `seedWindowMs`) apply **immediately** to in-flight lectures; `allowedModes` changes apply to **new sessions only** so a running broadcast is never stranded. |
| 6 | **Manual code is a fallback, not a required-code model.** When enabled, Bluetooth/geofence verification keeps working unchanged; the code is an *additional* option, never a gate in front of the primary methods. |
| 7 | **Manual code and BLE token are separate secrets, never merged.** The BLE token stays a high-entropy internal value; the manual code is a shorter, human-typeable, and deliberately weaker value — treated as weaker everywhere downstream (rate limits, visibility, reporting). |
| 8 | **Manual code length: 8 numeric digits**, e.g. `12345678`, displayed grouped (`1234 5678`). The real defenses on this path are rotation frequency, single-occurrence scope, and rate limiting — not digit count (see [Open Questions](#open-questions)). |
| 9 | **Manual code is orthogonal to `verification` mode.** It's available regardless of whether the session is Bluetooth-only, geofence-only, or both — it doesn't depend on Bluetooth working, so it isn't restricted by decision #4. |
| 10 | **One attendance-provenance field.** `Attendance.acceptedVia` (`ble` \| `gps` \| `manual_code`) replaces the old single-value `method` field — no second, redundant field. |
| 11 | **Manual code has a global kill-switch**, `Settings.manualCodeAllowed`, mirroring `allowedModes`. Unlike `allowedModes` (decision 5, new-sessions-only), this gate applies **immediately** to every session, running or not — the whole point of a kill-switch is that an admin can shut off a leaked/abused code system-wide right now, not just prevent new sessions from adopting it. |

---

## Concepts & Terminology

- **Verification mode** — how a session's *primary* path confirms presence: `bluetooth`,
  `geofence`, or `both`.
- **Allowed modes** — the global admin setting that constrains which verification modes
  staff may pick for a session.
- **Building / geofence** — a named polygon the admin draws on a map (e.g. "Lecture Hall 1").
- **Buffer** — meters added outward to a geofence polygon before the inside/outside test,
  to absorb GPS error.
- **Token pool** — the set of all currently-live rotating secrets for a session: the
  lecturer's primary BLE token, any active seeder BLE tokens, and the manual attendance
  code, each stored as one entry with a `role`. A submitted BLE token is valid if it
  matches **any** live `primary`/`seed` token in the pool; a submitted manual code is
  checked against the pool's `manual` entry.
- **Seeder** — a validated student the server picked to re-broadcast a seeder BLE token.
- **Decoy** — every other validated student in a Bluetooth-involved mode; sees an
  identical seeding window but broadcasts nothing.
- **Manual attendance code** — the 8-digit lecturer-controlled fallback code.
- **`acceptedVia`** — the single field on each `Attendance` record recording exactly which
  method verified it: `ble`, `gps`, or `manual_code`.

---

## How the Four Verification Paths Relate

It helps to separate two axes that are easy to conflate:

- **Primary mode** (`verification` on the session) — Bluetooth, geofence, or both. This is
  what's *required* to pass automatically, and it's what the strictness ladder below is
  about.
- **Manual code** — a fallback layered on top, independent of which primary mode is
  active. It's not a fourth entry on the strictness ladder; it's a separate, always-weaker
  escape hatch a lecturer can turn on regardless of mode.

Peer seeding only ever extends the *Bluetooth* half of the primary mode — it has nothing
to do with geofence or the manual code.

---

## Two-Tier Mode Model

Primary-mode selection happens at two levels:

1. **Global (admin)** sets `allowedModes` ∈ { `bluetooth`, `geofence`, `both` }.
2. **Per session (lecturer/admin)** picks the session's `verification`, **constrained** by
   the global setting. The session-create UI only renders controls the global setting permits:

| `allowedModes` | Session-create UI shows | Session `verification` |
|----------------|-------------------------|------------------------|
| `bluetooth`    | Bluetooth broadcast only; geofence/building controls **hidden** | forced `bluetooth` |
| `geofence`     | Geofence/building controls only; Bluetooth broadcast **hidden** | forced `geofence` |
| `both`         | A mode picker (`bluetooth` / `geofence` / `both`) + geofence controls | chosen per session |

**Building dropdown visibility.** The multi-select building dropdown appears whenever the
session's mode **includes geofence** (`geofence` or `both`) — a geofence session needs at
least one building to test against.

**Manual code toggle** is a separate control shown regardless of `verification` mode (see
[Manual Attendance Code](#manual-attendance-code)).

---

## Strictness Ladder & Buffers

Two **global** buffer settings drive three levels of strictness on the *primary-mode*
ladder (the manual code sits outside this ladder entirely, as a fallback):

| Setting | Applies to | Relative size | Rationale |
|---------|-----------|---------------|-----------|
| `bufferGpsOnly`  | `geofence`-only sessions          | larger  | GPS is the *only* signal, so it needs a generous margin to avoid false rejections. |
| `bufferGpsBle`   | GPS fallback path in `both` sessions | smaller | Bluetooth already proves proximity, so the GPS check can be tighter and is not a loophole. |

Resulting ladder (least → most strict):

| Tier | Mode | Tolerance | Why |
|------|------|-----------|-----|
| **Least strict** | `geofence` only | `polygon + bufferGpsOnly` | loose GPS tolerance, spoofable |
| **Medium**       | `both`          | BLE token, else `polygon + bufferGpsBle` | tighter GPS fallback behind BLE |
| **Most strict**  | `bluetooth` only | rotating token, no buffer | requires physically receiving a short-range beacon |

The manual code, when enabled, is available as a fallback at **any** tier — it does not
change a session's tier or its automatic-acceptance tolerance.

---

## Runtime Flows

The three primary-mode flows run a **continuous 90-second window** on the student device.
The server holds off the "accepted" response until its condition is met; the client keeps
submitting until accepted or the window ends. The manual code is a fourth, orthogonal
path available in parallel with whichever primary flow is running.

### 1. Geofence only
- The app streams **high-accuracy GPS fixes** to the server for up to 90 s.
- On each new fix the server re-evaluates the student's aggregate position
  (see [Geofence Validation](#geofence-validation)).
- When the aggregate lands inside `polygon + bufferGpsOnly`, the server returns **accepted**.
- No seeding (decision 4).

### 2. Bluetooth only
- The app scans BLE for up to 90 s for the `UOPA` beacon.
- On recovering a token it submits for verification against the session's `primary`/`seed`
  token pool entries.
- On a valid token → **accepted**, then seeder selection runs (see [Peer Seeding](#peer-seeding)).

### 3. Both
- The app scans BLE **and** streams GPS simultaneously.
- If it recovers a BLE token → verify it → **accepted** (BLE path).
- If no token appears, the GPS aggregate is evaluated against `polygon + bufferGpsBle`;
  when satisfied → **accepted** (GPS path).
- **Either** path makes the student eligible for seeder selection — a GPS-validated student
  in a BLE dead zone can become a new BLE source, extending coverage.

> **Note (accepted tradeoff):** `both` uses **OR** logic — a student passes with BLE *or*
> GPS. This is deliberately student-friendly but means `both`'s guarantee equals its *weaker*
> satisfied path, not the stronger.

### 4. Manual code (orthogonal, any tier)
- Independent of which of the three flows above is running, if manual-code mode is
  enabled for the session, the student may at any time tap **Enter attendance code** and
  type the 8 digits instead of waiting on BLE/GPS.
- The server validates: session running, `Settings.manualCodeAllowed` is `true`,
  `session.manualCodeEnabled` is `true`, code matches the live `manual` pool entry (or the
  grace-window previous code, automatic-rotation ticks only), student not already marked
  → **accepted** via `acceptedVia: "manual_code"`.
- If either the global switch or the per-session toggle is off, this path does not exist
  client-side, and the server rejects any submitted code regardless — including a code
  that was valid earlier in the same session before being disabled.

---

## Peer Seeding

### Per-Seeder Tokens & The Token Pool
The token pool (see [Data Model Changes](#data-model-changes)) generalizes what today is a
single token per session into multiple entries:

- The lecturer advertises the **primary token** (`role: 'primary'`, `owner: null`).
- Each selected seeder mints and advertises a **seeder token** (`role: 'seed'`, `owner: <student>`),
  unique to that `(student, session)` pair, rotating on the same 15 s cadence with the 2 s
  grace window.
- A student's submitted BLE token is accepted if it matches **any** live `primary`/`seed`
  entry in the pool (current or grace `prevToken`).
- Per-seeder tokens let the server **attribute** which beacon a scan came from and
  **revoke one seeder** (when their window ends or heartbeat dies) without touching others.

### Seeder Selection (server-driven)
When a student is validated via BLE or GPS, the server decides their seeding role:

```
onValidated(student, session):
  if session.mode == geofence-only:        role = none        # decision 4
  else if not student.canAdvertise:        role = decoy       # decision 1
  else if liveSeederCount(session) < seedRate:                # decision 2
        role = seeder
        mint seeder token, add to pool
  else:                                    role = decoy
```

- `seedRate` is the **target concurrent** seeder count. As seeder windows expire the live
  count drops and later-validated students top it back up — the pool self-heals around
  `seedRate`.
- `canAdvertise` is reported by the client at submit time (`isMultipleAdvertisementSupported`);
  incapable devices are always decoys.

### The Decoy Window (concealment)
- **Seeder:** receives `role: "seed"`, a seeder token + advertised device name, and a window
  of `seedWindowMs`. The app advertises the token (re-fetching it every ~5 s) for the window,
  then shows success.
- **Decoy:** receives `role: "decoy"` and a window of **the same `seedWindowMs`** (decision 3),
  **no token**. The app shows an identical progress window that does nothing, then success.

Because durations and UI are identical, no student can tell whether they seeded. The success
("Attendance marked") screen appears only after the window elapses in both cases.

### Seeder Lifecycle
- Seeder token minted on selection with a lease of `seedWindowMs`.
- The seeding phone re-fetches its token every ~5 s (rotation + **heartbeat**), mirroring the
  lecturer broadcast loop.
- Token removed from the pool when the window elapses, the heartbeat goes stale, or the
  session's broadcast/window closes.

---

## Geofence Validation

Server-side, per `(student, session, day)`, the server buffers incoming fixes and on each new
fix computes an aggregate position:

1. Require **≥ 4 fixes** before deciding.
2. **Remove outliers by median distance** — compute the median location and drop fixes far
   from it.
3. **Accuracy-weighted centroid** — average the survivors, weighting each fix by its reported
   accuracy (precise fixes dominate).
4. Accept if that centroid is inside `polygon + buffer` (buffer per mode).

> **Deferred (owner to revisit).** Two known robustness gaps in the above — (a) rejecting
> fixes whose reported accuracy exceeds the buffer, and (b) requiring recency/consistency
> rather than trusting the centroid alone — are **intentionally not addressed here**. The
> algorithm is documented exactly as specified; these rules will be refined later.

---

## Manual Attendance Code

### Global kill-switch
`Settings.manualCodeAllowed` (default `true`) gates the feature system-wide, independent
of the per-session toggle below. Turning it off:
- Immediately hides the manual-code UI (session config, Sessions-tab card) for **every**
  session, including ones already running with it enabled — not just new sessions.
- Immediately makes the server reject any submitted manual code, even a currently-valid
  one, for the same reason a per-session disable does (see [Rotation behaviour](#rotation-behaviour)).
- Does **not** delete or alter per-session `manualCodeEnabled` values — a session that had
  it on keeps that setting dormant, and it resumes working the moment the admin flips the
  global switch back on, with no need to re-enable it per session.

This is intentionally a harder, faster gate than `allowedModes`: `allowedModes` changes
only apply to new sessions (decision 5) because a running BLE/geofence broadcast shouldn't
be stranded mid-lecture, but a kill-switch that only helps *future* sessions defeats the
purpose of having one — if a code leaks or the feature is being abused, the admin needs to
be able to shut it off for everyone, right now.

### Per-session configuration
- **Manual attendance code** — enabled or disabled, independent of `verification` mode,
  and further gated by the global switch above (effective availability is
  `Settings.manualCodeAllowed AND session.manualCodeEnabled`).
- **Code rotation** — `none` (one code for the whole occurrence) or `interval` (rotates
  every configurable N seconds).

### Rotation behaviour
- Starting a session always mints a brand-new code, whether or not rotation is enabled —
  there's no permanent code reused week to week.
- Ending the session invalidates the code immediately.
- **Resuming a paused rotation regenerates the code immediately** — a code shared during
  the pause must not remain valid after resume.
- **Changing the rotation interval mid-session also rotates immediately** and restarts the
  interval from that point.
- **Grace window:** the previous code is accepted for 2–5 seconds after an automatic
  rotation boundary — reusing the same grace-window pattern the BLE token already has
  (`GRACE_MS = 2000` in `bluetoothCode.service.js`), applied to the pool's `manual` entry.
- **No grace window on manual regeneration.** When staff hits "Generate new code," the
  previous code stops working immediately — that action typically means the old code was
  already exposed.

### Staff dashboard UI

Session configuration:

```
Manual attendance code       [Enabled]

Code rotation
( ) No rotation
(•) Rotate every [60] seconds
```

Sessions tab — hidden by default (dashboards get projected):

```
Attendance code        [Show code]
```

Revealed:

```
1234 5678

Next rotation: 00:42
[Pause rotation] [Generate new code] [Hide]
```

Paused:

```
1234 5678
Rotation paused
[Resume rotation] [Generate new code]
```

### Student workflow
See [Runtime Flows → 4. Manual code](#4-manual-code-orthogonal-any-tier).

---

## Data Model Changes

### New — `Settings` (singleton)
One document, admin-editable.

| Field | Type | Notes |
|-------|------|-------|
| `allowedModes` | enum `bluetooth`\|`geofence`\|`both` | constrains session `verification`; applies to **new sessions only** |
| `seedWindowMs` | Number | real & decoy seeding window duration |
| `seedRate` | Number | target concurrent seeder count (`0` disables seeding) |
| `bufferGpsOnly` | Number (m) | buffer for geofence-only sessions |
| `bufferGpsBle` | Number (m) | buffer for the GPS fallback in `both` sessions |
| `manualCodeAllowed` | Boolean | global kill-switch for manual codes, default `true`; applies **immediately** to every session — see decision 11 |

### New — `Geofence` (building)
| Field | Type | Notes |
|-------|------|-------|
| `name` | String | e.g. "Lecture Hall 1" |
| `polygon` | [[Number, Number]] | ordered `[lng, lat]` vertices |
| `active` / `deleted` | Boolean | standard flags |

### Changed — `LectureSession`
Add:
| Field | Type | Notes |
|-------|------|-------|
| `verification` | enum `bluetooth`\|`geofence`\|`both` | default `bluetooth` |
| `buildings` | [ObjectId] ref `Geofence` | required when mode includes geofence |
| `manualCodeEnabled` | Boolean | default `false`; independent of `verification` |
| `manualCodeRotationMode` | enum `none`\|`interval` | |
| `manualCodeRotationSeconds` | Number | only meaningful when `interval` |

Existing `broadcasting` / `lastBroadcastSeenAt` / `bluetoothDeviceName` remain for the
Bluetooth path.

### Changed — `BleToken` → generalized token pool
One collection now holds every live rotating secret for a session, not just the primary
BLE token:

| Field | Type | Notes |
|-------|------|-------|
| `session` | ObjectId | (replaces bare `sessionId` key) |
| `owner` | ObjectId ref `Person`, nullable | `null` = primary or manual (lecturer-controlled); set = seeder |
| `role` | enum `primary`\|`seed`\|`manual` | |
| `token` / `prevToken` / `generatedAt` | — | rotation fields; `manual` entries use an 8-digit numeric value instead of hex |
| `leaseUntil` | Date | for seeder tokens (window end) |
| `paused` | Boolean | `manual` entries only — freezes rotation without invalidating the current code |

Unique key becomes `{ session, owner, role }`. Verification queries the live set for the
session and role.

### Changed — `Attendance`
- `acceptedVia` (replaces `method`) → enum `ble` \| `gps` \| `manual_code`.
- Optional audit fields for the GPS path: aggregate centroid / accuracy / fix count.
- Visible **per record** in the matrix/roster, not just aggregated — so a lecturer can see
  exactly how each student was verified.

### New — GPS fix buffer (transient)
Per `(student, session, day)` accumulator of recent fixes for the centroid computation.
In-memory `Map` for a single process (same scaling caveat as the OAuth code store and
session cache — move to Redis for horizontal scaling).

---

## API Changes

### Student
| Method | Path | Change |
|--------|------|--------|
| GET | `/api/courses/running` | payload adds each session's `verification`, `buildings`, `manualCodeEnabled`, and settings-derived buffers as needed |
| POST | `/api/attendance` *(unified — replaces/aliases `/api/bluetooth-attendance`)* | body `{ courseId, token?, fixes?[], manualCode?, canAdvertise }` → `{ status: "pending" \| "accepted", duplicate?, seeding? }` |
| GET  | `/api/attendance/seed-token?sessionId=` | seeder re-fetch: current seeder token + `rotatesIn`; stamps heartbeat; auto-ends after window |

`seeding` block on acceptance:
```json
{ "role": "seed" | "decoy", "durationMs": 60000, "token": "…", "deviceName": "UOP-…" }
```
`token`/`deviceName` present only for `role: "seed"`.

### Staff — Manual code (session-scoped, course-authorized)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/sessions/:id/manual-code` | current code + rotation state (paused/interval/next-rotation). Never exposed on any student-facing or public endpoint. |
| PATCH | `/api/admin/sessions/:id/manual-code` | enable/disable, change rotation mode/interval, pause/resume, or force-regenerate |

### Admin — Settings
| Method | Path | Description |
|--------|------|-------------|
| GET   | `/api/admin/settings` | current global settings |
| PATCH | `/api/admin/settings` | update allowedModes / buffers / seeding params / `manualCodeAllowed` (takes effect immediately — see [Manual Attendance Code → Global kill-switch](#global-kill-switch)) |

### Admin — Geofences
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/admin/geofences` | list / create (name + polygon) |
| PATCH/DELETE | `/api/admin/geofences/:id` | rename / redraw / soft-delete |

### Staff — Sessions
- Create/update session accepts `verification` (validated against `allowedModes`),
  `buildings` (required when mode includes geofence), and `manualCodeEnabled` /
  `manualCodeRotationMode` / `manualCodeRotationSeconds` (independent of `verification`).

---

## Admin Dashboard

Two new admin-only areas:

1. **Global settings screen** — edit `allowedModes`, `seedWindowMs`, `seedRate`,
   `bufferGpsOnly`, `bufferGpsBle`. Copy should explain the strictness ladder.
2. **Geofence map tool** — a map with polygon-draw to create/edit/name buildings
   (`Geofence` CRUD). Requires a map component (e.g. Leaflet / Maps SDK) and a tile source;
   confirm tile origin against the app's network/CSP allowlist. This is a substantial new
   frontend piece.

The manual code's staff controls (show/hide, pause/resume, regenerate) live on the
existing Sessions tab per-session card, not in a separate admin area — see
[Manual Attendance Code](#manual-attendance-code).

---

## Android App Changes

- **DTOs:** running-course payload gains `verification` + `buildings` +
  `manualCodeEnabled`; attendance response gains the `seeding` block; new
  settings/geofence/manual-code admin DTOs.
- **Student flow:**
  - Branch on `verification`: BLE scan, GPS stream, or both, over a 90 s window.
  - GPS: high-accuracy fused location updates streamed to `/api/attendance`.
  - Report `canAdvertise` (`isMultipleAdvertisementSupported`) at submit.
  - **Seeding window UI:** progress ring + delayed success. Real seeders advertise via the
    existing `BleAdvertiser` (re-fetching the seeder token every ~5 s); decoys run the same
    UI with no broadcast. Skipped entirely in geofence-only mode.
  - **Manual code entry:** an "Enter attendance code" option available alongside the
    automatic scan/stream, any time `manualCodeEnabled` is true for the session — not
    gated by `verification` mode.
- **Staff create-session:** mode picker + building multi-select, both gated by the global
  `allowedModes`; a separate manual-code enabled/rotation toggle, ungated. No buffer UI
  (global-only).
- **Staff Sessions tab:** manual-code card (hidden-by-default reveal, pause/resume,
  regenerate) alongside the existing broadcast card.
- **Admin:** settings screen + geofence map tool (likely a `WebView`-hosted map or a Maps SDK).
- **Permissions:** add runtime `ACCESS_FINE_LOCATION` for the GPS path; `BLUETOOTH_ADVERTISE`
  (API 31+) is already needed for the lecturer broadcast and now also for student seeders.

---

## Migration & Backward Compatibility

- **Startup migration:** set `verification = 'bluetooth'` on existing sessions;
  `manualCodeEnabled = false`; seed a `Settings` document with `allowedModes = 'bluetooth'`,
  `seedRate = 0` (seeding off), `manualCodeAllowed = true` (the global switch defaults
  open; the per-session toggle is what actually keeps the feature dormant), and default
  buffers. With `seedRate = 0` and `manualCodeEnabled = false` everywhere, current UX is
  fully preserved until an admin or lecturer opts in.
- **`BleToken` → token pool:** migrate existing rows to `{ session, owner: null, role: 'primary' }`.
- **`Attendance`:** existing rows get `acceptedVia = 'ble'` (derived from the old
  `method: 'bluetooth'`); `gps` and `manual_code` are additive.
- **Endpoint:** keep `/api/bluetooth-attendance` as an alias of the unified
  `/api/attendance` during rollout, or bump the app in lockstep.

---

## Security & Robustness Notes

Documented so they are not forgotten; several are deferred by decision.

- **GPS indoors is the dominant real-world risk** — concrete rooms degrade or block GPS, so
  geofence-only will produce false rejections. Mitigations: generous `bufferGpsOnly`, the full
  90 s to settle, steering hard rooms toward `both`/Bluetooth.
- **Location + accuracy are client-reported and spoofable.** Accuracy weighting trusts a value
  the client controls; outlier removal only defeats random noise, not consistent lies. Real
  geofence security depends on **mock-location detection + Play Integrity** — recommended for
  the geofence path, **not yet scoped**.
- **`both` = OR** gives the weaker of the two guarantees per student (see runtime note).
- **BLE token relay** (real-time internet relay of a live token) remains possible in
  Bluetooth-only; 15 s rotation shrinks but does not close the window.
- **Manual code sharing does not prove physical presence.** This is the accepted tradeoff of
  the fallback model — mitigated by keeping it off by default (both the global
  `manualCodeAllowed` switch and the per-session toggle), staff-controlled visibility,
  per-`(student, session)` attempt limits reusing the existing `studentRecordLimiter`
  pattern, cryptographically secure code generation, per-record `acceptedVia` visibility
  in reporting so it's never conflated with device-verified attendance, and the ability to
  shut the whole feature off instantly system-wide if it's ever being abused.
- **Audit logging is new scope, not a small add.** "Code viewed / paused / resumed /
  regenerated" implies a persistent event log that doesn't exist anywhere in the system
  today — needs an explicit v1-vs-deferred decision, not an assumed detail.
- **Single-process state** (GPS buffers, token pool, seeder pool, session cache) needs Redis
  before horizontal scaling.
- **Geofence validation rule gaps** — deferred by owner (see
  [Geofence Validation](#geofence-validation)).

---

## Open Questions

All resolved by implementation, kept here as a record of the decision:

1. **Building dropdown trigger — resolved: geofence.** Implemented in the session validator
   (`buildings` required when `verification !== 'bluetooth'`), matching this design's
   assumption over the earlier requirement draft's literal wording.
2. **Play Integrity / mock-location — resolved: out of scope.** Explicit product decision,
   not deferred-by-default. The geofence path stays spoofable via client-reported location,
   same as flagged in Security notes. Revisit only if abuse is actually observed.
3. **Unified vs dual endpoints — resolved: unified, with aliases.** `POST /api/attendance`
   handles token/fix/code; `/api/bluetooth-attendance` and `/api/manual-attendance` remain
   as thin aliases per the rollout guidance, so nothing already deployed had to change.
4. **Seeder token rotation source — resolved: server-authoritative**, as designed. The
   client re-fetches via `GET /api/attendance/seed-token`, never rotates locally.
5. **8 digits vs. 6 for the manual code — resolved: 8**, implemented as a UX/comfort choice.
   Both are effectively unguessable given rotation + rate limiting either way — digit count
   was never the load-bearing defense here.
6. **Manual code audit logging — resolved: fast-follow, not v1.** Still not implemented;
   remains the one explicitly-deferred piece of the whole design (see phase 1's status note).

---

## Phased Implementation Plan

Each phase is independently shippable. Manual code moves first since it's the smallest and
does the token-pool generalization every later phase needs.

1. **Manual attendance code.** `manualCodeEnabled`/rotation fields on `LectureSession`; a
   `Settings` singleton seeded with `manualCodeAllowed` (default `true`); staff manual-code
   endpoints and Sessions-tab UI.

   > **Status: implemented** (server + Android; 39 tests). One deviation from the plan
   > above, made for practicality rather than building ahead of actual need at the time:
   > the manual code got its own small `ManualCode` collection instead of folding into
   > `BleToken`'s `owner`/`role` up front. That generalization happened for real in phase 4
   > below, once peer seeding actually needed multiple concurrent token owners — so the
   > two features now share one token-pool model, just built in the order the need for it
   > actually arose rather than speculatively in phase 1.
   >
   > Also implemented, matching the design: the per-`(student, session)` guess limiter
   > (5 attempts / 2-minute lockout, layered on top of the existing rate limiter), the
   > out-of-window sweep that invalidates a recurring session's code between occurrences,
   > and the global kill-switch's session-level override in both the GET status response
   > and the student submission path. **Not implemented** (explicitly deferred, per the
   > design's own "v1 or fast-follow?" open question): audit logging of code
   > view/pause/resume/regenerate events.

2. **Server foundation for modes.** `Settings` grows `allowedModes` + `seedRate`/
   `seedWindowMs`/`bufferGpsOnly`/`bufferGpsBle`; `verification`/`buildings` added to
   `LectureSession`; `allowedModes` constraint enforced in the session validator/service.

   > **Status: implemented** (server + Android; 11 tests). One access-control refinement
   > made during implementation, not originally specified: `GET /api/admin/settings` and
   > `GET /api/admin/geofences` were widened from admin-only to **staff-readable**
   > (`requireStaff`, matching the existing `/admin/courses` and `/admin/sessions` read
   > pattern) — a lecturer needs `allowedModes` to render the create-session mode picker
   > correctly and the building list to pick from, even though only admins *write* either.
   > Writes (`PATCH`/`POST`/`DELETE`) stayed admin-only throughout.

3. **Geofence core.** `Geofence` model (real polygons, `[[lng,lat], ...]`) + admin CRUD;
   GPS fix buffering, median-distance outlier removal, accuracy-weighted centroid,
   point-in-polygon-plus-buffer test; wired into a **unified `POST /api/attendance`**
   endpoint alongside the BLE and manual-code paths, with `/api/bluetooth-attendance` and
   `/api/manual-attendance` kept as thin aliases per the design's rollout guidance.

   > **Status: implemented** (server: `Geofence` model, `utils/geo.js` geometry,
   > `services/gpsFix.service.js`, unified endpoint — 41 tests; Android: `GpsLocationSource`
   > + mode-branching in the student flow). Two deviations:
   > - **`Attendance.method` kept as the one provenance field**, extended with a `'gps'`
   >   value (`'bluetooth' | 'gps' | 'manual_code'`), rather than introducing a separate
   >   `acceptedVia` field as phase 1's note had flagged for "when GPS actually exists."
   >   On reflection, a rename would have been pure churn — `method` already does exactly
   >   the job once it has all three values, and a second field would just be two names
   >   for the same concept.
   > - **GPS fixes come from the platform `LocationManager`**, not the Play Services
   >   `FusedLocationProviderClient` the design's Android-changes section assumed. This
   >   avoids adding a new Play Services dependency for a feature that only needs periodic
   >   fixes over a 90s window, not battery-optimized continuous tracking — `LocationManager`
   >   covers that without it.

4. **Peer seeding.** `BleToken` generalized into the token pool (`owner`/`role`:
   `primary`/`seed`) the design always intended; seeder selection (server-driven, matching
   the pseudocode exactly); seed-token re-fetch + heartbeat endpoint; decoy concealment
   (identical duration, no token). Android: `BleAdvertiser` reused for seeder broadcasting;
   decoy windows show identical UI with no radio activity.

   > **Status: implemented** (server: `peerSeeding.service.js`, generalized
   > `bluetoothCode.service.js` — 11 new + 16 updated tests, all passing; Android: seeding
   > window in `LectureEntryViewModel`). Matches the design as written — the token-pool
   > generalization this phase needed is exactly what phase 1 deferred, done here instead
   > of speculatively earlier.

5. **Admin map tool + hardening.** Building polygon-draw tool; attendance-matrix audit
   surfacing across all `method` values; README updates.

   > **Status: implemented** (Android: `GeofenceMapScreen.kt`, a WebView hosting
   > **Leaflet + OpenStreetMap tiles** — chosen over the Google Maps SDK because it needs
   > no API key or billing account, while still being the real polygon-draw tool the
   > design asked for, not a simplified circle/coordinate-entry substitute). Tap-to-add
   > vertices, undo/clear, save via a JS↔Kotlin bridge to the same `Geofence` CRUD API
   > admins and lecturers both read from.
   >
   > **Not implemented, by explicit product decision, not oversight:** Play Integrity /
   > mock-location detection. The geofence path's location and accuracy values remain
   > client-reported and spoofable, exactly as the Security notes above already warned —
   > this was a deliberate scope cut to ship the rest of the system, not something that
   > slipped through. Revisit if geofence-mode abuse is observed in practice.
