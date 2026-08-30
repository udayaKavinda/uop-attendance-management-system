import type {
  AttendanceStatusRes,
  Me,
  RunningCoursesRes,
  UnifiedAttendanceReq,
  UnifiedAttendanceRes,
} from './types';

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
    return { ok: false, message: 'Network error', status: null };
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
  me: () => request<Me>('/api/me'),

  logout: () => request<{ success?: boolean }>('/api/logout', { method: 'POST' }),

  runningCourses: () => request<RunningCoursesRes>('/api/courses/running'),

  attendanceStatus: (courseId: string) =>
    request<AttendanceStatusRes>(`/api/attendance-status?courseId=${encodeURIComponent(courseId)}`),

  recordAttendance: (body: UnifiedAttendanceReq) =>
    request<UnifiedAttendanceRes>('/api/attendance', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
