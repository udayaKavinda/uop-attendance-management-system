/*
 * The student-facing slice of the server's JSON contract.
 * Field names follow the server exactly — see the Express controllers, and
 * Android/…/data/net/Dto.kt, which mirrors the same endpoints for the native app.
 */

/**
 * GET /api/web-config — public, read before sign-in.
 *
 * `allowNonIos` is the admin's escape hatch for when the Android app is
 * unavailable. Absent or false means this client serves iOS only.
 */
export interface WebConfig {
  allowNonIos?: boolean;
}

/** GET /api/me */
export interface Me {
  studentId: string;
  email: string;
  role: string;
  lecturerId: string | null;
}

/**
 * Element of GET /api/courses/running. Identity only: every session verifies the
 * same way, so the flow never branches per course.
 */
export interface RunningCourse {
  _id: string;
  code: string;
  name: string;
  batch: string;
}

export interface RunningCoursesRes {
  items: RunningCourse[];
}

/**
 * Element of GET /api/courses/catalog — every unarchived course, campus-wide,
 * ignoring session state entirely (unlike RunningCourse, which only exists
 * while a session is actually live). Backs the registration screen.
 */
export interface CourseSummary {
  _id: string;
  code: string;
  name: string;
  batch: string;
}

export interface CourseCatalogRes {
  items: CourseSummary[];
}

/** GET /api/courses/registered — the signed-in student's registered course ids. */
export interface RegisteredCoursesRes {
  items: string[];
}

/** GET /api/attendance-status — "present" | "flagged" | "none". */
export interface AttendanceStatusRes {
  status?: string;
}

/** One GPS reading, matching the server's fix shape (see gpsFix.service.js). */
export interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number;
}

/**
 * Body for POST /api/attendance — exactly one of token/fix/code.
 *
 * `token` exists on the native app only: it carries a Bluetooth beacon payload,
 * and no iOS browser can read one (Safari has no Web Bluetooth). This client
 * sends `fix` or `code`, never `token`.
 */
export interface UnifiedAttendanceReq {
  courseId: string;
  fix?: GpsFix;
  code?: string;
  /**
   * Whether this device can BLE-advertise for peer seeding. Always false here:
   * a browser cannot advertise, and the server only ever picks primary-BLE-verified
   * devices as seeders anyway, so a web client is never given a seeding window.
   */
  canAdvertise: boolean;
}

/**
 * `status` is one of:
 *   "collecting" — no verdict yet. Deliberately covers both "still gathering
 *                  fixes" and "gathered enough, but not in a passing band", so
 *                  the client can never learn its own distance band.
 *   "accepted"   — recorded present.
 *   "flagged"    — code accepted from outside the trusted bands (far/unknown).
 */
export interface UnifiedAttendanceRes {
  status?: string;
  duplicate?: boolean;
}

/*
 * ── Staff slice ──────────────────────────────────────────────────────────────
 *
 * Mirrors the staff half of Android/…/data/net/Dto.kt, name-for-name. Every
 * field is optional for the same reason it is nullable there: these payloads
 * come from several endpoints that each populate a different subset.
 *
 * Deliberately absent: `BroadcastDto`. That payload only comes from
 * GET /api/admin/sessions/:id/broadcast, which this client must never call —
 * see the note on `api.setBroadcast` in client.ts.
 */

export interface Lecturer {
  _id?: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  active?: boolean;
}

export interface LecturersRes {
  items?: Lecturer[];
  total?: number;
  page?: number;
  hasMore?: boolean;
}

export interface Course {
  _id?: string;
  code?: string;
  name?: string;
  batch?: string;
  active?: boolean;
  lecturers?: Lecturer[];
}

export interface CoursesRes {
  items?: Course[];
  total?: number;
  page?: number;
  hasMore?: boolean;
}

export interface CreateCourseReq {
  name: string;
  code: string;
  batches: string[];
  lecturerIds?: string[];
}

export interface CreateCourseRes {
  success?: boolean;
  courses?: Course[];
}

export interface CourseRes {
  success?: boolean;
  course?: Course;
}

/** Compact course reference embedded in session payloads. */
export interface CourseRef {
  _id?: string;
  code?: string;
  name?: string;
  batch?: string;
  active?: boolean;
}

/** Session as returned by GET /api/admin/sessions, where `course` is populated. */
export interface StaffSession {
  _id?: string;
  course?: CourseRef;
  lectureDay?: string;
  startTime?: string;
  endTime?: string;
  recurring?: boolean;
  occurrenceDate?: string;
  /** Server-side "someone's radio is on the air", read-only here — never set from web. */
  broadcasting?: boolean;
  active?: boolean;
  deleted?: boolean;
  /** Geofence ids. Always at least one — required at creation. */
  buildings?: string[];
  manualCodeRotationMode?: string;
  manualCodeRotationSeconds?: number;
}

export interface StaffSessionsRes {
  items?: StaffSession[];
  total?: number;
  page?: number;
  hasMore?: boolean;
}

/**
 * Element of GET /api/admin/sessions/running — sessions whose scheduled window is
 * open right now, NOT filtered by `active`, so the client can tell Within-session
 * (in window, active:false) from Collecting (in window, active:true).
 */
export interface RunningSession {
  sessionId?: string;
  active?: boolean;
  broadcasting?: boolean;
}

export interface RunningSessionsRes {
  items?: RunningSession[];
}

export interface CreateSessionReq {
  lectureDay: string;
  startTime: string;
  endTime: string;
  recurring: boolean;
  /** Geofence ids. At least one is mandatory — GPS runs for every session. */
  buildings: string[];
  manualCodeRotationMode?: string;
  manualCodeRotationSeconds?: number;
}

export interface SessionRes {
  success?: boolean;
  session?: StaffSession;
  /**
   * Confirmation copy from the server, naming the date it derived for a one-time
   * session. Optional so an older server (which does not send it) still works —
   * callers fall back to their own generic line.
   */
  message?: string;
}

/**
 * GET/PATCH .../sessions/:id/manual-code. Every session has a code — the only
 * choice is whether it rotates. `code` is non-null only while `running`.
 */
export interface ManualCodeStatus {
  success?: boolean;
  running?: boolean;
  paused?: boolean;
  rotationMode?: string;
  rotationSeconds?: number;
  code?: string;
  rotatesIn?: number;
}

export interface ManualCodeConfigReq {
  rotationMode?: string;
  rotationSeconds?: number;
  paused?: boolean;
  regenerate?: boolean;
}

export interface Geofence {
  _id?: string;
  name?: string;
  /** Ordered [lng, lat] vertices. Read-only here — drawing stays on Android. */
  polygon?: number[][];
  active?: boolean;
}

export interface GeofencesRes {
  items?: Geofence[];
}

/**
 * Global settings singleton. Read-only on this client: only `bleEnabled` is
 * consulted, to word the session card the same way the native app does.
 */
export interface Settings {
  bleEnabled?: boolean;
  webAllowNonIos?: boolean;
  nearBufferM?: number;
  farBufferM?: number;
  seedRate?: number;
  seedWindowMs?: number;
  studentEmailDomain?: string;
  minSupportedVersionCode?: number;
}

export interface MatrixSession {
  _id?: string;
  label?: string;
}

export interface MatrixRow {
  displayId?: string;
  email?: string;
  /** Session id -> "present" | "flagged". A missing key means absent. */
  attendance?: Record<string, string>;
}

export interface AttendanceMatrixRes {
  course?: CourseRef;
  sessions?: MatrixSession[];
  rows?: MatrixRow[];
}
