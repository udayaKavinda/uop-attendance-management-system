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

Peer seeding is absent there by consequence, not omission: seeding is offered only to
students whose radio actually heard the room — the lecturer's beacon or another student's
relay — so a **GPS-verified** student is passed over on every platform, native app
included. A browser check-in is GPS-only by construction, which puts it outside that set
whatever it asks for.

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

`unknown` is reserved for when there is no distance to band at all: the student produced
no usable GPS fix (location denied, no provider, no lock) or every building on the
session had been deactivated/deleted by the time a fix arrived, so nothing remained to
measure a distance against. There used to also be an accuracy floor here — a centroid
built entirely from fixes reporting worse than 75m accuracy banded as `unknown` rather
than being trusted — but that gate was removed: every band decision now runs purely off
distance, however imprecise the contributing fixes claimed to be. `unknown` still routes
to review, never to a silent pass, via the code-escalation step.

## Selectable geofence logic

`nearBufferM`/`farBufferM` are thresholds; what "within the buffer" *means* against
those thresholds is a separately selectable strategy per band
(`Settings.nearBufferLogic`/`farBufferLogic`), implemented in
`services/geofenceLogic.service.js`. The near band is always evaluated first — it's the
stronger claim — and the far band's strategy only runs if near didn't already pass.

`minFixes` is how many live fixes the strategy needs before it may answer: the shipped
default, and the lowest an admin may configure it to. Both travel with the strategy —
see "Why the sample size lives with the strategy" — and the ceiling for all of them is
`MAX_MIN_FIXES` (10).

| Strategy id | What it checks | minFixes (default / floor) |
|---|---|---|
| `accuracy_weighted_centroid` (default) | Distance from the accuracy-weighted average of every collected fix. | 3 / 3 |
| `any_point_within` | Passes if the single closest fix lands inside the buffer. | 2 / **1** |
| `majority_points_within` | Passes if more than half of the collected fixes land inside the buffer. | 3 / 3 |
| `all_points_within` | Passes only if every collected fix lands inside the buffer. | 3 / 3 |
| `median_distance` | The middle distance across all fixes — the outlier-resistant option now that nothing pre-filters. | 3 / 3 |
| `best_accuracy_fix` | Only the single most-precise fix's distance is checked; the rest are ignored. | 2 / **1** |

Every strategy sees **every** live fix. There is no filtering pass in front of them: once
a strategy's minimum sample size is met (see "Why the sample size lives with the
strategy"), the whole sample is handed over as-is.

An outlier-trimming pass used to run first, regardless of the selected strategy, dropping
any fix further from the marginal median than `max(15, 2 × median distance)`. It was
removed because a filter that asks "which readings agree with the majority?" cannot sit
underneath rules that are explicitly not majority rules. `any_point_within` promises to
pass on a single fix inside the buffer, and the trimmer discarded exactly that fix
whenever it was the minority — measured: readings scattered 55-106 m out plus one dead
inside the polygon, verdict 55 m, no pass. `best_accuracy_fix` was overruled on position
agreement when its entire premise is to trust the accuracy field instead.

Worse, trimming ran *before* the accuracy weighting and judged position only, so four
identical 100 m-accuracy readings could outvote one 5 m reading and discard it — the
centroid then reported 111 m while the single trustworthy fix was inside the building.
The 1/accuracy² weighting exists to let a 5 m fix dominate a 100 m one 400:1 and never
got to run. That is the ordinary indoor case rather than a contrived one: a coarse
network fix repeats the same coordinate, so the unreliable cluster agrees with itself.

The cost of removing it is real and is not hidden: `accuracy_weighted_centroid` is again
exposed to a glitch that also reports good accuracy, which is the incident the trimmer
was originally added for. Outlier resistance became a *choice* instead — `median_distance`
and `majority_points_within` absorb a stray reading by construction, and an admin who
needs that selects one.

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

### Which fix is "the most precise one"

`best_accuracy_fix` rests entirely on picking one reading out of the sample, so that
choice has to be a function of the sample's contents and never of the order the fixes
happen to sit in. `mostPreciseFix` applies three rules in order: smallest
`normalizedAccuracy`; then, on a tie, the **newest** reading; then, if accuracy and
timestamp both tie, the **farther** reading.

The tie rules are not hypothetical. Phones quantize accuracy — 5 m, 10 m and 20 m repeat
constantly — so equal values are the ordinary case, and the previous `reduce` silently
kept whichever tied fix came first in the array. Measured: four fixes all at accuracy 5,
two inside the polygon and two ~503 m out, banded `inside` when the inside pair arrived
first and `far` when it arrived second. Same evidence, opposite verdicts, decided by
nothing.

