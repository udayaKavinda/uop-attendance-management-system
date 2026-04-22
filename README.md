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
│  ├─ models/        # mongoose schemas (Person → collection `people`)
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

- Users sign in with Google (`/auth/google`).
- Backend creates or resolves a `Student` record and redirects to the frontend with `studentId`.
- **Roles:** `student`, `lecturer`, or `admin`. All accounts live in the MongoDB **`people`** collection (`Person` model). Lecturers are `Person` documents with `role: 'lecturer'` (managed in the console). Google sign-in matches **email** to an active lecturer row. The `admin` role is never downgraded by that sync.
- Routing: **admin** and **lecturer** go to `/admin` (staff console); **student** goes to `/lecture`.

### 2) Staff console (`/admin`)

**Lecturers** see **Courses**, **Create session**, and **Sessions** for **their own courses** only.

**Administrators** see the same three tabs plus **Lecturers** (directory: name, email, telephone; search; add/remove) and **Presets** (saved polygon rings for reuse when creating sessions). Admins assign each **course owner** when creating a course or via the owner dropdown on each course row.

- **Courses**
  - Add, disable/enable, and delete courses. Each course has **code**, **batch** (required), **name**, and an owning **lecturer**; **code + batch** must be unique together.
  - Deleting a course requires typing **code and batch** (space-separated, as prompted) and deletes related sessions and attendance.
  - Click a course to open its attendance table (`/admin/courses/:courseId/matrix`).
- **Create session**
  - Session: course, day, start/end time, recurring flag, geofence polygons (draw on the map and/or merge optional **presets**).
  - **Enable code rotation?** (`No` by default). Overlapping sessions for the same course/day are blocked unless the older session is deleted.
- **Sessions**
  - Search, activate/deactivate/delete; live codes for running sessions; rotation start/pause controls.
- **Lecturers** (admin only)
  - Maintain lecturer accounts; removal turns that Google user back into a **student** until they are added again.
- **Presets** (admin only)
  - List, draw, save, and delete shared polygon presets on the **Presets** tab (not from Create session).

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
- `GET /api/me?studentId=...` - profile: `studentId` (Mongo `_id` in `people`), `email`, `role`, `lecturerId` (same as `studentId` when `role` is `lecturer`, else null)

### Student-facing attendance

- `GET /api/courses/running` - list courses that currently have a running session
- `GET /api/attendance-status?studentId=...&courseId=...` - attendance status for current active session of selected course
- `POST /api/verify-lecture` - verify submitted code + location against active session
- `POST /api/record-attendance` - record attendance after validation

### Staff / admin API

Header on all `/api/admin/*` routes: `X-Student-Id: <studentId>` (the logged-in user’s Mongo `_id`).

- **Lecturer** access is allowed only for resources belonging to their courses (except where noted as admin-only).
- **Admin** has full access.

### Courses (staff)

- `GET /api/admin/courses` - list courses (**lecturer:** own courses only; **admin:** all)
- `POST /api/admin/courses` - create course (`code`, `batch`, `name`; **admin** must send `lecturerId`; lecturer’s own profile is applied automatically)
- `PATCH /api/admin/courses/:courseId/disable` | `.../enable` - staff if they own the course (or admin)
- `PATCH /api/admin/courses/:courseId/assign-lecturer` - **admin only** (body: `lecturerId`)
- `DELETE /api/admin/courses/:courseId` - staff if they own the course (or admin); cascade sessions + attendance

### Lecturers & presets (admin only)

- `GET /api/admin/lecturers?q=` - search lecturers by name, email, or phone
- `POST /api/admin/lecturers` - create (`name`, `email`, `phone`)
- `PATCH /api/admin/lecturers/:id` - update fields
- `DELETE /api/admin/lecturers/:id` - revoke lecturer on that **Person** (`role` → `student`, `deleted` → true); same document stays in `people`
- `GET /api/admin/polygon-presets` - list presets (**staff:** lecturers may read for merge-on-create)
- `POST` / `PATCH` / `DELETE /api/admin/polygon-presets/...` - **admin only** (preset CRUD)

### Sessions (staff)

- `GET /api/admin/sessions` - list non-deleted sessions (**lecturer:** sessions for their courses only)
- `GET /api/admin/courses/:courseId/sessions` - list sessions for a course (if staff may access that course)
- `POST /api/admin/courses/:courseId/sessions` - create session
- `PATCH /api/admin/sessions/:sessionId/activate` - activate session
- `PATCH /api/admin/sessions/:sessionId/deactivate` - deactivate session
- `DELETE /api/admin/sessions/:sessionId` - soft-delete session (attendance retained)

### Rotation / live code (staff)

- `GET /api/admin/sessions/current-codes` - live codes for running sessions (**lecturer:** their courses only)
- `GET /api/admin/sessions/:sessionId/current-code` - current code for one session (if staff may access that session)
- `PATCH /api/admin/sessions/:sessionId/rotation/start` - start/resume rotation
- `PATCH /api/admin/sessions/:sessionId/rotation/stop` - pause/freeze current code

### Reporting (staff)

- `GET /api/admin/courses/:courseId/attendance-matrix` - attendance table (allowed if staff may access the course)

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
