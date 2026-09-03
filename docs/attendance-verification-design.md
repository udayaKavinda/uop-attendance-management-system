# Attendance Verification Design — Implemented System

Status: implemented. This document describes the system as built, not a proposal.

## The model in one paragraph

Every lecture session verifies attendance the same way. There is no per-session policy
to choose. When a student checks in, their phone spends up to 90 seconds listening for
the lecturer's Bluetooth beacon *and* streaming GPS fixes at the same time; either one
can pass them, and the first to succeed ends the window. If Bluetooth is off, the app
fires the system "turn on Bluetooth?" prompt (both on the first attempt and every
**Try again**) and gives the radio a brief moment to actually come on before the window
starts — GPS runs regardless of what the student picks, so the prompt never blocks or
delays it. If neither radio produces a pass, the student is offered **Try again**
(another 90 seconds) or **Get help**, which asks for the 8-digit code the lecturer reads
out. What that code grants depends on how far from the building the student's GPS put
them — close enough and it passes them outright, too far and the attempt is flagged for
whoever later reads the attendance export, not queued for anyone to act on.

## Explicit product boundaries

- Course discovery is campus-wide. No enrolment/registration source exists in this
  repository, so the server does not infer membership from course batch or email format.
- GPS verification is foreground and permission-based; the app does not continuously
  track students.
- In-memory nonce, GPS-fix, and attempt-verdict state assumes one server process. A
  shared store is required before horizontal scaling.

## Clients

Two student clients reach the same endpoints and the same verification logic:

| | Android app | Web client (`/app`) |
|---|---|---|
| Bluetooth proximity | yes | **no — no iOS browser can read a BLE beacon** |
| GPS geofence | yes | yes |
| Lecturer's code | yes | yes |
| Peer seeding | yes | never — see below |

The web client exists because iPhone and iPad students have no native app yet. Nothing in
this document changes for it: it submits the same `fix` and `code` payloads, gets the same
deliberately ambiguous `collecting`, and is banded by the same server logic. It simply has
one fewer way to pass, which is why it is offered to iOS only by default
(`webAllowNonIos`) — Android users have a client that can also hear the beacon.

Peer seeding is absent there by consequence, not omission: only students verified by a
**primary** BLE token are ever selected as seeders, so a GPS-verified student is passed
over on every platform, native app included.

That platform gate is a UX decision, not a security boundary — the browser decides by
reading its own user agent, which anyone can spoof. It does not need to be more: the web
client uses only paths the Android app already exposes, so nothing is reachable through it
that was not already reachable.

### Course registration

Optional on both clients: a student can register ahead of time for any unarchived course,
campus-wide (`GET /api/courses/catalog`, ignoring session state entirely — unlike
`/api/courses/running`). The registered set (`Person.registeredCourses`) has no effect on
verification; it only changes what the check-in search shows at rest. A registered course
that is also currently running pins to the top of the search without the student typing
anything; a course that is registered but not running still cannot be picked, same as
before registration existed. Typing anything drops the pinned list and searches normally.

## Decision table

Distances are measured from the edge of the session's building polygon and are
admin-configurable (defaults shown).

| Evidence gathered in the window | Result | Student sees |
|---|---|---|
| Valid BLE token received | **Present** | Attendance recorded |
| Within `nearBufferM` (50m) per the near-buffer logic | **Present** | Attendance recorded |
| Within `farBufferM` (100m) per the far-buffer logic | Suspicious | Try again / Get help → correct code → **Present** |
| Outside `farBufferM` per the far-buffer logic | Far | Try again / Get help → correct code → **Flagged**¹ |
| No usable GPS fix at all | Unknown | Try again / Get help → correct code → **Flagged**¹ |

¹ `suspicious` always auto-passes on a correct code now — there is no admin switch for
it. `far`/`unknown` never do; the attempt is written as a `flagged` attendance record
with a reason, visible only in the Excel export (see "Flagged records" below).

"Within `nearBufferM`" is deliberately not just "distance ≤ 50m" — see "Selectable
geofence logic" below for what decides it.

## Why the client is never told its band

The server answers `status: "collecting"` for **both** "still gathering fixes" and
"gathered enough, but you are not in a passing band". A modified client therefore cannot
learn how far out it is, and the suspicious/far distinction stays server-side until a
code is actually submitted. The only place the difference becomes visible is the outcome
after submitting the code, which is unavoidable — and by then the record already exists.

## Why `unknown` exists

A centroid built entirely from very inaccurate fixes says nothing useful. If no
contributing fix beat `ACCURACY_CEILING_M` (75m), the attempt bands as `unknown` rather
than being trusted — a ±200m "fix" sitting 40m from the building must not silently pass
as `near`. `unknown` routes to review, never to a pass. The same band applies when a
student produced no fix at all (location denied, no provider, no lock).

