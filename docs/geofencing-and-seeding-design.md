# Design — Verification Modes, Geofencing & Peer Seeding

Status: **draft / not implemented**. This document describes the planned evolution of the
UOP Attendance system from a Bluetooth-only handshake to a configurable **multi-mode**
attendance system (Bluetooth, geofence, or both) with **peer token seeding**. Nothing here
is built yet; it is the agreed design to implement against.

See also [`../server/README.md`](../server/README.md) and
[`../Android/README.md`](../Android/README.md) for the current (Bluetooth-only) system.

---

## Table of Contents

- [Goals](#goals)
- [Confirmed Decisions](#confirmed-decisions)
- [Concepts & Terminology](#concepts--terminology)
- [Two-Tier Mode Model](#two-tier-mode-model)
- [Strictness Ladder & Buffers](#strictness-ladder--buffers)
- [Runtime Flows](#runtime-flows)
- [Peer Seeding](#peer-seeding)
- [Geofence Validation](#geofence-validation)
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

---

## Confirmed Decisions

These were agreed during design and are treated as fixed inputs below.

| # | Decision |
|---|----------|
| 1 | **Capability-gated seeder selection.** The app reports whether the device can BLE-advertise when it submits attendance; the server only ever picks advertise-capable devices as real seeders. |
| 2 | **`seedRate` = target concurrent seeder count.** The server keeps roughly `seedRate` seeders broadcasting at once, topping the pool back up as windows expire. |
| 3 | **Decoys match the full duration.** A non-seeder's "seeding" window lasts exactly as long as a real seeder's, so the two are indistinguishable to the student. |
| 4 | **No seeding UI in geofence-only mode.** With no Bluetooth token there is nothing to seed, so neither real nor decoy windows appear. |
| 5 | **Settings apply-timing:** seeding params (`seedRate`, `seedWindowMs`) apply **immediately** to in-flight lectures; `allowedModes` changes apply to **new sessions only** so a running broadcast is never stranded. |

---

## Concepts & Terminology

- **Verification mode** — how a session confirms presence: `bluetooth`, `geofence`, or `both`.
- **Allowed modes** — the global admin setting that constrains which verification modes
  staff may pick for a session.
- **Building / geofence** — a named polygon the admin draws on a map (e.g. "Lecture Hall 1").
- **Buffer** — meters added outward to a geofence polygon before the inside/outside test,
  to absorb GPS error. Two global values (see [Buffers](#strictness-ladder--buffers)).
- **Primary token** — the rotating BLE token advertised by the lecturer's phone (today's model).
- **Seeder token** — a rotating BLE token minted **per seeding student per session**, advertised
  by that student's phone.
- **Token pool** — the set of all currently-live tokens for a session (primary + all seeder
  tokens). A submitted token is valid if it matches **any** live token in the pool.
- **Seeder** — a validated student the server picked to re-broadcast a seeder token.
- **Decoy** — every other validated student; sees an identical seeding window but broadcasts
  nothing.

---

## Two-Tier Mode Model

Mode selection happens at two levels:

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
least one building to test against. *(Open question: the requirement text said "if bluetooth
is enabled"; this design assumes that was a slip and means "if geofence is enabled." See
[Open Questions](#open-questions).)*

---

## Strictness Ladder & Buffers

Two **global** buffer settings drive three levels of strictness:

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

---

## Runtime Flows

All three flows run a **continuous 90-second window** on the student device. The server
holds off the "accepted" response until its condition is met; the client keeps submitting
until accepted or the window ends.

### 1. Geofence only
- The app streams **high-accuracy GPS fixes** to the server for up to 90 s.
- On each new fix the server re-evaluates the student's aggregate position
  (see [Geofence Validation](#geofence-validation)).
- When the aggregate lands inside `polygon + bufferGpsOnly`, the server returns **accepted**.
- No seeding (decision 4).

### 2. Bluetooth only
- The app scans BLE for up to 90 s for the `UOPA` beacon.
- On recovering a token it submits for verification against the session token pool.
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
> satisfied path, not the stronger. If `both` should ever mean "in the room **and** has the
> token," that is an AND change, out of scope for this design.

---

## Peer Seeding

### Per-Seeder Tokens & The Token Pool
Today there is one rotating token per session (the lecturer's). This design generalizes to a
**pool**:

- The lecturer advertises the **primary token**.
- Each selected seeder mints and advertises a **seeder token**, unique to that
  `(student, session)` pair, rotating on the same 15 s cadence with the 2 s grace window.
- A student's submitted token is accepted if it matches **any** live token in the pool
  (current or grace `prevToken`), primary or seeder.
- Seeder-specific tokens let the server **attribute** which beacon a scan came from and
  **revoke one seeder** (when their window ends or heartbeat dies) without touching others.

### Seeder Selection (server-driven)
When a student is validated (BLE or GPS), the server decides their seeding role:

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

## Data Model Changes

### New — `Settings` (singleton)
One document, admin-editable.

| Field | Type | Notes |
|-------|------|-------|
| `allowedModes` | enum `bluetooth`\|`geofence`\|`both` | constrains session modes |
| `seedWindowMs` | Number | real & decoy window duration |
| `seedRate` | Number | target concurrent seeder count (`0` disables seeding) |
| `bufferGpsOnly` | Number (m) | buffer for geofence-only sessions |
| `bufferGpsBle` | Number (m) | buffer for the GPS fallback in `both` sessions |

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

Existing `broadcasting` / `lastBroadcastSeenAt` / `bluetoothDeviceName` remain for the
Bluetooth path.

### Changed — `Attendance`
- `method` enum → `bluetooth` | `geofence`.
- Optional audit fields for the GPS path: `acceptedVia` (`ble`|`gps`), and (optional)
  aggregate centroid / accuracy / fix count.

### Changed — `BleToken` (token pool)
Support multiple tokens per session:
| Field | Type | Notes |
|-------|------|-------|
| `session` | ObjectId | (replaces bare `sessionId` key) |
| `owner` | ObjectId ref `Person`, nullable | `null` = primary (lecturer); set = seeder |
| `role` | enum `primary`\|`seed` | |
| `token` / `prevToken` / `generatedAt` | — | unchanged rotation fields |
| `leaseUntil` | Date | for seeder tokens (window end) |

Unique key becomes `{ session, owner }`. Verification queries the live set for the session.

### New — GPS fix buffer (transient)
Per `(student, session, day)` accumulator of recent fixes for the centroid computation.
In-memory `Map` for a single process (same scaling caveat as the OAuth code store and
session cache — move to Redis for horizontal scaling).

---

## API Changes

### Student
| Method | Path | Change |
|--------|------|--------|
| GET | `/api/courses/running` | payload adds each session's `verification`, `buildings` (id+name+polygon or a lookup), and settings-derived buffers as needed |
| POST | `/api/attendance` *(unified — replaces/aliases `/api/bluetooth-attendance`)* | body `{ courseId, token?, fixes?[], canAdvertise }` → `{ status: "pending" \| "accepted", duplicate?, seeding? }` |
| GET  | `/api/attendance/seed-token?sessionId=` | seeder re-fetch: current seeder token + `rotatesIn`; stamps heartbeat; auto-ends after window |

`seeding` block on acceptance:
```json
{ "role": "seed" | "decoy", "durationMs": 60000, "token": "…", "deviceName": "UOP-…" }
```
`token`/`deviceName` present only for `role: "seed"`.

### Admin — Settings
| Method | Path | Description |
|--------|------|-------------|
| GET   | `/api/admin/settings` | current global settings |
| PATCH | `/api/admin/settings` | update allowedModes / buffers / seeding params |

### Admin — Geofences
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/admin/geofences` | list / create (name + polygon) |
| PATCH/DELETE | `/api/admin/geofences/:id` | rename / redraw / soft-delete |

### Staff — Sessions
- Create/update session accepts `verification` (validated against `allowedModes`) and
  `buildings` (required when mode includes geofence).

---

## Admin Dashboard

Two new admin-only areas:

1. **Global settings screen** — edit `allowedModes`, `seedWindowMs`, `seedRate`,
   `bufferGpsOnly`, `bufferGpsBle`. Copy should explain the strictness ladder.
2. **Geofence map tool** — a map with polygon-draw to create/edit/name buildings
   (`Geofence` CRUD). Requires a map component (e.g. Leaflet / Maps SDK) and a tile source;
   confirm tile origin against the app's network/CSP allowlist. This is a substantial new
   frontend piece.

---

## Android App Changes

- **DTOs:** running-course payload gains `verification` + `buildings`; attendance response
  gains the `seeding` block; new settings/geofence admin DTOs.
- **Student flow:**
  - Branch on `verification`: BLE scan, GPS stream, or both, over a 90 s window.
  - GPS: high-accuracy fused location updates streamed to `/api/attendance`.
  - Report `canAdvertise` (`isMultipleAdvertisementSupported`) at submit.
  - **Seeding window UI:** progress ring + delayed success. Real seeders advertise via the
    existing `BleAdvertiser` (re-fetching the seeder token every ~5 s); decoys run the same
    UI with no broadcast. Skipped entirely in geofence-only mode.
- **Staff create-session:** mode picker + building multi-select, both gated by the global
  `allowedModes`. No buffer UI (global-only).
- **Admin:** settings screen + geofence map tool (likely a `WebView`-hosted map or a Maps SDK).
- **Permissions:** add runtime `ACCESS_FINE_LOCATION` for the GPS path; `BLUETOOTH_ADVERTISE`
  (API 31+) is already needed for the lecturer broadcast and now also for student seeders.

---

## Migration & Backward Compatibility

- **Startup migration:** set `verification = 'bluetooth'` on existing sessions; seed a
  `Settings` document with `allowedModes = 'bluetooth'`, `seedRate = 0` (seeding off),
  and default buffers. With `seedRate = 0` no seeder/decoy window appears, so current UX
  is preserved until an admin opts in.
- **BleToken:** migrate existing rows to `{ session, owner: null, role: 'primary' }`.
- **Attendance:** `method` stays `bluetooth` for existing rows; `geofence` is additive.
- **Endpoint:** keep `/api/bluetooth-attendance` as an alias of the unified `/api/attendance`
  during rollout, or bump the app in lockstep.

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
- **Single-process state** (GPS buffers, token pool, seeder pool, session cache) needs Redis
  before horizontal scaling.
- **Geofence validation rule gaps** — deferred by owner (see
  [Geofence Validation](#geofence-validation)).

---

## Open Questions

1. **Building dropdown trigger** — confirm it should show when **geofence** is enabled (this
   design's assumption), not Bluetooth as the requirement text literally said.
2. **Play Integrity / mock-location** — in scope for the first geofence release, or deferred?
3. **Unified vs dual endpoints** — adopt a single `/api/attendance` (recommended) or keep
   separate BLE + GPS submit endpoints?
4. **Seeder token rotation source** — server-authoritative re-fetch (this design) vs
   client-side rotation from a seed (rejected: scanners must validate against the server).

---

## Phased Implementation Plan

Each phase is independently shippable.

1. **Server foundation** — `Settings` singleton + admin settings API; `verification` on
   sessions; startup migration; `allowedModes` constraint in the session validator. No client
   behaviour change yet (defaults preserve Bluetooth-only).
2. **Geofence core** — `Geofence` model + admin CRUD; GPS submit path; centroid validation
   (as specified); `both`/`geofence` acceptance. Android GPS streaming + mode branching +
   staff building/mode UI.
3. **Peer seeding** — token pool (`BleToken` owner/role); seeder selection; seed-token
   re-fetch endpoint; Android seeding + decoy windows and student advertising.
4. **Admin map tool + hardening** — map polygon-draw for buildings; mock-location/integrity
   (if scoped); attendance-matrix audit surfacing; README updates.
