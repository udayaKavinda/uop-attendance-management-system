# UOP Attendance Management System

Role-based web application for lecture attendance at the University of Peradeniya. Students mark attendance for **live** sessions using a **rotating PIN** and **browser geolocation**; **lecturers** and **admins** manage courses, sessions, geofences, and reporting.

**Repository type:** private application (`package.json` → `"private": true`). **No `LICENSE` file** is present in this repo—treat usage and distribution as defined by your institution.

---

## Purpose

- Give students a single place to record attendance when a session is **actively running** (same calendar day and clock time as the session slot).
- Tie attendance to **verified identity** (Google OAuth + server session), **session PIN**, **schedule window**, and **campus geofence** (polygons + GPS accuracy buffer).
- Let staff create and operate sessions, display live PINs, export matrices, and maintain reusable map presets.

---

## Core features

| Area | Capabilities |
|------|----------------|
| **Students** | Google sign-in; pick a **running** course; enter PIN from class; **PIN validated first**, then **periodic GPS samples** call `record-attendance` until success or timeout; if PIN is valid but geofence fails, retry in the **same live session** can skip PIN re-entry; attendance status polling per course. |
| **Lecturers** | Staff console: courses they own, session CRUD, polygons (presets), live PIN, attendance matrix, presentation route for PIN, and **live attendance gating** (`attendancePaused`) using the blinking **Live** badge. |
| **Admins** | Same as lecturers for any course, plus lecturer directory,draw polygon presets, course assign, full course lifecycle. |
| **System** | In-memory rotating PIN per session (`server/lib/lectureCode.js`, **30 s** rotation when enabled); geofence with **5 m** edge buffer cap (`GEOFENCE_ACCURACY_BUFFER_CAP_M` in `server/index.js`); non-recurring session auto-deactivate via background job; date-sensitive server keys use **local Colombo Y-M-D** (not UTC slices). |

---

## Tech stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, React Router 6, Create React App (`react-scripts` 5), Leaflet / react-leaflet 5, `fetch` + credentialed CORS. |
| **Backend** | Node.js, **Express 5**, Mongoose 9, Passport + `passport-google-oauth20`, `express-session` + **`connect-mongo`** (persistent sessions), **`helmet`** (security headers), **`express-rate-limit`** (per-route brute-force/DOS protection), `cors`, `dotenv`. |
| **Data** | MongoDB (documents: people, courses, lecture sessions, attendance, polygon presets, sessions). |
| **Tooling** | `concurrently` for `npm run dev`; optional Excel export via `xlsx` on the client (`matrixExcel.js`). |

---

## Architecture overview

```mermaid
flowchart LR
  subgraph browser [Browser SPA]
    UI[React App]
    ApiClient[api.js fetch helpers]
    UI --> ApiClient
  end
  subgraph server [Express server/index.js]
    Auth[Passport Google OAuth]
    Sess[express-session cookie attendance.sid]
    Routes[REST routes]
    Auth --> Sess
    Sess --> Routes
  end
  subgraph data [MongoDB]
    Person[(people)]
    Course[(courses)]
    Session[(lecture sessions)]
    Attendance[(attendance)]
    Preset[(polygon presets)]
  end
  ApiClient <-->|credentials include| Routes
  Routes --> Person
  Routes --> Course
  Routes --> Session
  Routes --> Attendance
  Routes --> Preset
```

- **Single-process API** in `server/index.js` (large file: models, geofence math, auth helpers, and HTTP handlers).
- **Session-based auth**: Passport serializes `Person._id`; staff vs student routes use `sessionStaffAuth` / `sessionStudentAuth` after reloading `Person` from MongoDB.
- **PIN state** lives in **process memory** (`lectureCode.js` `Map`), not MongoDB—**server restarts** drop rotation state (codes re-materialize on next access).
- **Local dev split**: default CRA dev is `http://localhost:3000`; API defaults to port **5000**. `src/api.js` points `REACT_APP_API_BASE` or `localhost:5000` when the app runs on port 3000.

---

## Project structure