Preferring the newer reading matches how the rest of the attempt treats fresher evidence
(the stored verdict is overwritten for the same reason). The final fallback prefers the
farther reading because at that point the sample genuinely contradicts itself — two
readings, equally precise, equally fresh, in different places — and declining to grant a
pass on evidence that cannot support one is the safe reading. The student is not
stranded: non-passing bands write nothing, and the lecturer's code is still available.

## Verdict retention

The band from the automatic attempt has to outlive the attempt itself: the GPS fix
buffer drops anything older than 90 seconds, and by the time a student reads the failure
screen, asks the lecturer, and types 8 digits, their fixes are long gone. So the verdict
(band, centroid, distance) is kept for 10 minutes by
`services/attemptVerdict.service.js`.

Both halves live in MongoDB, on one `AttendanceAttempt` document per
`(student, session)` — the fixes and the band they resolved to, written in the same
request and cleared together. They were two per-process `Map`s, which cost a real
incident: a deploy in the gap between the automatic attempt and the code submission
dropped the verdict, `get` returned null, and null is correctly read as `unknown`, which
is written as `flagged`. A student measured inside the building was recorded as not
verified. The Maps also pinned the app to one process, since a second instance would
answer for fixes it had never accumulated.

The two halves keep different lifetimes on that shared document, and that is the part to
be careful with. Fixes matter for 90 seconds; the verdict has to outlive them by minutes.
So expiry is measured against the verdict's own `verdictTs`, never against fix age, and
nothing may delete the document merely because its fixes went stale.

## Upgrades

A genuine automatic pass always overwrites a `flagged` record — a student who was
flagged and then actually walks into the room can fix it themselves by checking in
again. A fresh `flagged` verdict also overwrites an existing `flagged` one, so the stored
reason/distance reflects the latest evidence gathered in the window rather than freezing
on the first fix that happened to flag. Nothing ever downgrades an existing `present`
record.

## Peer seeding

Any student whose radio actually heard the room may seed — the lecturer's own primary
token or another student's relay, both count. The mesh grows hop by hop on purpose: a
single hop did not reach the far end of a large hall, which is the problem seeding exists
to solve.

A **GPS-passed student is still excluded**, and that exclusion is the one carrying the
weight. They can be up to the near buffer away from the building having heard no beacon
at all, so re-broadcasting the classroom token from their phone would put it somewhere no
radio ever reached and undermine the "BLE proves you are in the room" premise the top of
the decision table rests on. `verifyToken` still reports which pool row matched, but that
now records provenance (`seedRelayed` on the attendance row) rather than gating
eligibility.

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
| `minFixesByStrategy` | per strategy | GPS fixes a strategy needs before it may decide, keyed by strategy id. Sparse: absent strategies use their own default. See below. |
| `seedRate` | 0 | Target concurrent seeders; 0 disables seeding. |
| `seedWindowMs` | 60000 | Seeder **and** decoy window length. |
| `webAllowNonIos` | false | Whether the browser client at `/app` serves non-iOS devices. A UX gate only — see "Clients". |
| `studentEmailDomain` | `eng.pdn.ac.lk` | Domain a Google account must carry to sign in as a student. Empty disables the check. Not a verification control — it gates who exists, not who is present. |
| `minSupportedVersionCode` | 0 | Oldest Android `versionCode` allowed to call the API; 0 accepts any. The force-upgrade lever. |

Those ten rows are the whole `Settings` document — exactly the fields
`GET`/`PATCH /api/admin/settings` reads and writes. The last two are listed for
completeness because they share that document and that screen, but neither affects
banding; everything above them does.

A note on the default: GPS is routinely accurate to only 20–50m indoors, so a tight
`nearBufferM` pushes genuinely-present students into the code path. 50m is a deliberate
compromise, not a precision claim.

## Session configuration

A session has no verification field. What the lecturer chooses is:

- **Buildings** — mandatory, at least one. Without a polygon GPS has nothing to measure
  against and every student would be flagged as `unknown` instead of passing.
- **Code rotation** — whether the 8-digit code rotates on an interval, and how fast.
  The code itself always exists; there is no enable switch.

  Rotation is *lazy*: the code changes on the first call that finds it stale, not on a
  timer, so nothing rotates while nobody is asking. That is fine on its own — but
  `verifyCode` is one of those callers, which means a student's submission can be the
  call that performs an overdue rotation. Because the previous code is accepted for a
  2-second grace measured from the rotation, a rotation triggered by the submission
  made the code it had just retired look 0 ms old, and a code read out ten minutes
  earlier was accepted. This only happened when nothing else polled in between — the
  lecturer's dashboard closed, or their phone asleep. The grace is now granted only
  when the rotation was due, never when it was overdue.

  The lesson generalises: any grace window measured from a lazily-updated timestamp is
  only meaningful if the update happened when it was supposed to. The BLE path avoids
  this by construction — `verifyToken` reads the token pool without rotating it.

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

