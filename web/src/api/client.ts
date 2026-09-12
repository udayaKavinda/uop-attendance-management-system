import type {
  AttendanceMatrixRes,
  AttendanceStatusRes,
  CourseCatalogRes,
  CourseRes,
  CoursesRes,
  CreateCourseReq,
  CreateCourseRes,
  CreateSessionReq,
  GeofencesRes,
  LecturersRes,
  ManualCodeConfigReq,
  ManualCodeStatus,
  Me,
  RegisteredCoursesRes,
  RunningCoursesRes,
  RunningSessionsRes,
  SessionRes,
  Settings,
  StaffSessionsRes,
  UnifiedAttendanceReq,
  UnifiedAttendanceRes,
  WebConfig,
} from './types';

/** Matches ADMIN_LIST_PAGE_SIZE in Android/…/data/repo/AppRepository.kt. */
const ADMIN_LIST_PAGE_SIZE = 50;

/**
 * Mirrors the native app's ApiResult (see Android/…/data/net/ApiResult.kt).
 *
 * `status: null` specifically means the request never reached the server — no
 * HTTP status came back. The check-in loop depends on telling that apart from a
 * real verdict: a transport failure says nothing about the evidence submitted
 * and may be retried, a real response is final for that submission.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; status: number | null };

/** Called when the server rejects the session cookie, so the UI can drop to login. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      // Same-origin in every environment (the dev server proxies /api and /auth),
      // so the httpOnly session cookie rides along without Safari's third-party
      // cookie blocking ever coming into play.
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        // The server's CSRF guard requires this on every mutating /api request:
        // a cross-site HTML form cannot set it. See server/src/middlewares/csrf.js.
        'X-Requested-With': 'XMLHttpRequest',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    // The reader is a student or a lecturer mid-lecture, and every cause of a
    // thrown fetch is the same from their side: the request never got an answer.
    // Say that, and say what to do about it.
    return {
      ok: false,
      message: "Couldn't reach the server. Check your connection and try again.",
      status: null,
    };
  }

  if (res.status === 401) onUnauthorized();

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // A non-JSON body (proxy error page, empty 204) is not itself a failure.
  }

  if (!res.ok) {
    const parsed = body as { error?: string; message?: string } | null;
    return {
      ok: false,
      message: parsed?.error || parsed?.message || `Request failed (${res.status})`,
      status: res.status,
    };
  }
  return { ok: true, data: (body ?? {}) as T };
}

export const api = {
  webConfig: () => request<WebConfig>('/api/web-config'),

  me: () => request<Me>('/api/me'),

  logout: () => request<{ success?: boolean }>('/api/logout', { method: 'POST' }),

  runningCourses: () => request<RunningCoursesRes>('/api/courses/running'),

  courseCatalog: () => request<CourseCatalogRes>('/api/courses/catalog'),

  registeredCourses: () => request<RegisteredCoursesRes>('/api/courses/registered'),

  registerCourse: (courseId: string) =>
    request<{ success?: boolean }>(`/api/courses/registered/${encodeURIComponent(courseId)}`, {
      method: 'POST',
    }),

  unregisterCourse: (courseId: string) =>
    request<{ success?: boolean }>(`/api/courses/registered/${encodeURIComponent(courseId)}`, {
      method: 'DELETE',
    }),

  attendanceStatus: (courseId: string) =>
    request<AttendanceStatusRes>(`/api/attendance-status?courseId=${encodeURIComponent(courseId)}`),

  recordAttendance: (body: UnifiedAttendanceReq) =>
    request<UnifiedAttendanceRes>('/api/attendance', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /*
   * ── Staff ──────────────────────────────────────────────────────────────────
   *
   * Every route below is guarded server-side by `requireStaff` alone — a pure
   * role check with no platform gate — so the browser reaches them exactly as
   * the native app does, over the same session cookie. See
   * server/src/routes/admin/*.routes.js.
   *
   * TWO ENDPOINTS ARE DELIBERATELY MISSING, and must stay missing:
   *
   *   PATCH /api/admin/sessions/:id/broadcast
   *   GET   /api/admin/sessions/:id/broadcast
   *
   * `broadcasting` means "a BLE radio is on the air for this session". No
   * browser can advertise as a BLE peripheral — Web Bluetooth is central/scan
   * only, everywhere, and Safari has no Web Bluetooth at all — so a web
   * lecturer never has one.
   *
   * Setting the flag anyway would make every other staff device render
   * "Broadcasting from another device" (see StaffDashboardScreen.kt:1474), so a
   * colleague standing in that room would believe Bluetooth was covered and not
   * start the one broadcast that would actually have worked. It would also
   * flicker: the flag is kept alive by the GET poll's heartbeat, so without one
   * it decays after BROADCAST_STALE_MS and sessionExpiry.service.js sweeps it
   * closed — an intermittent lie is worse than none.
   *
   * Not calling them is not a gap. `broadcasting` stays false, so
   * GET /api/bluetooth-target answers `available: false`, and students skip the
   * BLE scan and verify by GPS (falling back to the lecturer's code) — which is
   * exactly right when nothing is transmitting.
   *
   * The GET is doubly forbidden: that poll IS the broadcaster's heartbeat.
   * Calling it from a non-broadcasting viewer would keep a dead Android
   * broadcast looking alive to students. `broadcasting` is read from the
   * sessions/running list payloads instead, never polled.
   */

  adminCourses: (page: number, lecturerId?: string) =>
    request<CoursesRes>(
      `/api/admin/courses?page=${page}&limit=${ADMIN_LIST_PAGE_SIZE}` +
        (lecturerId ? `&lecturerId=${encodeURIComponent(lecturerId)}` : ''),
    ),

  createCourse: (body: CreateCourseReq) =>
    request<CreateCourseRes>('/api/admin/courses', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  assignLecturers: (courseId: string, lecturerIds: string[]) =>
    request<CourseRes>(`/api/admin/courses/${encodeURIComponent(courseId)}/assign-lecturer`, {
      method: 'PATCH',
      body: JSON.stringify({ lecturerIds }),
    }),

  disableCourse: (courseId: string) =>
    request<CourseRes>(`/api/admin/courses/${encodeURIComponent(courseId)}/disable`, {
      method: 'PATCH',
    }),

  enableCourse: (courseId: string) =>
    request<CourseRes>(`/api/admin/courses/${encodeURIComponent(courseId)}/enable`, {
      method: 'PATCH',
    }),

  createSession: (courseId: string, body: CreateSessionReq) =>
    request<SessionRes>(`/api/admin/courses/${encodeURIComponent(courseId)}/sessions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  attendanceMatrix: (courseId: string) =>
    request<AttendanceMatrixRes>(
      `/api/admin/courses/${encodeURIComponent(courseId)}/attendance-matrix`,
    ),

  allSessions: (page: number) =>
    request<StaffSessionsRes>(`/api/admin/sessions?page=${page}&limit=${ADMIN_LIST_PAGE_SIZE}`),

  runningSessions: () => request<RunningSessionsRes>('/api/admin/sessions/running'),

  deleteSession: (sessionId: string) =>
    request<{ success?: boolean }>(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }),

  activateSession: (sessionId: string) =>
    request<SessionRes>(`/api/admin/sessions/${encodeURIComponent(sessionId)}/activate`, {
      method: 'PATCH',
    }),

  deactivateSession: (sessionId: string) =>
    request<SessionRes>(`/api/admin/sessions/${encodeURIComponent(sessionId)}/deactivate`, {
      method: 'PATCH',
    }),

  manualCodeStatus: (sessionId: string) =>
    request<ManualCodeStatus>(
      `/api/admin/sessions/${encodeURIComponent(sessionId)}/manual-code`,
    ),

  setManualCode: (sessionId: string, body: ManualCodeConfigReq) =>
    request<ManualCodeStatus>(`/api/admin/sessions/${encodeURIComponent(sessionId)}/manual-code`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** Readable by any staff; this client never writes settings. */
  settings: () => request<Settings>('/api/admin/settings'),

  /** Readable by any staff; drawing buildings stays on the Android admin tool. */
  geofences: () => request<GeofencesRes>('/api/admin/geofences'),

  lecturers: (q: string) =>
    request<LecturersRes>(`/api/admin/lecturers?q=${encodeURIComponent(q)}`),
};