```
.
├── public/                 # CRA static assets
├── src/
│   ├── App.js              # Routes, auth guards (localStorage + role)
│   ├── index.js            # StrictMode, BrowserRouter, ErrorBoundary
│   ├── index.css           # Global + component-adjacent utility styles
│   ├── layouts/            # MarketingLayout, StudentLayout, AdminLayout + layouts.css
│   ├── components/         # Login, GoogleSuccess, LectureEntry, AdminDashboard, …
│   ├── api.js              # All HTTP helpers; safeFetchJson; 401 → notifySessionInvalid
│   └── utils/              # safeStorage, authRedirect, matrixExcel
├── server/
│   ├── index.js            # Express app, OAuth, migrations, all API routes
│   ├── models/             # Person, Course, LectureSession, Attendance, PolygonPreset, CourseConfig*
│   └── lib/                # lectureCode.js, sessionExpiry.js
├── deploy/
│   └── nginx-app-domain.conf   # Example reverse-proxy (API + auth + SPA)
├── package.json
└── README.md
```

\* **`CourseConfig`** (`server/models/CourseConfig.js`) defines a Mongoose model but is **not referenced** by `server/index.js` or the current API—treat as **legacy / unused** unless you wire it in.

---

## Environment variables

Create a **`.env`** file in the **project root** (not committed—verify with your team). Names below match `server/index.js`, `sessionExpiry.js`, and `src/api.js`.

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | Recommended | Mongo connection string. Default in code: `mongodb://localhost:27017/attendance`. Also used by the `connect-mongo` session store. |
| `GOOGLE_CLIENT_ID` | Yes (OAuth) | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes (OAuth) | Google OAuth secret |
| `SESSION_SECRET` | **Required in production** | Session HMAC secret. Server **fails to boot** in production if missing. Dev fallback exists. |
| `FRONTEND_URL` | Strongly recommended | Allowed CORS origin(s) for SPA; **comma-separated**, no trailing slash issues handled in code. Used after OAuth as redirect target base. |
| `APP_BASE_URL` | Recommended for OAuth | Public origin used to build Google **`callbackURL`** (`…/auth/google/callback`). Fallback chain in strategy setup includes `FRONTEND_URL` / `REACT_APP_API_BASE`. |
| `REACT_APP_API_BASE` | Optional | CRA: absolute API origin (e.g. `http://localhost:5000`) when SPA and API differ. Empty string = same origin (typical reverse proxy). |
| `NODE_ENV` | Deployment | `production` enables **Secure** + **SameSite=None** session cookies (HTTPS required for cross-site cookies). |
| `PORT` | Optional | Express listen port; default **5000** |
| `TZ` | Optional | Server timezone for schedule comparisons. If unset, Node uses the host system timezone. Set only when you need to force a specific timezone. |
| `SESSION_EXPIRE_JOB_MS` | Optional | Interval for non-recurring session sweep; min **10000**, default **60000** (`sessionExpiry.js`) |
| `CSP_EXTRA_CONNECT_SRC` | Optional (production) | Extra origins to append to the CSP `connect-src` directive — needed when the SPA fetches an API on a **different** origin (split-host deploys). Comma-separated. Example: `https://api.example.com,https://cdn.example.com`. Ignored unless `NODE_ENV=production`. |
| `CSP_REPORT_ONLY` | Optional (production) | If `1` / `true`, the server emits `Content-Security-Policy-Report-Only` instead of the enforcing header so blocked resources are reported to DevTools but still load. Use to roll out CSP safely on staging. Ignored unless `NODE_ENV=production`. |

**CRA note:** Only variables prefixed with `REACT_APP_` are exposed to the browser at build time.

---

## Database setup

1. Install and start **MongoDB** locally or use Atlas / managed Mongo.
2. Set `MONGO_URI` in `.env`.
3. Start the server once: Mongoose creates/uses collections; **`server/index.js` runs startup migrations** (rename `students` → `people`, merge legacy `lecturers`, normalize courses, index sync, etc.). Review server logs on first boot.

**Important indexes:** `Attendance` has a **unique compound index** on `(student, session, attendanceDate)` for idempotent same-day recording.

---

## Install, run, build

```bash
npm install
```

**Development (SPA + API):**

```bash
npm run dev
```

- Frontend: `http://localhost:3000` (CRA)
- API: `http://localhost:5000` (unless `PORT` is set)

Ensure `FRONTEND_URL` includes `http://localhost:3000` for CORS when using split ports.

**Backend only:**

```bash
npm run server
```

**Production build (static React):**

```bash
npm run build
```

Serve the `build/` folder behind the same origin as `/api` and `/auth` (recommended), or set `REACT_APP_API_BASE` to the API origin and configure CORS accordingly.

