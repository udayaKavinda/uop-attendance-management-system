package lk.ac.pdn.eng.feats.data.net

import com.squareup.moshi.Json

/*
 * Data Transfer Objects mirroring the Express server's JSON responses.
 * Field names follow the server exactly (see the server's controllers).
 * Unknown JSON keys are ignored by Moshi; absent keys deserialize to null.
 */

// ── Auth ──────────────────────────────────────────────────────────────────────

data class MeDto(
    @param:Json(name = "studentId") val studentId: String, // Person _id
    val email: String,
    val role: String,
    val lecturerId: String? = null,
)

/** Browser OAuth exchange. */
data class ExchangeCodeReq(val code: String)

/** Single-use nonce for Credential Manager sign-in (replay protection). */
data class NonceDto(val nonce: String)

/** Google ID token from Credential Manager, verified server-side. */
data class GoogleIdTokenReq(val idToken: String)

data class SimpleSuccess(val success: Boolean? = null)
data class AvailabilityDto(val available: Boolean)

// ── People / lecturers ──────────────────────────────────────────────────────────

data class LecturerDto(
    @param:Json(name = "_id") val id: String? = null,
    val name: String? = null,
    val email: String? = null,
    val phone: String? = null,
    val studentId: String? = null,
    val role: String? = null,
    val active: Boolean? = null,
    val deleted: Boolean? = null,
)

data class LecturersRes(val items: List<LecturerDto>? = null)

data class LecturerRes(val success: Boolean? = null, val lecturer: LecturerDto? = null)

data class CreateLecturerReq(val name: String, val email: String, val phone: String? = null)

// ── Courses ───────────────────────────────────────────────────────────────────

data class CourseDto(
    @param:Json(name = "_id") val id: String? = null,
    val code: String? = null,
    val name: String? = null,
    val batch: String? = null,
    val active: Boolean? = null,
    val lecturers: List<LecturerDto>? = null,
)

/** Strict current contract returned only by GET /api/courses/running. */
data class RunningCourseDto(
    @param:Json(name = "_id") val id: String,
    val code: String,
    val name: String,
    val batch: String,
    /** "bluetooth" | "geofence" | "both". */
    val verification: String,
    val manualCodeEnabled: Boolean,
)

/** Compact course reference embedded in other payloads. */
data class CourseRefDto(
    @param:Json(name = "_id") val id: String? = null,
    val code: String? = null,
    val name: String? = null,
    val batch: String? = null,
    val active: Boolean? = null,
)

data class CoursesRes(val items: List<CourseDto>? = null)
data class RunningCoursesRes(val items: List<RunningCourseDto>)

data class CourseRes(val success: Boolean? = null, val course: CourseDto? = null)

data class CreateCourseReq(
    val name: String,
    val code: String,
    val batch: String,
    val lecturerIds: List<String>? = null,
)

data class AssignLecturerReq(val lecturerIds: List<String>)

// ── Sessions ───────────────────────────────────────────────────────────────────

/**
 * Session as returned by course-scoped lists and by action responses
 * (activate / deactivate / broadcast). The `course` key is intentionally
 * omitted: it can be either a string id or an object depending on the endpoint,
 * and the caller already knows the course in these contexts.
 */
data class SessionDto(
    @param:Json(name = "_id") val id: String? = null,
    val lectureDay: String? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val recurring: Boolean? = null,
    val occurrenceDate: String? = null,
    val broadcasting: Boolean? = null,
    val active: Boolean? = null,
    val deleted: Boolean? = null,
)

/** Session as returned by GET /api/admin/sessions, where `course` is populated. */
data class StaffSessionDto(
    @param:Json(name = "_id") val id: String? = null,
    val course: CourseRefDto? = null,
    val lectureDay: String? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val recurring: Boolean? = null,
    val occurrenceDate: String? = null,
    val broadcasting: Boolean? = null,
    val active: Boolean? = null,
    val deleted: Boolean? = null,
    /** "bluetooth" | "geofence" | "both". */
    val verification: String,
    val buildings: List<String>? = null,
    val manualCodeRotationMode: String? = null,
    val manualCodeRotationSeconds: Int? = null,
    /** Set at creation (Create Session tab); the session card only shows live
     *  controls (reveal/pause/regenerate) when this is true — no enable switch there. */
    val manualCodeEnabled: Boolean? = null,
)

data class StaffSessionsRes(val items: List<StaffSessionDto>? = null)

data class SessionRes(val success: Boolean? = null, val session: SessionDto? = null)

data class CreateSessionReq(
    val lectureDay: String,
    val startTime: String,
    val endTime: String,
    val recurring: Boolean,
    /** "bluetooth" | "geofence" | "both". */
    val verification: String,
    /** Geofence ids; required by the server when verification includes geofence. */
    val buildings: List<String>? = null,
    val manualCodeEnabled: Boolean? = null,
    val manualCodeRotationMode: String? = null,
    val manualCodeRotationSeconds: Int? = null,
)

/** Body of PATCH /api/admin/sessions/:id/broadcast. */
data class SetBroadcastReq(val on: Boolean)

/** Element of GET /api/admin/sessions/running. */
data class RunningSessionDto(
    val sessionId: String? = null,
    val broadcasting: Boolean? = null,
)

data class RunningSessionsRes(val items: List<RunningSessionDto>? = null)

