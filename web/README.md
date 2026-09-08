# UOP Attendance — iOS web client

The student check-in flow, and a lecturer dashboard, as a React app for iPhone and iPad.
Android users have the native app for both roles; this exists so iOS users are not locked
out before a native iOS app exists. **Administration stays Android-only** — an admin
signing in here gets a plain notice, not a partial dashboard (`AdminNoticeScreen`).

## What it can and cannot do

| | Android app | This client |
|---|---|---|
| Student: Bluetooth proximity | yes | **no — Safari has no Web Bluetooth** |
| Student: GPS geofence | yes | yes |
| Student: lecturer's 8-digit code | yes | yes |
| Student: peer seeding (re-broadcasting) | yes | no |
| Lecturer: courses, sessions, attendance table | yes | yes |
| Lecturer: **starting a Bluetooth broadcast** | yes | **no, deliberately — see below** |
| Admin: lecturers, buildings, global settings | yes | **no — `AdminNoticeScreen`** |

Bluetooth is the hard limit for students and the reason the check-in flow is a stopgap: no
iOS browser can read a BLE beacon, at all, behind any flag. So a check-in here runs GPS
alone for its window.

Peer seeding is not a gap this client has to fill. The server only ever selects
students who passed via a *primary* Bluetooth token as seeders
(`peerSeeding.service.js`), so a GPS-verified student — on any platform, native app
included — is never given a seeding window. This client sends `canAdvertise: false` and
correctly receives no seeding role at all.

Everything else is deliberately identical to the native app: the same 90-second window,
the same states, the same wording, and the same rule that the lecturer's code appears
only *after* an automatic attempt has actually failed. The client is never told why it
failed — the server answers `collecting` for both "still gathering fixes" and "you are
too far away" — so it cannot leak a student's distance band.

## Lecturer dashboard

`StaffDashboard` is a line-for-line port of the Android lecturer role
(`ui/staff/StaffViewModel.kt`, `StaffDashboardScreen.kt`): the same three tabs (Courses,
Create session, Sessions) in the same order, the same copy, the same batch-code
auto-formatter, the same searchable building multi-select. It authenticates over the same
session cookie and hits the same `requireStaff`-gated endpoints the native app does — **no
backend change was needed to add it.**

One thing is permanently different, on purpose: **this client never calls either
broadcast endpoint**

```
PATCH /api/admin/sessions/:id/broadcast   ← turns the BLE beacon on/off
GET   /api/admin/sessions/:id/broadcast   ← the token poll, which IS the broadcaster's heartbeat
```

No browser can advertise as a BLE peripheral — Web Bluetooth is scan-only everywhere, and
Safari has none at all — so a web lecturer has no radio to turn on. Claiming one anyway
would be actively worse than not having one: `broadcasting: true` with nothing really
transmitting would make a co-lecturer's Android dashboard read "Broadcasting from another
device" and skip starting the one broadcast that would actually work, and skipping the GET
means never resetting `lastBroadcastSeenAt`, so `sessionExpiry.service.js`'s stale-sweep
(`BROADCAST_STALE_MS`) would flip the flag back off within seconds anyway — an
intermittent lie is worse than a stable one. `broadcasting` is only ever *read* here (from
the sessions/running list payloads), so a lecturer still correctly sees when a colleague's
phone is on the air; the session card just has no "Join" action, since there is nothing to
join with. See the long comment on the staff block in `src/api/client.ts` and
`SessionsTab.tsx` for the full reasoning.