**Other scripts:** `npm start` (CRA dev, client only), `npm test`, `npm run tunnel` (expects **`ngrok`** on PATH—not an npm dependency).

---

## Deployment (concise)

Prefer a **single hostname** reverse proxy:

| Path | Target |
|------|--------|
| `/api/*` | Node (Express) |
| `/auth/*` | Node (Passport OAuth callback) |
| `/*` | Static `build/` or Node SSR (not included) |

Example: `deploy/nginx-app-domain.conf`.

**Google Cloud Console:** Authorized JavaScript origin and **redirect URI** must match how users reach the app (e.g. `https://app.example.com` and `https://app.example.com/auth/google/callback` if the API handles `/auth` on that host).

**Sessions:** Stored in MongoDB via **`connect-mongo`** (collection `sessions`). Sessions survive Node restarts and horizontal scaling; the SPA still handles transient `401` via `notifySessionInvalid`.

---

## API overview

**Conventions**

- JSON bodies for `POST`/`PATCH` where applicable.
- **Cookie**: `attendance.sid` (HTTP-only); clients must use `credentials: 'include'` (`safeFetchJson` in `src/api.js`).
- **401**: unauthenticated or invalid session; **403**: authenticated but wrong role or course access.

### Auth & profile

| Method | Path | Notes |
|--------|------|--------|
| GET | `/auth/google` | Starts OAuth (503 JSON if Google env missing). Rate-limited. |
| GET | `/auth/google/callback` | OAuth callback → redirect to `FRONTEND_URL`/`…`/login/success. Rate-limited. |
| GET | `/api/me` | Session required → `{ studentId, email, role, lecturerId }` |
| POST | `/api/logout` | Destroy session |
| GET | `/api/healthz` | Liveness/readiness probe (`200` with Mongo `readyState===1`, else `503`) |

### Read endpoints (session required)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/courses` | Active courses (summary). **Auth required**. |
| GET | `/api/courses/running` | Courses with an active session **right now**. **Auth required**. |

### Student (session + `role === 'student'`)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/attendance-status?courseId=` | Same-day attendance for session-in-window |
| POST | `/api/verify-lecture-pin` | PIN + schedule + active session **only** (no geolocation)—used before GPS phase. **Rate-limited** (~30 req/min per authenticated user; IP fallback). |
| POST | `/api/verify-lecture` | **Combined** PIN + schedule + **GPS/geofence** in one call (deprecated; SPA does not call it). **Rate-limited**. |
| POST | `/api/record-attendance` | PIN + schedule + GPS + geofence; persists attendance; trusts **session user** for student id. **Rate-limited** (~60 req/min per authenticated user; IP fallback). Returns `{ success: true, duplicate: true }` for same-day re-records (no longer 500 on race). |

### Staff (`lecturer` or `admin`; course-scoped for lecturers)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/lecture-code?courseId=` | Live PIN for active session (staff; lecturer owns course) |
| GET | `/api/admin/courses` | Staff course list |
| POST | `/api/admin/courses` | Create |
| DELETE | `/api/admin/courses/:courseId` | Delete |
| PATCH | `/api/admin/courses/:courseId/disable` | |
| PATCH | `/api/admin/courses/:courseId/enable` | |
| PATCH | `/api/admin/courses/:courseId/assign-lecturer` | Admin |
| GET | `/api/admin/courses/:courseId/sessions` | |
| POST | `/api/admin/courses/:courseId/sessions` | Create session |
| GET | `/api/admin/sessions` | |
| GET | `/api/admin/sessions/current-codes` | Includes `attendancePaused` and rotation state for live cards. |
| GET | `/api/admin/sessions/:sessionId/current-code` | Also calls `syncSessionCodeMode` while the session is in its scheduled window; includes `attendancePaused` for presenter mode. |
| PATCH | `/api/admin/sessions/:sessionId/activate` | |
| PATCH | `/api/admin/sessions/:sessionId/deactivate` | |
| DELETE | `/api/admin/sessions/:sessionId` | |
| PATCH | `/api/admin/sessions/:sessionId/rotation/start` | Enable rotation and **resume** if paused (`rotationEnabled=true`, `rotationPaused=false`). |
| PATCH | `/api/admin/sessions/:sessionId/rotation/stop` | Keep rotation enabled but **pause** it so the current PIN stays on screen (`rotationPaused=true`). |
| PATCH | `/api/admin/sessions/:sessionId/attendance-paused` | Pause/resume student attendance for the **current** live window. Auto-clears for new occurrences (next live run starts unpaused). |
| GET | `/api/admin/courses/:courseId/attendance-matrix` | |
| GET | `/api/admin/lecturers?q=` | Admin |
| POST | `/api/admin/lecturers` | Admin |
| PATCH | `/api/admin/lecturers/:id` | Admin |
| DELETE | `/api/admin/lecturers/:id` | Admin |
| GET | `/api/admin/polygon-presets` | |
| POST | `/api/admin/polygon-presets` | Admin |
| PATCH | `/api/admin/polygon-presets/:id` | Admin |
| DELETE | `/api/admin/polygon-presets/:id` | Admin |