/** Response of GET /api/admin/sessions/:id/broadcast (token poll + heartbeat). */
data class BroadcastDto(
    val sessionId: String? = null,
    val broadcasting: Boolean? = null,
    val token: String? = null,
    val rotatesIn: Long? = null,
    val rotationMs: Long? = null,
    /** Students marked present today for this session — surfaced in the notification/dashboard. */
    val attendanceCount: Int? = null,
    /** Minutes left in the session's scheduled window. */
    val minutesRemaining: Int? = null,
)

// ── Manual attendance code (lecturer-controlled fallback) ──────────────────────────

/** Response of GET/PATCH .../sessions/:id/manual-code. */
data class ManualCodeStatusDto(
    val success: Boolean? = null,
    val enabled: Boolean? = null,
    /** Whether the global admin kill-switch currently allows the feature at all. */
    val allowed: Boolean? = null,
    /** Whether the session is inside its scheduled window right now — the code is
     *  only actually live (non-null) while this is true. */
    val running: Boolean? = null,
    val paused: Boolean? = null,
    val rotationMode: String? = null,
    val rotationSeconds: Int? = null,
    /** The live 8-digit code. Staff-only; never present on any student-facing payload. */
    val code: String? = null,
    val rotatesIn: Int? = null,
)

/** Body for PATCH .../sessions/:id/manual-code. Every field is independently optional. */
data class ManualCodeConfigReq(
    val enabled: Boolean? = null,
    val rotationMode: String? = null,
    val rotationSeconds: Int? = null,
    val paused: Boolean? = null,
    val regenerate: Boolean? = null,
)

/** Global settings singleton. Readable by any staff; only admins may write. */
data class SettingsDto(
    val manualCodeAllowed: Boolean? = null,
    /** Per-policy admin switches — a lecturer picks among whichever are enabled. */
    val bluetoothAllowed: Boolean? = null,
    val geofenceAllowed: Boolean? = null,
    /** Server-derived from the two switches above: the values a session may use. */
    val allowedVerifications: List<String>? = null,
    /** Target concurrent BLE seeder count; 0 disables peer seeding. */
    val seedRate: Int? = null,
    /** Real-seeder AND decoy window duration, ms — identical for both by design. */
    val seedWindowMs: Long? = null,
    /** GPS buffer (meters) for geofence-only sessions. */
    val bufferGpsOnly: Double? = null,
    /** GPS buffer (meters) for the GPS fallback path within "both" sessions. */
    val bufferGpsBle: Double? = null,
)

/** Body for PATCH /api/admin/settings — every field independently optional. */
data class SettingsReq(
    val manualCodeAllowed: Boolean? = null,
    val bluetoothAllowed: Boolean? = null,
    val geofenceAllowed: Boolean? = null,
    val seedRate: Int? = null,
    val seedWindowMs: Long? = null,
    val bufferGpsOnly: Double? = null,
    val bufferGpsBle: Double? = null,
)

// ── Geofences (admin building polygons) ─────────────────────────────────────────

data class GeofenceDto(
    @param:Json(name = "_id") val id: String? = null,
    val name: String? = null,
    /** Ordered [lng, lat] vertices. */
    val polygon: List<List<Double>>? = null,
    val active: Boolean? = null,
)

data class GeofencesRes(val items: List<GeofenceDto>? = null)
data class GeofenceRes(val success: Boolean? = null, val geofence: GeofenceDto? = null)
data class GeofenceCreateReq(val name: String, val polygon: List<List<Double>>)
data class GeofenceUpdateReq(
    val name: String? = null,
    val polygon: List<List<Double>>? = null,
    val active: Boolean? = null,
)

// ── Attendance (student) ────────────────────────────────────────────────────────

data class AttendanceStatusDto(
    val attended: Boolean? = null,
)

// ── Unified attendance (BLE token / GPS fix / manual code, one at a time) ──────────

data class GpsFixDto(val lat: Double, val lng: Double, val accuracy: Float)

/** Body for POST /api/attendance — exactly one of token/fix/code is set. */
data class UnifiedAttendanceReq(
    val courseId: String,
    val token: String? = null,
    val fix: GpsFixDto? = null,
    val code: String? = null,
    /** Whether this device can BLE-advertise — reported so the server only ever
     *  picks capable devices as real seeders (decision 1). */
    val canAdvertise: Boolean = false,
)

/** Present only when `role == "seed"`; absent (decoy/none) otherwise. */
data class SeedingDto(
    val role: String? = null, // "seed" | "decoy" | "none"
    val durationMs: Long? = null,
    val token: String? = null,
    /** "seed" role only — needed to re-fetch the rotating seeder token. */
    val sessionId: String? = null,
)

data class UnifiedAttendanceRes(
    val status: String? = null, // "pending" | "accepted"
    val duplicate: Boolean? = null,
    val seeding: SeedingDto? = null,
)

/** Response of GET /api/attendance/seed-token — seeder re-fetch + heartbeat. */
data class SeedTokenDto(
    val sessionId: String? = null,
    val token: String? = null,
    val rotatesIn: Long? = null,
)

// ── Attendance matrix (staff) ────────────────────────────────────────────────────

data class MatrixSessionDto(
    @param:Json(name = "_id") val id: String? = null,
    val label: String? = null,
)

data class MatrixRowDto(
    val displayId: String? = null,
    val email: String? = null,
    /** Session id -> present. Missing/false means absent. */
    val attendance: Map<String, Boolean>? = null,
)

data class AttendanceMatrixRes(
    val course: CourseRefDto? = null,
    val sessions: List<MatrixSessionDto>? = null,
    val rows: List<MatrixRowDto>? = null,
)
