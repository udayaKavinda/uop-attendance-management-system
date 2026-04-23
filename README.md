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
- API client functions in `src/api.js`

## Roles and access

Roles are stored on `Person.role`:

- `student`
- `lecturer`
- `admin`

Access behavior:

- `student` -> student page (`/lecture`)
- `lecturer` and `admin` -> staff console (`/admin`)
- Staff API routes require `X-Student-Id` header and server-side role checks.

## Core workflow

### 1) Sign-in

1. User starts Google OAuth at `/auth/google`.
2. Backend resolves/creates `Person` by email.
3. Backend redirects to `/login/success?studentId=...&role=...`.
4. Frontend stores user identity and routes by role.

### 2) Student attendance (`/lecture`)

1. UI fetches currently running courses (`GET /api/courses/running`).
2. Student selects a running course.
3. UI checks attendance status for current active session (`GET /api/attendance-status`).
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
SESSION_SECRET=change-me

# Public app origin (recommended for one-domain reverse proxy)
APP_BASE_URL=https://app.domain.com
FRONTEND_URL=https://app.domain.com

# Optional frontend API base override
# Leave empty for same-origin proxy setup
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
- `POST /api/login` (legacy lookup)
- `GET /api/me?studentId=...`

### Student endpoints

- `GET /api/courses`
- `GET /api/courses/running`
- `GET /api/lecture-code?courseId=...`
- `GET /api/attendance-status?studentId=...&courseId=...`
- `POST /api/verify-lecture`
- `POST /api/record-attendance`

### Staff/admin endpoints

All `/api/admin/*` routes require:

- Header: `X-Student-Id: <person_id>`

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
