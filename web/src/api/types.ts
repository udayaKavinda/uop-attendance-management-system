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