Also absent, and staying that way: the admin-only tabs (Lecturers, Geofences, Settings —
drawing a building polygon needs a map surface this client doesn't have) and the
geofence map editor generally.

## Visual parity with the native app

`src/styles.css` is not eyeballed against screenshots — every value is taken from the
Compose sources, and each block names where it came from:

| Web | Source |
|---|---|
| colour tokens | `ui/theme/Color.kt` |
| radii (`--r-card` 22, `--r-panel` 16, `--r-input` 14, …) | `ui/theme/Shape.kt` |
| font sizes and weights | `ui/theme/Type.kt` |
| `Card`, `PrimaryButton`, `TextField`, `ErrorBanner`, `EmptyState`, `LoadingGate` | `ui/components/Components.kt` |
| screen structure, panels, outcome cards, copy | `ui/student/LectureEntryScreen.kt` |

Compose `dp`/`sp` map 1:1 to CSS pixels here. The background photograph is the same
file the Android app ships (`res/drawable/app_background.jpg`) — byte-identical to the
original React app's, so all three clients share it — under the same flat `#F7F8FA` wash
at 58% alpha that `AppBackground` applies. The typeface is Inter, as in that React app;
the server's CSP already allows Google Fonts.

Two places intentionally differ because the platforms do, not because of drift: Compose
disables a button by swapping its gradient for a flat `Muted` fill (mirrored here rather
than fading opacity), and `background-attachment: fixed` is dropped on iOS, where WebKit
renders it as a huge scrolling image instead of a stationary one.

## The non-iOS kill switch

`webAllowNonIos` in the settings singleton — off by default, toggled by an admin under
**Web client** on the Android dashboard. Off, Android and desktop get the "use the
Android app" notice; on, anyone may use the client. It exists as an operational escape
hatch for when the Android app is unavailable.

The client reads it from the public `GET /api/web-config` (see `usePlatformGate`), which
has to be unauthenticated because the decision happens before sign-in. iOS never waits on
that request — the common case is not gated behind a possibly-slow round trip — and for
everyone else the request **fails closed**, so a flaky connection can never silently open
the client up.

It is a UX gate, not a security control: it reads the user agent, which anyone can spoof.
It changes what ordinary users experience, not what is possible — and it does not need to
do more, since this client only uses the GPS and lecturer-code paths the native app
already exposes.

## Why it is served from the API's origin

Authentication is the same httpOnly `attendance.sid` session cookie the native app uses.
Safari blocks third-party cookies outright, so a client hosted on any other origin would
be signed out on every request. Express therefore serves `web/dist` at `/app`
(`server/src/routes/webApp.routes.js`), which means:

- no CORS entry, and no cross-origin request to be blocked;
- no separate Google OAuth client — sign-in reuses `GET /auth/google` with
  `returnTo` pointing at `<origin>/app`;
- the existing `X-Requested-With` CSRF guard already covers every mutating call;
- the existing CSP (`script-src 'self'`, `connect-src 'self'`) already fits.

The dev server proxies `/api` and `/auth` to Express for the same reason — the browser
must see a single origin or the cookie is dropped.

## Development

```bash
npm ci
npm run dev            # http://localhost:5173, proxying to http://localhost:5000
```

Point it at a different API with `VITE_API_TARGET`. For the OAuth round trip to land
back on the dev server, set the server's `APP_BASE_URL` to `http://localhost:5173` and
register that callback in the Google console.

Safari refuses `navigator.geolocation` outside a secure context, and `localhost` counts
as one — but a phone on your LAN hitting `http://192.168.x.x:5173` does not. Test on a
real device over HTTPS (or through the deployed `/app`); a desktop browser only ever
shows the "use the Android app" notice, since the iOS gate runs first.

```bash
npm run build          # tsc -b && vite build  → dist/
npm run icon           # re-render public/apple-touch-icon.png
```

## The app icon

`public/apple-touch-icon.png` is generated, not committed:
`scripts/generate-icon.mjs` renders it from the same geometry as `public/icon.svg`
using plain maths and Node's `zlib`, with no image dependency. iOS ignores SVG for "Add
to Home Screen" and will screenshot the page instead, so a real PNG has to exist — but
a binary blob nobody can regenerate is worse than a script. `npm run build` renders it
via `prebuild`, and the deploy workflow runs the same build.

## Deployment

`.github/workflows/deploy.yml` runs `npm --prefix web ci && npm --prefix web run build`
on the production host after installing server dependencies. The deploy's
`git clean -fdx` wipes the previous `dist`, so it is rebuilt on every release and the
bundle can never drift from the API it was built against. If the build is missing,
`/app` answers 503 with an explanation and the API is unaffected.

## Structure

```
src/
  api/          fetch wrapper (credentials, CSRF header, ApiResult) and the JSON contract
  assets/       the background photograph shared with the Android app
  geo/          watchPosition → throttled GPS fix stream
  hooks/        usePlatformGate (the iOS gate), useSession (OAuth + /api/me),
                useCheckIn (the 90-second window), useStaffDashboard (lecturer state,
                port of StaffViewModel.kt)
  platform/     iOS / standalone detection, screen wake lock
  components/   Chrome.tsx (shared student/login chrome), StaffChrome.tsx (dashboard
                widgets — tabs, session card, pills)
  screens/      check-in, login, admin notice, unsupported-platform,
                StaffDashboard.tsx (lecturer dashboard shell)
  screens/staff/  CoursesTab, CreateSessionTab, SessionsTab, AttendanceMatrixScreen
```

`src/api/types.ts` mirrors the server's controllers, the same way
`Android/…/data/net/Dto.kt` does for the native app. When an endpoint changes, both
need updating.

## Not verified here

The build, the type check, and the server-side mount are covered by CI and by
`server/src/tests/webApp.routes.test.js`. What no test covers is real iOS behaviour:
Safari's location permission sheet, accuracy indoors, and what happens to the 90-second
window when the tab is backgrounded — iOS suspends timers and geolocation callbacks far
more aggressively than Android does. Confirm those on a real device before rollout.
