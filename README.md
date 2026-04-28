# UOP Attendance Management System

This project is a role-based attendance platform for the University of Peradeniya:

- **Students** submit attendance for currently running sessions.
- **Lecturers/Admins** manage courses, lecture sessions, code rotation, and geofence polygons.
- **Admins** additionally manage lecturer accounts and shared polygon presets.

It uses a React frontend (`src/`) and an Express + MongoDB backend (`server/`).

## Current architecture

### Backend

- Express API in `server/index.js`
- Mongo models in `server/models/`:
  - `Person` (stored in `people` collection)
  - `Course`
  - `LectureSession`
  - `Attendance`
  - `PolygonPreset`

### Frontend

- React Router app in `src/App.js`
- Layout-based routing:
  - `/` and `/login/success` (public/auth)
  - `/lecture` (student-only)
  - `/admin` (lecturer/admin-only)
- API client in `src/api.js`: all requests use `fetch` with **`credentials: 'include'`** so the Passport session cookie is sent; responses are normalized with **`safeFetchJson`** (network errors return `{ error }` instead of throwing).
- Root **`ErrorBoundary`** wraps the app (friendlier recovery than a blank crash).
- Corrupt `localStorage` for the `student` key is tolerated via **`readStoredStudent()`** (`src/utils/safeStorage.js`).
- Student **course picker** on `/lecture` is a custom combobox (search by code/name, pick from list); students do **not** fetch the live PIN from the API—they enter the code shown in class.

## Roles and access

Roles are stored on `Person.role`:

- `student`
- `lecturer`
- `admin`

Access behavior:

- `student` -> student page (`/lecture`)
- `lecturer` and `admin` -> staff console (`/admin`)

### Security model (recent)

| Area | Behavior |
|------|------------|
| **Staff APIs** (`/api/admin/*`) | Identity comes from the **Passport session** only (cookie **`attendance.sid`**). The server reloads `Person` from MongoDB and checks **`admin`** / **`lecturer`**. The old **`X-Student-Id`** header is **not** used for authorization. |
| **Student attendance** | `GET /api/attendance-status`, `POST /api/verify-lecture`, and `POST /api/record-attendance` require a session and **`role === 'student'`**. The server uses **`req.user`** (session)—**not** `studentId` in query or body. |
| **Live PIN** | **`GET /api/lecture-code`** requires a **staff** session; **lecturers** only for **their** courses; **admins** for any course. Students cannot read the rotating code over this endpoint. |
| **OAuth redirect** | After Google sign-in, the user is sent to **`/login/success`** without putting Mongo ids in the query string; the SPA calls **`GET /api/me`** with credentials to fill `localStorage` for UI routing. |
| **CORS** | Server uses **credentials: true** and an allowlist from **`FRONTEND_URL`** (and fallback **`APP_BASE_URL`**); set origins to match your SPA exactly (comma-separated for multiple). |
| **Production cookies** | Session cookie uses **`Secure`** and **`SameSite=None`** when `NODE_ENV === 'production'` so a separate API host can still receive the cookie (HTTPS required). |

## Core workflow

### 1) Sign-in

1. User starts Google OAuth at `/auth/google`.
2. Backend resolves/creates `Person` by email.
3. Backend redirects to `/login/success` (session cookie is set on the API origin).
4. Frontend calls `GET /api/me` with credentials, stores identity in `localStorage` for UI, and routes by role.

### 2) Student attendance (`/lecture`)

1. UI fetches currently running courses (`GET /api/courses/running`).
2. Student selects a running course.
3. UI checks attendance status for the signed-in student (`GET /api/attendance-status` with session cookie).
4. If not yet marked, student enters code and submits with location.
5. Backend validates:
   - active session exists for selected course now
   - submitted lecture code is valid
   - current day/time is within session window
   - location is inside any configured polygon
6. Attendance is stored in `Attendance`.

Duplicate protection is enforced by unique index:

- `student + session + attendanceDate`

### 3) Staff console (`/admin`)

Tabs/features:

- **Courses**
  - create, enable/disable, delete
  - admin can assign lecturer owner
  - open attendance matrix per course
- **Create session**
  - day/start/end time
  - recurring yes/no
  - optional code rotation at creation
  - draw one or more polygons on map
  - optional merge from saved presets
- **Sessions**
  - activate/deactivate/delete sessions
  - live code display for running sessions
  - start/pause rotation
- **Lecturers** (admin only)
  - search/add/remove lecturer accounts
- **Presets** (admin only)
  - create/delete reusable polygon presets

## Environment variables

Create `.env` in project root:

```env
MONGO_URI=mongodb://localhost:27017/attendance
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Use a long random string in production
SESSION_SECRET=change-me

# SPA origin(s) for CORS + post-OAuth redirect (comma-separated allowed).
# Local dev with CRA on :3000 and API on :5000: include http://localhost:3000
FRONTEND_URL=http://localhost:3000

# Public URL of the app as seen by Google (OAuth callback is APP_BASE_URL/auth/google/callback).
# Often same as FRONTEND_URL in single-domain or tunnel setups.
APP_BASE_URL=http://localhost:3000

# Optional: override API origin from the React app (e.g. http://localhost:5000).
# Leave empty when the browser talks to the same host as the SPA (reverse proxy).
REACT_APP_API_BASE=

# Optional non-recurring session expiry sweep interval (ms)
# minimum 10000, default 60000
SESSION_EXPIRE_JOB_MS=60000
```