## Selectable geofence logic

`nearBufferM`/`farBufferM` are thresholds; what "within the buffer" *means* against
those thresholds is a separately selectable strategy per band
(`Settings.nearBufferLogic`/`farBufferLogic`), implemented in
`services/geofenceLogic.service.js`. The near band is always evaluated first — it's the
stronger claim — and the far band's strategy only runs if near didn't already pass.

| Strategy id | What it checks |
|---|---|
| `accuracy_weighted_centroid` (default) | Distance from the accuracy-weighted average of all surviving fixes. |
| `any_point_within` | Passes if the single closest fix lands inside the buffer. |
| `majority_points_within` | Passes if more than half the surviving fixes land inside the buffer. |
| `all_points_within` | Passes only if every surviving fix lands inside the buffer. |
| `median_distance` | The middle distance across all fixes — robust to one outlier fix either way. |
| `best_accuracy_fix` | Only the single most-precise fix's distance is checked; the rest are ignored. |

Every strategy shares the same upstream pipeline: the outlier-trimming pass
(`removeOutliersByMedianDistance`) and the `ACCURACY_CEILING_M` gate run first regardless
of which strategy is selected, so a strategy only ever sees fixes that already cleared
those two filters. If trimming leaves fewer than `MIN_FIXES` trustworthy fixes, the
attempt reports "not ready" and waits for more rather than banding on data it has already
judged unreliable.

`all_points_within` is a genuine footgun with real GPS: one stray reading out of ~30 fails
the whole attempt, so a student who never left the room can still be flagged. It is offered
for small, very tight geofences only, and its description in the admin dropdown says so.

