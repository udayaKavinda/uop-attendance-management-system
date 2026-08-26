package lk.ac.pdn.eng.feats.data.repo

import lk.ac.pdn.eng.feats.data.net.AddLecturerReq
import lk.ac.pdn.eng.feats.data.net.ApiResult
import lk.ac.pdn.eng.feats.data.net.ApiService
import lk.ac.pdn.eng.feats.data.net.AssignLecturerReq
import lk.ac.pdn.eng.feats.data.net.AttendanceMatrixRes
import lk.ac.pdn.eng.feats.data.net.AttendanceStatusDto
import lk.ac.pdn.eng.feats.data.net.BroadcastDto
import lk.ac.pdn.eng.feats.data.net.CourseDto
import lk.ac.pdn.eng.feats.data.net.CreateCourseReq
import lk.ac.pdn.eng.feats.data.net.CreateLecturerReq
import lk.ac.pdn.eng.feats.data.net.CreateSessionReq
import lk.ac.pdn.eng.feats.data.net.GeofenceCreateReq
import lk.ac.pdn.eng.feats.data.net.GeofenceDto
import lk.ac.pdn.eng.feats.data.net.GeofenceUpdateReq
import lk.ac.pdn.eng.feats.data.net.GoogleIdTokenReq
import lk.ac.pdn.eng.feats.data.net.GpsFixDto
import lk.ac.pdn.eng.feats.data.net.LecturerDto
import lk.ac.pdn.eng.feats.data.net.ManualCodeConfigReq
import lk.ac.pdn.eng.feats.data.net.ManualCodeStatusDto
import lk.ac.pdn.eng.feats.data.net.MeDto
import lk.ac.pdn.eng.feats.data.net.Page
import lk.ac.pdn.eng.feats.data.net.PendingReviewDto
import lk.ac.pdn.eng.feats.data.net.ReviewDecisionReq
import lk.ac.pdn.eng.feats.data.net.RunningSessionDto
import lk.ac.pdn.eng.feats.data.net.RunningCourseDto
import lk.ac.pdn.eng.feats.data.net.SeedTokenDto
import lk.ac.pdn.eng.feats.data.net.SessionDto
import lk.ac.pdn.eng.feats.data.net.SetBroadcastReq
import lk.ac.pdn.eng.feats.data.net.SettingsDto
import lk.ac.pdn.eng.feats.data.net.SettingsReq
import lk.ac.pdn.eng.feats.data.net.StaffSessionDto
import lk.ac.pdn.eng.feats.data.net.UnifiedAttendanceReq
import lk.ac.pdn.eng.feats.data.net.UnifiedAttendanceRes
import lk.ac.pdn.eng.feats.data.net.apiCall

/** Page size for the admin Courses/Sessions/Lecturers lists — keeps hundreds of rows off one request. */
const val ADMIN_LIST_PAGE_SIZE = 50

/**
 * Thin facade over [ApiService] returning [ApiResult]. Repositories are kept
 * stateless; UI state lives in the ViewModels.
 */
class AppRepository(private val api: ApiService) {

    // ── Auth ─────────────────────────────────────────────────────────────────────
    /** Single-use nonce for the Credential Manager sign-in handshake. */
    suspend fun googleNonce(): ApiResult<String> = apiCall { api.googleNonce().nonce }

    /** Exchanges a verified Google ID token for a server session cookie. */
    suspend fun googleIdToken(idToken: String): ApiResult<Unit> =
        apiCall { api.googleIdToken(GoogleIdTokenReq(idToken)); Unit }

    suspend fun exchangeCode(code: String): ApiResult<Unit> =
        apiCall { api.exchangeCode(lk.ac.pdn.eng.feats.data.net.ExchangeCodeReq(code)); Unit }

    suspend fun me(): ApiResult<MeDto> = apiCall { api.me() }

    /** Public: the minimum versionCode this app must meet or exceed right now. */
    suspend fun appVersion(): ApiResult<Int> =
        apiCall { api.appVersion().minSupportedVersionCode ?: 0 }

    suspend fun logout(): ApiResult<Unit> = apiCall { api.logout(); Unit }

    // ── Courses ────────────────────────────────────────────────────────────────────
    suspend fun runningCourses(): ApiResult<List<RunningCourseDto>> =
        apiCall { api.runningCourses().items }

    suspend fun adminCourses(page: Int, lecturerId: String? = null): ApiResult<Page<CourseDto>> =
        apiCall {
            val res = api.adminCourses(page, ADMIN_LIST_PAGE_SIZE, lecturerId)
            Page(res.items ?: emptyList(), res.hasMore ?: false)
        }

    suspend fun createCourse(req: CreateCourseReq): ApiResult<List<CourseDto>> =
        apiCall { api.createCourse(req).courses ?: emptyList() }

    suspend fun assignLecturer(courseId: String, lecturerIds: List<String>): ApiResult<CourseDto?> =
        apiCall { api.assignLecturer(courseId, AssignLecturerReq(lecturerIds)).course }

    suspend fun addLecturer(courseId: String, lecturerId: String): ApiResult<CourseDto?> =
        apiCall { api.addLecturer(courseId, AddLecturerReq(lecturerId)).course }

    suspend fun disableCourse(courseId: String): ApiResult<Unit> =
        apiCall { api.disableCourse(courseId); Unit }

    suspend fun enableCourse(courseId: String): ApiResult<Unit> =
        apiCall { api.enableCourse(courseId); Unit }

    // ── Sessions ───────────────────────────────────────────────────────────────────
    suspend fun allSessions(page: Int): ApiResult<Page<StaffSessionDto>> =
        apiCall {
            val res = api.allSessions(page, ADMIN_LIST_PAGE_SIZE)
            Page(res.items ?: emptyList(), res.hasMore ?: false)
        }