## Running locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start app + API:

   ```bash
   npm run dev
   ```

3. Open:
   - Frontend: `http://localhost:3000`
   - Backend: `http://localhost:5000`

Ensure **`FRONTEND_URL`** (and **`APP_BASE_URL`** if used for OAuth) include `http://localhost:3000` so CORS and the Google redirect after login resolve correctly.

**OAuth callback URL:** In `server/index.js`, Google’s redirect URI is derived from **`APP_BASE_URL`** (then **`FRONTEND_URL`**). It must match the **public URL that reaches your Express app** for `/auth/google/callback` (e.g. same tunnel as the API, or `http://localhost:5000` if that is where OAuth is registered during split dev).

## Deployment notes

Recommended deployment is **single-domain reverse proxy**:

- `https://app.domain.com/` -> React frontend
- `https://app.domain.com/api/*` -> backend
- `https://app.domain.com/auth/*` -> backend

Google OAuth client should include:

- Authorized JavaScript origin: `https://app.domain.com`
- Redirect URI: `https://app.domain.com/auth/google/callback`

A sample nginx config is available at `deploy/nginx-app-domain.conf`.

## API reference (implemented)

### Auth/profile

- `GET /auth/google`
- `GET /auth/google/callback`
- `POST /api/login` (legacy lookup by email / external id; does **not** create a session—prefer Google OAuth)
- `GET /api/me` (session required; returns current user: `studentId` = Person `_id`, `role`, `email`, `lecturerId`)
- `POST /api/logout` (ends Passport session)

### Student endpoints

- `GET /api/courses`
- `GET /api/courses/running`
- `GET /api/attendance-status?courseId=...` (requires Google session; **student** role only; server uses session user, not `studentId` query)
- `POST /api/verify-lecture` (session required; student role only)
- `POST /api/record-attendance` (session required; student role only; **never** trusts `studentId` from body)

### Staff/admin endpoints

All `/api/admin/*` routes require a logged-in **staff** session (Google OAuth cookie). Unauthorized responses use `401`; forbidden (e.g. student account) use `403`.

- Browser requests must include **credentials** (session cookie).
- Configure **`FRONTEND_URL`** on the server to match your SPA origin(s) for CORS (comma-separated list allowed).

#### Live lecture pin (by course, during active session)

- `GET /api/lecture-code?courseId=...` — **staff session only**; **lecturers** only for courses they own; **admins** for any course. Students cannot call this. Client helper: `getLectureCode(courseId)` in `src/api.js` (same cookie rules as other staff calls).

#### Courses

- `GET /api/admin/courses`
- `POST /api/admin/courses`
- `PATCH /api/admin/courses/:courseId/disable`
- `PATCH /api/admin/courses/:courseId/enable`
- `PATCH /api/admin/courses/:courseId/assign-lecturer` (admin)
- `DELETE /api/admin/courses/:courseId`

#### Sessions

- `GET /api/admin/sessions`
- `GET /api/admin/courses/:courseId/sessions`
- `POST /api/admin/courses/:courseId/sessions`
- `PATCH /api/admin/sessions/:sessionId/activate`
- `PATCH /api/admin/sessions/:sessionId/deactivate`
- `DELETE /api/admin/sessions/:sessionId`
- `GET /api/admin/sessions/current-codes`
- `GET /api/admin/sessions/:sessionId/current-code`
- `PATCH /api/admin/sessions/:sessionId/rotation/start`
- `PATCH /api/admin/sessions/:sessionId/rotation/stop`

#### Reporting

- `GET /api/admin/courses/:courseId/attendance-matrix`

#### Lecturer directory (admin)

- `GET /api/admin/lecturers?q=...`
- `POST /api/admin/lecturers`
- `PATCH /api/admin/lecturers/:id`
- `DELETE /api/admin/lecturers/:id`

#### Polygon presets

- `GET /api/admin/polygon-presets`
- `POST /api/admin/polygon-presets` (admin)
- `PATCH /api/admin/polygon-presets/:id` (admin)
- `DELETE /api/admin/polygon-presets/:id` (admin)

## Notes

- This repository includes migration logic in server startup to normalize older data (for example legacy collections/fields).
- Session auto-expiry for non-recurring sessions runs in a background sweep job.
- In development, unhandled promise rejections may be logged without stopping the dev experience; fix the underlying API or add `try/catch` in effects when introducing new calls.
- **API restarts:** The default Express session store is **in-memory**, so a **Node restart invalidates all sessions** and APIs return `401`. The SPA redirects to `/?error=session` and clears `localStorage`. For production, use a **persistent store** (e.g. `connect-mongo` or Redis with `express-session`) so logins survive deploys/restarts.