---

## Content Security Policy

CSP is **enforced only when `NODE_ENV=production`** (CRA's dev server uses `eval` for source maps, which a strict CSP would block). The policy is built from the actual external origins the app loads:

```
default-src 'self';
base-uri 'self';
object-src 'none';
script-src 'self';
script-src-attr 'none';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com;
img-src 'self' data: blob:
  https://*.tile.openstreetmap.org
  https://server.arcgisonline.com;
connect-src 'self' [+ CSP_EXTRA_CONNECT_SRC];
frame-ancestors 'none';
form-action 'self' https://accounts.google.com;
worker-src 'self' blob:;
manifest-src 'self';
upgrade-insecure-requests;
```

**Allow-list rationale**

| Origin | Why it's allowed |
|---|---|
| `https://fonts.googleapis.com` | Inter font CSS in `public/index.html` |
| `https://fonts.gstatic.com` | Inter `.woff2` files |
| `https://*.tile.openstreetmap.org` | OpenStreetMap base layer in `AdminDashboard.jsx` |
| `https://server.arcgisonline.com` | Esri satellite layer in `AdminDashboard.jsx` |
| `https://accounts.google.com` (`form-action`) | OAuth redirect target |
| `'unsafe-inline'` for `style-src` | Leaflet sets inline `transform:` styles on map markers; script XSS remains blocked |

**Rolling it out safely**

1. Deploy with `CSP_REPORT_ONLY=1`. Browsers send `Content-Security-Policy-Report-Only` so violations show up in DevTools (`Reports` tab) without breaking the page.
2. Use the app on staging across all roles for a session — note any `[CSP]` violation reports.
3. If you added a new external resource (new map provider, analytics, etc.), either add its origin to the directives in `server/index.js` or to `CSP_EXTRA_CONNECT_SRC` (for fetch/XHR origins only).
4. Unset `CSP_REPORT_ONLY` to enforce.

If your deployment serves the SPA and the API on **different hostnames** (i.e. `REACT_APP_API_BASE` is set to a different origin), add that API origin to `CSP_EXTRA_CONNECT_SRC` so the browser will allow `fetch()` to it.

---

## Authentication and authorization flow

1. User visits `/` → `Login` can redirect to **`/auth/google`** on the **API origin** (full URL depends on deployment).
2. Google returns to **`/auth/google/callback`**; Passport establishes session (persisted in MongoDB via `connect-mongo`) and redirects to **`{FRONTEND_URL}/login/success`**.
3. `GoogleSuccess` calls **`GET /api/me`** with credentials and writes **`localStorage`** key `student` (shape expected by `App.js` guards).
4. **Routing:** `student` → `/lecture`; `lecturer` / `admin` → `/admin`. Guards are **client-side** (localStorage); **server routes enforce real roles**—never rely on the client alone.

**Role source of truth:** `Person.role` in MongoDB (`student` | `lecturer` | `admin`). Google callback can **promote** to `lecturer` if email matches an active lecturer row (see `server/index.js` Google strategy).

---

## Student attendance flow (implementation)

This supersedes older “single submit with GPS” descriptions.

1. `GET /api/courses/running` populates the combobox.
2. On submit: **`POST /api/verify-lecture-pin`** with `courseId` + `lectureCode` (no coordinates).
3. On success, the **server** marks the user's Passport session as PIN-verified for `(sessionId, today's occurrence)`, and the client starts a **location phase**: **`getCurrentPosition`** immediately and then every **5 s**, each calling **`POST /api/record-attendance`** with `method: 'google'` and coordinates until **`success`** or **`duplicate`**, or **~3 minutes** elapse.
4. While the user has a valid server-side trust marker for the current session occurrence, `/api/record-attendance` **skips PIN re-validation** so the location loop is not interrupted by **PIN rotation** mid-window. Schedule window, attendance-paused, and **geofence** are still enforced on every call.
5. If the 3-minute location phase times out, retrying in the same session reuses the trust — no PIN re-entry. When the active session changes (next week / different lecture), the trust marker auto-expires and PIN is required again.

Staff live control notes:
- The **blinking Live badge** in Session control toggles `attendancePaused` (pause/resume student submissions) for the running window.
- PIN rotation remains a separate control (`↻` / `⟳`) and can be paused independently of attendance acceptance.

**Optional debug UI:** `LectureEntry.jsx` may show a **fixed GPS accuracy HUD** and related CSS—intended for temporary debugging; safe to remove for production polish.

---

## Development conventions

- **API client:** Add new calls to `src/api.js` using **`safeFetchJson`**; preserve **`credentials: 'include'`** and **401 handling** (`notifySessionInvalid`).
- **Styles:** Global `src/index.css`; layout-specific `src/layouts/layouts.css`. BEM-style class names appear in places (`student-empty__text`, `primary-btn--location-check`).
- **Maps:** Leaflet assets; admin/student flows use React hooks and functional components.
- **Error handling:** Root **`ErrorBoundary`**; dev-only `unhandledrejection` logging in `src/index.js`.

---

## Known limitations and assumptions

| Topic | Detail |
|-------|--------|
| **PIN storage** | In-memory per server process; **not** durable across restarts or horizontal scaling without redesign. |
| **Geofence** | Polygons on the **session**; point-in-polygon plus **edge buffer** capped at **5 m** (see `GEOFENCE_ACCURACY_BUFFER_CAP_M`). Polygons are validated server-side (max **50** polygons per session, max **1000** points per polygon). |
| **PIN rotation** | **30 s** window in `lectureCode.js` when rotation is active (`ROTATION_MS`). |
| **CourseConfig model** | Defined on disk but **not used** by current routes—verify before deleting. |
| **Public discovery** | `/api/courses` and `/api/courses/running` now require an authenticated session. |
| **Client guards** | Route protection uses **localStorage**; always mirror rules on the server (already done for attendance). |
| **Tests** | CRA test stack present; **no comprehensive API integration tests** in repo were verified for this README. |

---

## Troubleshooting

| Symptom | Things to check |
|---------|-------------------|
| CORS errors | `FRONTEND_URL` matches browser origin exactly; `credentials: true` on server; no mixed `www` vs bare domain. |
| OAuth redirect mismatch | Google Console redirect URI matches **`APP_BASE_URL` + `/auth/google/callback`** (or relative path if relative callback is registered, which is uncommon). |
| 401 after deploy | Sessions are persisted in Mongo (`connect-mongo`), so mass logout is no longer expected. Check `SESSION_SECRET`, cookie domain/protocol (`Secure`/`SameSite`), and whether deploy changed host/origin unexpectedly. |
| PIN always invalid | Clock skew; session not “running” (day/time); rotation paused; wrong `courseId`; server restarted (new code). |
| Geofence rejects on edge | **5 m** buffer; accuracy reported > 5 m uses 5 m buffer; verify polygon draws. |
| Mongo migration errors | Inspect startup logs in `server/index.js` connect handler; backup DB before upgrades. |

---

## Contributing

1. Work on a feature branch; keep changes focused.
2. Match existing patterns in `src/api.js`, `server/index.js` auth helpers, and component style.
3. Run **`npm run build`** before sharing frontend changes; **`node --check server/index.js`** for syntax after server edits.
4. Update this README when adding env vars, routes, or auth behavior—**documentation drift** has been an issue historically.

---

## AI Context (for coding assistants)

**Goals when editing this repo**

- Prefer **small, reviewable diffs**; do not refactor `server/index.js` broadly without explicit instruction.
- **Never** trust `studentId` from request body for authorization—use `sessionStudentAuth` / `req.user` patterns already in place.
- **Preserve** `safeFetchJson` and **401 → `notifySessionInvalid`** behavior for session coherence.

**Architecture patterns**

- Monolithic Express file with inline helpers (`resolveActiveSessionForCourse`, geofence, schedule checks).
- Mongoose models in `server/models/`.
- React SPA with **layout routes** and **role gates** in `App.js` (localStorage snapshot of `/api/me`).

**State management**

- **React component state and hooks only**—no Redux or global client store.

**Styling**

- CSS files (`index.css`, `layouts.css`); utility classes like `primary-btn`, `card-content`, `input`.

**Naming**

- Mongo: `Person` model, `people` collection historically; routes under `/api/admin/…`.
- Session cookie name: **`attendance.sid`**.

**Sensitive / high-impact areas (edit carefully)**

- **`server/index.js`**: OAuth strategy, session cookie flags, CORS, startup **migrations**, attendance and geofence logic.
- **`server/lib/lectureCode.js`**: PIN generation and validation contract with clients.
- **`src/utils/authRedirect.js`**, **`src/api.js`**: session invalidation and base URL logic.

**Likely obsolete**

- **`POST /api/verify-lecture`** for the **current** SPA path (`LectureEntry` uses **verify-lecture-pin** + **record-attendance**); kept on the server for any external clients but rate-limited.

**Files with temporary debug**

- **`src/components/LectureEntry.jsx`** — GPS accuracy HUD (remove if not wanted).
- **`src/index.css`** — `.lecture-entry__debug-gps`

---

## Codebase invariants (current state)

This table is the quick reference for facts the rest of the README depends on. Update it together with the code if any of these change.

| Item | Current state | Source |
|------|---------------|--------|
| Student flow | **PIN-first** (`/api/verify-lecture-pin`) → **GPS polling** every 5 s for ~3 min calling `/api/record-attendance` until success / duplicate / timeout. | `src/components/LectureEntry.jsx` |
| Server-side PIN trust | After a successful PIN verify, `record-attendance` skips PIN re-validation for the same `(user, session, occurrence)` so rotation mid-window does not break the location loop. | `server/index.js` (`rememberSessionPinTrust`, `hasSessionPinTrust`) |
| Geofence buffer | **5 m** edge cap (`GEOFENCE_ACCURACY_BUFFER_CAP_M`). Reported accuracy > 5 m falls back to the 5 m cap. | `server/index.js` |
| PIN rotation | **30 s** window when rotation is active (`ROTATION_MS`); rotation can be paused independently of attendance acceptance. | `server/lib/lectureCode.js` |
| PIN storage | **In-process memory** only (Map). Server restart drops rotation state. | `server/lib/lectureCode.js` |
| Sessions persistence | `express-session` + **`connect-mongo`** (collection `sessions`, TTL 7 d). Survives Node restarts and horizontal scaling. | `server/index.js` |
| Security middleware | **`helmet`** with **production-only CSP** (allow-list of OSM/Esri tiles, Google Fonts; everything else `'self'`; `frame-ancestors 'none'`; toggleable via `CSP_REPORT_ONLY` and extendable via `CSP_EXTRA_CONNECT_SRC`); **`cors`** (allow-list, credentialed); **`express-rate-limit`** (per-user via `limiterKeyByUserOrIp`; IP fallback wraps `req.ip` with `rateLimit.ipKeyGenerator()` so IPv6 clients can't bypass limits by rotating addresses — required by `express-rate-limit` v8 `ERR_ERL_KEY_GEN_IPV6` validator). | `server/index.js` |
| Duplicate attendance | `/api/record-attendance` returns `{ success: true, duplicate: true }` for same-day re-records (pre-check **and** unique-index race), never 500. | `server/index.js` |
| Public discovery | `/api/courses` and `/api/courses/running` require an authenticated session. | `server/index.js` |
| Removed | `POST /api/login` (unauthenticated user-enumeration oracle) and the `login()` helper in `src/api.js`. | — |
| Timezone | Server date/day logic uses host system local time (`localYmd`) unless `TZ` is explicitly set in the environment; Excel filename date uses system-local Y-M-D (`systemLocalYmd`). | `server/index.js`, `src/utils/matrixExcel.js` |
| Live attendance gating | Per-session `attendancePaused` flag toggled via the **blinking Live badge** in Session control or the projector view. Auto-clears when a new daily occurrence rolls over. | `server/models/LectureSession.js`, `src/components/AdminDashboard.jsx`, `src/components/SessionPinPresentPage.jsx` |
| `CourseConfig` model | **Defined but unused** by current routes — verify before deleting. | `server/models/CourseConfig.js` |
| License | **No `LICENSE` file**; package is `"private": true` in `package.json`. | `package.json` |

---

## License

No license file is included. **`package.json` declares `"private": true`.** Use and redistribution are subject to your institution’s policies; add a `LICENSE` file if you intend open-source distribution.