Accuracy is normalised once (`normalizedAccuracy`) before either weighting or best-fix
selection — the rule itself is in [server/README.md](../server/README.md#gps-validation).
It is done in one place because it was once done in two: the weighting mapped an
accuracy-unknown fix to a pessimistic default while best-fix selection compared the raw
value, so the same fix was simultaneously the least-trusted input to the centroid and
"the most precise fix we have" for `best_accuracy_fix`. Any new consumer of `accuracy`
must go through `normalizedAccuracy` for that reason.

## Verdict retention

The band from the automatic attempt has to outlive the attempt itself: the GPS fix
buffer drops anything older than 90 seconds, and by the time a student reads the failure
screen, asks the lecturer, and types 8 digits, their fixes are long gone. So the verdict
(band, centroid, distance) is stored separately for 10 minutes in
`services/attemptVerdict.service.js`.

Like the OAuth exchange-code store, the sign-in nonce store, and the GPS fix buffer
itself, this is in-memory and single-process.

## Upgrades

A genuine automatic pass always overwrites a `flagged` record — a student who was
flagged and then actually walks into the room can fix it themselves by checking in
again. A fresh `flagged` verdict also overwrites an existing `flagged` one, so the stored
reason/distance reflects the latest evidence gathered in the window rather than freezing
on the first fix that happened to flag. Nothing ever downgrades an existing `present`
record.

## Peer seeding

Only students who heard the **lecturer's own primary token** are eligible to seed. A
GPS-passed student can be up to the near buffer away from the building, so
re-broadcasting the classroom token from their phone would push it well outside the room
and undermine the "BLE proves you are in the room" premise the top of the decision table
rests on. A student who heard a *seeder* rather than the lecturer is excluded for the
same reason, one hop further out — which is why `verifyToken` reports which pool row
matched.

Among eligible students, real seeders and decoys get identical window durations and
identical UI, so nobody can tell which they were given. A GPS-passed student getting no
window at all reveals nothing they did not already know: their own device knows it never
heard a token.

## Admin controls

| Setting | Default | Effect |
|---|---|---|
| `bleEnabled` | true | The one kill switch. Off stops lecturer broadcasts, student scanning, and seeding. GPS has no equivalent — every session depends on it. |
| `nearBufferM` | 50 | Near-band threshold, meters. |
| `farBufferM` | 100 | Far-band threshold, meters. Must be ≥ `nearBufferM`. |
| `nearBufferLogic` | `accuracy_weighted_centroid` | Strategy deciding "within `nearBufferM`" — see "Selectable geofence logic". |
| `farBufferLogic` | `accuracy_weighted_centroid` | Strategy deciding "within `farBufferM`" — see "Selectable geofence logic". |
| `seedRate` | 0 | Target concurrent seeders; 0 disables seeding. |
| `seedWindowMs` | 60000 | Seeder **and** decoy window length. |
| `webAllowNonIos` | false | Whether the browser client at `/app` serves non-iOS devices. A UX gate only — see "Clients". |

A note on the default: GPS is routinely accurate to only 20–50m indoors, so a tight
`nearBufferM` pushes genuinely-present students into the code path. 50m is a deliberate
compromise, not a precision claim.

## Session configuration

A session has no verification field. What the lecturer chooses is:

- **Buildings** — mandatory, at least one. Without a polygon GPS has nothing to measure
  against and every student would be flagged as `unknown` instead of passing.
- **Code rotation** — whether the 8-digit code rotates on an interval, and how fast.
  The code itself always exists; there is no enable switch.

## Flagged records

*What* a flagged record is, and where it surfaces, is specified in
[server/README.md](../server/README.md#verification-contract). This section is about why
it was built that way.

There is no lecturer review queue and no approve/reject action anywhere in the app, and
that is the decision, not an omission. A review queue implies someone will work through
it; with one lecturer and several hundred students per course, nobody would, and an
unworked queue is worse than no queue — it looks like due process while delivering none.
So a `far`/`unknown` code submission is written as a record with a `reason` and left
there: the lecturer sees it in the export, in context, next to everything else about that
student, and decides for themselves whether it matters. The `reason` string exists to
make that judgement possible without exposing the raw position.

The student is shown **"Under review"** — "We couldn't verify that you were present in the
lecture room. Your attendance is now pending review by the lecturer." — worded as what to
expect rather than as a workflow — their attendance is with the lecturer, and there is
deliberately no invitation to dispute it, because nothing in the app can act on a dispute.
Both clients use the same wording.

Raw GPS fixes deliberately write nothing for `suspicious`/`far`/`unknown`; only a code
submission does. The reason is that a failed attempt is not evidence of anything. A
student can be 200 m away because they are in the canteen, or because the building's
GPS is bad, or because they opened the app on the walk over and gave up. Recording all
three identically would fill the export with rows that mean nothing and invite exactly
the false accusation the design is trying to avoid. Submitting the code is the moment the
student makes a claim, and a claim is worth recording.

## What stays server-internal

Which fields are audit-only is listed with the model in
[server/README.md](../server/README.md#attendance). They are withheld for one reason: a
student who learns their own `band` or `centroid` learns exactly how far they can be from
the room and still pass, and can then calibrate. This is also why the API answers
`collecting` for both "still gathering fixes" and "gathered enough, not passing" — the
ambiguity is the point, and any future field added to a student-facing payload has to be
checked against it.

## Known limits

- The 50–100m suspicious band always auto-passes on a correct code now — a student in the
  canteen who has the code from a group chat passes silently. Mitigations in place are
  the audit fields and code rotation; there is deliberately no per-student guess cap or
  lockout on the code endpoint (removed — see below).
- BLE range is extended deliberately by seeding, so "BLE == in the room" is approximate.
  Restricting seeding to primary-verified students bounds the chain to one hop.
- All in-memory stores block horizontal scaling.
- **GPS position is asserted by the client.** The server validates that a fix is a
  plausible coordinate, not that it came from a real GPS chip, so a caller holding a
  valid student session can submit fabricated fixes at a building and be marked present.
  Android refuses to submit a fix the platform flags as mocked — it closes the app (see
  `location/GpsLocationSource.kt`) — but that is a client-side deterrent against the easy
  case, not a boundary: a modified build can suppress the flag, and the server never
  treats its absence as evidence. Closing this properly means not letting a GPS-only
  attempt reach `present` on its own.
- **A BLE token is a bearer secret.** Nothing binds it to the device that heard it, so a
  token forwarded out of the room over any messaging app is accepted from anywhere inside
  the ~23-second validity window and is stored indistinguishably from a genuine in-room
  check-in. Relay cannot be fully solved over an out-of-band HTTP channel; requiring a
  non-`far` GPS band alongside the token would bound it to the building.

## No guess cap on the "get help" code

Wrong-code submissions are rejected every time with the same plain 400, with no
per-(student, session) attempt limit and no lockout window — an earlier version of this
service capped it at 5 tries / 5 minutes before a 2-minute lockout
(`manualCode.service.js`'s `verifyAttempt`), but that has been removed entirely; only
`verifyCode` remains, a pure code check with no attempt state. Brute-forcing an 8-digit
code (100 million possibilities) inside a session's schedule window remains the practical
mitigation, alongside code rotation.

The code path does, however, carry its **own** rate limit now (10/min per student),
separate from the 180/min budget every attendance submission shares. The two were one
60/min budget, which was the worst of both: a 90-second GPS attempt streams ~30 fixes, so
two attempts exhausted it and a student retrying in a weak-signal room was refused as
though they were abusing the endpoint — while 60 guesses a minute was no meaningful
obstacle to brute force either. Splitting them means streaming fixes can no longer eat
the code budget, and the guessable secret is the only thing held to a tight limit.
See `config/rateLimit.js`.
