# UOP Attendance Management System

This repository contains a React frontend and a simple Node/Express backend with MongoDB.
The application implements an attendance flow where a student signs in with Google, enters a lecture code, and has their location checked before the attendance is recorded.

## Project structure

```
├─ public/           # static assets
├─ src/              # React application (CRA)
│  ├─ components/    # custom UI components
│  ├─ api.js         # helper for backend calls
│  └─ ...
├─ server/           # Node/Express backend
│  ├─ models/        # mongoose schemas
│  └─ index.js       # express server and routes
├─ package.json
└─ README.md
```

## Running locally

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start both frontend and backend**
   ```bash
   npm run dev
   ```

   - frontend: `http://localhost:3000`
   - backend: `http://localhost:5000` (API prefixed with `/api`)

3. **MongoDB**
   Ensure you have a MongoDB instance running locally or point `MONGO_URI` to your database.

4. **Environment (single `.env` in project root)**  
   Create a `.env` file in the project root. The server and Create React App both read from it.  
   For **one-domain reverse proxy** (`https://app.domain.com` for both frontend and backend paths), use:

   ```env
   # same public origin for frontend and backend routes (/api, /auth)
   REACT_APP_API_BASE=
   APP_BASE_URL=https://app.domain.com
   FRONTEND_URL=https://app.domain.com
   MONGO_URI=mongodb://localhost:27017/attendance
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

   Get Google OAuth values from Google Cloud Console → Credentials → OAuth 2.0 Client (Web application). Without them, `/auth/google` will not work. Optional: `SESSION_SECRET` (random string). Optional: `SESSION_EXPIRE_JOB_MS` (milliseconds between non-recurring expiry sweeps; default `60000`, minimum `10000`).

5. **Reverse proxy (one domain)**
   Configure your proxy so a single domain serves both apps:

   - `https://app.domain.com/` -> frontend (`localhost:3000`)
   - `https://app.domain.com/api/*` -> backend (`localhost:5000`)
   - `https://app.domain.com/auth/*` -> backend (`localhost:5000`)

   A ready template is provided at `deploy/nginx-app-domain.conf`.

   In **Google Cloud Console** → OAuth 2.0 Client:
   - **Authorized JavaScript origins:** `https://app.domain.com`
   - **Authorized redirect URIs:** `https://app.domain.com/auth/google/callback`

## Current workflow overview

### 1) Authentication

- Students/admins sign in with Google (`/auth/google`).
- Backend creates or resolves a `Student` record and redirects to frontend with `studentId`.
- Role-based routing sends admin users to `/admin` and students to `/lecture`.

### 2) Admin workflow

The admin dashboard has three tabs:

- **Admin Services**
  - Add, disable/enable, and delete courses. Each course has **code**, **batch** (required), and **name**; **code + batch** must be unique together.
  - Enabled courses are highlighted in green; disabled courses are shown in gray at the bottom.
  - Deleting a course requires typing **code and batch** (space-separated, as prompted) and deletes related sessions and attendance.
  - Click a course to open its attendance table on a separate page (`/admin/courses/:courseId/matrix`).
- **Create Session**
  - Create session with course, day, start/end time, recurring flag, and geofence polygons (drawn from map).
  - Set **Enable code rotation?** (`No` by default).
  - Overlapping sessions for the same course/day are blocked even if older sessions are deactivated (unless deleted).
- **Sessions**
  - Search and view sessions sorted by nearest current time.
  - Activate/deactivate/delete sessions (session delete keeps attendance history).
  - Currently running cards pulse visually.
  - Live code is shown for currently running sessions (rotating or paused/static).
  - Rotation control icon on each running card:
    - `⟳` starts/resumes rotation
    - `⏸` pauses/freezes current code

### 3) Session/code behavior

- Each session keeps persistent rotation configuration/state.
- If rotation is disabled, running session still shows a static (paused) code.
- Rotation can be started at runtime from session card.
- For each new session occurrence/day, a fresh code is reseeded (code is not reused from prior occurrence).
- Non-recurring sessions auto-deactivate after end time (background job on the API server; not tied to incoming HTTP requests).
- If you run **multiple** API instances, either use one scheduler externally or accept duplicate sweeps (idempotent updates); a DB leader lock is not implemented here.

### 4) Student attendance workflow

- Student lecture page shows only courses that currently have running sessions.
- Course selection is a single searchable/selectable field and running courses refresh automatically every 10 seconds.
- Student enters code and submits with location.
- Backend validates:
  - course has active running session
  - submitted code matches current/paused code mode
  - current time within session window
  - location inside any configured polygon
- If valid, attendance is recorded.
- Duplicate protection is per `student + session + date`.
- Attendance status is session-aware, so after a session ends the UI resets for the next session of the same course.

> **Note:** Google OAuth client ID/secret must be set in `.env`. Without them `/auth/google` will not work.

## API endpoints reference

### Authentication

- `GET /auth/google` - start Google OAuth flow
- `GET /auth/google/callback` - OAuth callback/redirect handler
- `POST /api/login` - legacy identifier-based login lookup
- `GET /api/me?studentId=...` - get current user profile/role

### Student-facing attendance

- `GET /api/courses/running` - list courses that currently have a running session
- `GET /api/attendance-status?studentId=...&courseId=...` - attendance status for current active session of selected course
- `POST /api/verify-lecture` - verify submitted code + location against active session
- `POST /api/record-attendance` - record attendance after validation

### Admin courses

All admin endpoints require header: `X-Student-Id: <adminStudentId>`

- `GET /api/admin/courses` - list all courses (enabled + disabled)
- `POST /api/admin/courses` - create course (body: `code`, `batch` required, `name`; unique compound `code` + `batch`)
- `PATCH /api/admin/courses/:courseId/disable` - disable course
- `PATCH /api/admin/courses/:courseId/enable` - enable course
- `DELETE /api/admin/courses/:courseId` - delete course (cascade delete related sessions + attendance)

### Admin sessions

- `GET /api/admin/sessions` - list all non-deleted sessions
- `GET /api/admin/courses/:courseId/sessions` - list sessions for specific course
- `POST /api/admin/courses/:courseId/sessions` - create session
- `PATCH /api/admin/sessions/:sessionId/activate` - activate session
- `PATCH /api/admin/sessions/:sessionId/deactivate` - deactivate session
- `DELETE /api/admin/sessions/:sessionId` - soft-delete session (attendance retained)

### Admin rotation controls/live code

- `GET /api/admin/sessions/current-codes` - live codes for currently running sessions
- `PATCH /api/admin/sessions/:sessionId/rotation/start` - start/resume rotation for session
- `PATCH /api/admin/sessions/:sessionId/rotation/stop` - pause/freeze current code for session

### Reporting

- `GET /api/admin/courses/:courseId/attendance-matrix` - per-course attendance table (rows: student ID from email local-part; columns: earliest attendance date without year + session hours without minutes)

---

The remainder of this file is the original CRA README (truncated)

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
