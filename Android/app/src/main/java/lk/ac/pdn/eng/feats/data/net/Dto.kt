package lk.ac.pdn.eng.feats.data.net

import com.squareup.moshi.Json

/*
 * Data Transfer Objects mirroring the Express server's JSON responses.
 * Field names follow the server exactly (see the server's controllers).
 * Unknown JSON keys are ignored by Moshi; absent keys deserialize to null.
 */

// ── Auth ──────────────────────────────────────────────────────────────────────

data class MeDto(
    @Json(name = "studentId") val studentId: String? = null, // Person _id
    val email: String? = null,
    val role: String? = null,
    val lecturerId: String? = null,
)

/** Legacy Custom Tab OAuth fallback. */
data class ExchangeCodeReq(val code: String)

/** Single-use nonce for Credential Manager sign-in (replay protection). */
data class NonceDto(val nonce: String? = null)

/** Google ID token from Credential Manager, verified server-side. */
data class GoogleIdTokenReq(val idToken: String)

data class SimpleSuccess(val success: Boolean? = null)

// ── People / lecturers ──────────────────────────────────────────────────────────

data class LecturerDto(
    @Json(name = "_id") val id: String? = null,
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

data class UpdateLecturerReq(
    val name: String? = null,
    val email: String? = null,
    val phone: String? = null,
    val active: Boolean? = null,
)

// ── Courses ───────────────────────────────────────────────────────────────────

data class CourseDto(
    @Json(name = "_id") val id: String? = null,
    val code: String? = null,
    val name: String? = null,
    val batch: String? = null,
    val active: Boolean? = null,
    val lecturers: List<LecturerDto>? = null,
)

/** Compact course reference embedded in other payloads. */
data class CourseRefDto(
    @Json(name = "_id") val id: String? = null,
    val code: String? = null,
    val name: String? = null,
    val batch: String? = null,
    val active: Boolean? = null,
)

data class CoursesRes(val items: List<CourseDto>? = null)

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
    @Json(name = "_id") val id: String? = null,
    val lectureDay: String? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val recurring: Boolean? = null,
    val broadcasting: Boolean? = null,
    val bluetoothDeviceName: String? = null,
    val active: Boolean? = null,
    val deleted: Boolean? = null,
)

/** Session as returned by GET /api/admin/sessions, where `course` is populated. */
data class StaffSessionDto(
    @Json(name = "_id") val id: String? = null,
    val course: CourseRefDto? = null,
    val lectureDay: String? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val recurring: Boolean? = null,
    val broadcasting: Boolean? = null,
    val bluetoothDeviceName: String? = null,
    val active: Boolean? = null,
    val deleted: Boolean? = null,
)

data class SessionsRes(val items: List<SessionDto>? = null)

data class StaffSessionsRes(val items: List<StaffSessionDto>? = null)

data class SessionRes(val success: Boolean? = null, val session: SessionDto? = null)

data class CreateSessionReq(
    val lectureDay: String,
    val startTime: String,
    val endTime: String,
    val recurring: Boolean = true,
)

/** Body of PATCH /api/admin/sessions/:id/broadcast. */
data class SetBroadcastReq(val on: Boolean)

/** Element of GET /api/admin/sessions/running. */
data class RunningSessionDto(
    val sessionId: String? = null,
    val broadcasting: Boolean? = null,
    val deviceName: String? = null,
)

data class RunningSessionsRes(val items: List<RunningSessionDto>? = null)

/** Response of GET /api/admin/sessions/:id/broadcast (token poll + heartbeat). */
data class BroadcastDto(
    val sessionId: String? = null,
    val broadcasting: Boolean? = null,
    val deviceName: String? = null,
    val token: String? = null,
    val rotatesIn: Long? = null,
    val rotationMs: Long? = null,
    /** Students marked present today for this session — surfaced in the notification/dashboard. */
    val attendanceCount: Int? = null,
    /** Minutes left in the session's scheduled window. */
    val minutesRemaining: Int? = null,
)

// ── Attendance (student) ────────────────────────────────────────────────────────

data class AttendanceStatusDto(
    val studentId: String? = null,
    val courseId: String? = null,
    val sessionId: String? = null,
    val attended: Boolean? = null,
    val attendanceId: String? = null,
    val attendedAt: String? = null,
)

data class BluetoothTargetDto(val deviceName: String? = null)

data class BluetoothAttendanceReq(val courseId: String, val token: String)

data class BluetoothAttendanceRes(
    val success: Boolean? = null,
    val duplicate: Boolean? = null,
    val attendance: RecordedAttendanceDto? = null,
)

data class RecordedAttendanceDto(
    @Json(name = "_id") val id: String? = null,
    val courseCode: String? = null,
    val lectureCode: String? = null,
    val attendanceDate: String? = null,
    val timestamp: String? = null,
    val method: String? = null,
)

// ── Attendance roster (staff) ────────────────────────────────────────────────────

data class StudentRefDto(
    @Json(name = "_id") val id: String? = null,
    val studentId: String? = null,
    val email: String? = null,
    val name: String? = null,
)

data class RosterRecordDto(
    @Json(name = "_id") val id: String? = null,
    val student: StudentRefDto? = null,
    val courseCode: String? = null,
    val lectureCode: String? = null,
    val attendanceDate: String? = null,
    val timestamp: String? = null,
    val method: String? = null,
)

data class SessionAttendanceRes(val records: List<RosterRecordDto>? = null)

// ── Attendance matrix (staff) ────────────────────────────────────────────────────

data class MatrixSessionDto(
    @Json(name = "_id") val id: String? = null,
    val label: String? = null,
)

data class MatrixRowDto(
    val displayId: String? = null,
    val email: String? = null,
    val attendance: Map<String, Boolean>? = null,
)

data class AttendanceMatrixRes(
    val course: CourseRefDto? = null,
    val sessions: List<MatrixSessionDto>? = null,
    val rows: List<MatrixRowDto>? = null,
)