### Why the sample size lives with the strategy

The GPS minimum used to be one constant, `MIN_FIXES = 3`, applied before any strategy
ran. It moved onto the strategies because they do not mean the same thing at the same
sample size.

At a sample of **one**, `fixDistances` holds a single element — so its minimum, maximum
and median are the same number, the accuracy-weighted centroid *is* that fix, and the
best-accuracy fix is that fix too. Every strategy returns an identical answer. Allowing
`all_points_within` to be configured down to 1 would therefore not make the strictest
option more permissive; it would turn it into `any_point_within` while keeping a
description that warns about stray readings. That is why the four multi-point strategies
floor at 3 and only `any_point_within` and `best_accuracy_fix` — which genuinely ask
about one reading — may go to 1.

They still default to 2, and it is worth being precise about how little that buys: with
nothing filtering the sample, `any_point_within` takes the closest fix and
`best_accuracy_fix` the most precise one, so a second reading cannot outvote a bad first
one. What the default avoids is forming a whole verdict from the first reading of a cold
start, routinely the coarsest a device produces. It is a settling allowance, not a safety
margin, and an admin who wants the fastest verdict can set 1.

The ceiling (10) is not arbitrary either: measured indoors on an API 31 phone reporting
100 m accuracy, fixes arrived every 20-25 s — about four in the whole 90-second window. A
minimum above that is not strictness, it is a band that can never be reached in a bad
room.

What this buys is speed where it is safe. `any_point_within` at 2 reaches a verdict in
roughly half the time the old flat 3 did, which matters most in exactly the rooms where
fixes are slowest. It also makes configurations expressible that were not before: a
strict near band (centroid, 3 fixes) alongside a lenient far band.

## Known limits

- **A single GPS glitch can decide a verdict under the default strategy.** Nothing
  filters the fixes any more (see "Selectable geofence logic" for why the trimmer was
  removed), so one wild reading that also reports good accuracy pulls the
  accuracy-weighted centroid with it: measured, three in-room fixes plus one 25 km glitch
  band as `far`, and the student falls through to the lecturer's code. The mitigation is
  to select `median_distance` or `majority_points_within`, which absorb a stray reading by
  construction — it is a deliberate trade of a hidden safeguard for strategies that mean
  what their names say.

- The 50–100m suspicious band always auto-passes on a correct code now — a student in the
  canteen who has the code from a group chat passes silently. Mitigations in place are
  the audit fields and code rotation; there is deliberately no per-student guess cap or
  lockout on the code endpoint (removed — see below).
- BLE range is extended deliberately by seeding, so "BLE == in the room" is approximate,
  and since seeding became multi-hop it is approximate without a fixed bound. `seedRate`
  caps how many seeders are live at once, not how far the chain reaches: each expiring
  lease can go to someone further out than the last holder. A BLE token passes outright
  as `inside` without consulting GPS, so nothing re-checks that drift against a geofence.
  This is a deliberate trade for coverage in large halls, and the reason seeding ships
  disabled (`seedRate: 0`) rather than on.
- The OAuth exchange-code and sign-in nonce stores are still in-memory, and are what now
  blocks horizontal scaling. Attempt state no longer does: it moved to MongoDB, where two
  instances share one buffer instead of each holding a partial one that never reaches the
  minimum fix count.
- Every GPS fix is now a database round trip rather than a heap write — roughly three DB
  ops per fix against one before. Measured at ~256 ms median per submission over Atlas,
  and the collection tops out near 10 MB even with 2000 students checking in at once, but
  the write *rate* at that scale (~2,000 ops/sec) is the number to check against the
  cluster tier before a full-faculty rollout.
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
mitigation, alongside code rotation — which is only a mitigation while rotation actually
retires the old value; see the rotation note under Session configuration for the case
where it did not.

The code path does, however, carry its **own** rate limit now (10/min per student),
separate from the 180/min budget every attendance submission shares. The two were one
60/min budget, which was the worst of both: a 90-second GPS attempt streams ~30 fixes, so
two attempts exhausted it and a student retrying in a weak-signal room was refused as
though they were abusing the endpoint — while 60 guesses a minute was no meaningful
obstacle to brute force either. Splitting them means streaming fixes can no longer eat
the code budget, and the guessable secret is the only thing held to a tight limit.
See `config/rateLimit.js`.