    suspend fun createSession(courseId: String, req: CreateSessionReq): ApiResult<SessionDto?> =
        apiCall { api.createSession(courseId, req).session }

    suspend fun runningSessions(): ApiResult<List<RunningSessionDto>> =
        apiCall { api.runningSessions().items ?: emptyList() }

    suspend fun activateSession(sessionId: String): ApiResult<SessionDto?> =
        apiCall { api.activateSession(sessionId).session }

    suspend fun deactivateSession(sessionId: String): ApiResult<SessionDto?> =
        apiCall { api.deactivateSession(sessionId).session }

    /** Server-side broadcast switch: on seeds the token, off removes it. */
    suspend fun setBroadcasting(sessionId: String, on: Boolean): ApiResult<SessionDto?> =
        apiCall { api.setBroadcast(sessionId, SetBroadcastReq(on)).session }

    /** Rotating token poll; each call doubles as the broadcaster heartbeat. */
    suspend fun broadcast(sessionId: String): ApiResult<BroadcastDto> =
        apiCall { api.broadcast(sessionId) }

    suspend fun deleteSession(sessionId: String): ApiResult<Unit> =
        apiCall { api.deleteSession(sessionId); Unit }

    // ── Manual attendance code (staff control) ───────────────────────────────────────
    suspend fun manualCodeStatus(sessionId: String): ApiResult<ManualCodeStatusDto> =
        apiCall { api.manualCodeStatus(sessionId) }

    suspend fun setManualCode(sessionId: String, body: ManualCodeConfigReq): ApiResult<ManualCodeStatusDto> =
        apiCall { api.setManualCode(sessionId, body) }

    // ── Lecturer review queue ────────────────────────────────────────────────────────
    suspend fun pendingReviews(sessionId: String): ApiResult<List<PendingReviewDto>> =
        apiCall { api.pendingReviews(sessionId).items ?: emptyList() }

    suspend fun reviewSubmission(sessionId: String, attendanceId: String, approve: Boolean): ApiResult<Unit> =
        apiCall {
            api.reviewSubmission(
                sessionId,
                attendanceId,
                ReviewDecisionReq(if (approve) "approve" else "reject"),
            )
            Unit
        }

    // ── Settings (admin) ──────────────────────────────────────────────────────────────
    suspend fun settings(): ApiResult<SettingsDto> = apiCall { api.settings() }

    /** Any subset of fields; only non-null ones are sent/applied. */
    suspend fun updateSettings(req: SettingsReq): ApiResult<SettingsDto> =
        apiCall { api.updateSettings(req) }

    // ── Geofences (admin building polygons) ─────────────────────────────────────────────
    suspend fun geofences(): ApiResult<List<GeofenceDto>> =
        apiCall { api.geofences().items ?: emptyList() }

    suspend fun createGeofence(name: String, polygon: List<List<Double>>): ApiResult<GeofenceDto?> =
        apiCall { api.createGeofence(GeofenceCreateReq(name, polygon)).geofence }

    suspend fun updateGeofence(id: String, req: GeofenceUpdateReq): ApiResult<GeofenceDto?> =
        apiCall { api.updateGeofence(id, req).geofence }

    suspend fun deleteGeofence(id: String): ApiResult<Unit> =
        apiCall { api.deleteGeofence(id); Unit }

    // ── Attendance (student) ──────────────────────────────────────────────────────────
    suspend fun attendanceStatus(courseId: String): ApiResult<AttendanceStatusDto> =
        apiCall { api.attendanceStatus(courseId) }

    /** Whether a live BLE channel is worth scanning for; false also when BLE is globally off. */
    suspend fun bluetoothAvailable(courseId: String): ApiResult<Boolean> =
        apiCall { api.bluetoothTarget(courseId).available }

    /** Unified submission — exactly one of token/fix/code. Reports canAdvertise for seeding eligibility. */
    suspend fun recordAttendance(
        courseId: String,
        token: String? = null,
        fix: GpsFixDto? = null,
        code: String? = null,
        canAdvertise: Boolean = false,
    ): ApiResult<UnifiedAttendanceRes> =
        apiCall { api.recordAttendance(UnifiedAttendanceReq(courseId, token, fix, code, canAdvertise)) }

    /** Seeder re-fetch; each call is also this device's heartbeat. */
    suspend fun seedToken(sessionId: String): ApiResult<SeedTokenDto> =
        apiCall { api.seedToken(sessionId) }

    suspend fun releaseSeedToken(sessionId: String): ApiResult<Unit> =
        apiCall { api.releaseSeedToken(sessionId); Unit }

    // ── Lecturers (admin) ───────────────────────────────────────────────────────────────
    /** Typeahead search (Courses-tab filter, Owners dialog) — small result set, no paging needed. */
    suspend fun lecturers(query: String? = null): ApiResult<List<LecturerDto>> =
        apiCall { api.lecturers(query?.takeIf { it.isNotBlank() }).items ?: emptyList() }

    /** Lecturers-tab directory — paged, since an installation may have hundreds of lecturers. */
    suspend fun lecturersPage(page: Int): ApiResult<Page<LecturerDto>> =
        apiCall {
            val res = api.lecturers(q = null, page = page, limit = ADMIN_LIST_PAGE_SIZE)
            Page(res.items ?: emptyList(), res.hasMore ?: false)
        }

    suspend fun createLecturer(req: CreateLecturerReq): ApiResult<LecturerDto?> =
        apiCall { api.createLecturer(req).lecturer }

    suspend fun matrix(courseId: String): ApiResult<AttendanceMatrixRes> =
        apiCall { api.attendanceMatrix(courseId) }

    suspend fun deleteLecturer(id: String): ApiResult<Unit> =
        apiCall { api.deleteLecturer(id); Unit }
}
