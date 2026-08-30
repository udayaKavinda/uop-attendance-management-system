# UOP Attendance — iOS web client

The student check-in flow as a React app, for iPhone and iPad. Android users have the
native app; this exists so iOS users are not locked out before a native iOS app exists.

## What it can and cannot do

| | Android app | This client |
|---|---|---|
| Bluetooth proximity | yes | **no — Safari has no Web Bluetooth** |
| GPS geofence | yes | yes |
| Lecturer's 8-digit code | yes | yes |
| Peer seeding (re-broadcasting) | yes | no |
| Staff tools (sessions, broadcasting, code) | yes | no |

Bluetooth is the hard limit and the reason this is a stopgap: no iOS browser can read a
BLE beacon, at all, behind any flag. So a check-in here runs GPS alone for its window.

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
  geo/          watchPosition → throttled GPS fix stream
  hooks/        useSession (OAuth + /api/me), useCheckIn (the 90-second window)
  platform/     iOS / standalone detection
  components/   shared chrome, course picker, code dialog
  screens/      check-in, login, staff notice, unsupported-platform
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
