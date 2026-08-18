package lk.ac.pdn.eng.feats.data.repo

import lk.ac.pdn.eng.feats.data.net.ApiResult
import lk.ac.pdn.eng.feats.data.net.ApiService
import lk.ac.pdn.eng.feats.data.net.AssignLecturerReq
import lk.ac.pdn.eng.feats.data.net.AttendanceMatrixRes
import lk.ac.pdn.eng.feats.data.net.AttendanceStatusDto
import lk.ac.pdn.eng.feats.data.net.BluetoothAttendanceReq
import lk.ac.pdn.eng.feats.data.net.BluetoothAttendanceRes
import lk.ac.pdn.eng.feats.data.net.BroadcastDto
import lk.ac.pdn.eng.feats.data.net.CourseDto
import lk.ac.pdn.eng.feats.data.net.CreateCourseReq
import lk.ac.pdn.eng.feats.data.net.CreateLecturerReq
import lk.ac.pdn.eng.feats.data.net.CreateSessionReq
import lk.ac.pdn.eng.feats.data.net.GoogleIdTokenReq
import lk.ac.pdn.eng.feats.data.net.LecturerDto
import lk.ac.pdn.eng.feats.data.net.MeDto
import lk.ac.pdn.eng.feats.data.net.RosterRecordDto
import lk.ac.pdn.eng.feats.data.net.RunningSessionDto
import lk.ac.pdn.eng.feats.data.net.SessionDto
import lk.ac.pdn.eng.feats.data.net.SetBroadcastReq
import lk.ac.pdn.eng.feats.data.net.StaffSessionDto
import lk.ac.pdn.eng.feats.data.net.UpdateLecturerReq
import lk.ac.pdn.eng.feats.data.net.apiCall

/**
 * Thin facade over [ApiService] returning [ApiResult]. Repositories are kept
 * stateless; UI state lives in the ViewModels.
 */
class AppRepository(private val api: ApiService) {

    // ── Auth ─────────────────────────────────────────────────────────────────────
    /** Single-use nonce for the Credential Manager sign-in handshake. */
    suspend fun googleNonce(): ApiResult<String?> = apiCall { api.googleNonce().nonce }

    /** Exchanges a verified Google ID token for a server session cookie. */
    suspend fun googleIdToken(idToken: String): ApiResult<Unit> =
        apiCall { api.googleIdToken(GoogleIdTokenReq(idToken)); Unit }

    suspend fun exchangeCode(code: String): ApiResult<Unit> =
        apiCall { api.exchangeCode(lk.ac.pdn.eng.feats.data.net.ExchangeCodeReq(code)); Unit }

    suspend fun me(): ApiResult<MeDto> = apiCall { api.me() }

    suspend fun logout(): ApiResult<Unit> = apiCall { api.logout(); Unit }

    // ── Courses ────────────────────────────────────────────────────────────────────
    suspend fun runningCourses(): ApiResult<List<CourseDto>> =
        apiCall { api.runningCourses().items ?: emptyList() }

    suspend fun courses(): ApiResult<List<CourseDto>> =
        apiCall { api.courses().items ?: emptyList() }

    suspend fun adminCourses(): ApiResult<List<CourseDto>> =
        apiCall { api.adminCourses().items ?: emptyList() }

    suspend fun createCourse(req: CreateCourseReq): ApiResult<CourseDto?> =
        apiCall { api.createCourse(req).course }

    suspend fun assignLecturer(courseId: String, lecturerIds: List<String>): ApiResult<CourseDto?> =
        apiCall { api.assignLecturer(courseId, AssignLecturerReq(lecturerIds)).course }

    suspend fun deleteCourse(courseId: String): ApiResult<Unit> =
        apiCall { api.deleteCourse(courseId); Unit }

    suspend fun disableCourse(courseId: String): ApiResult<Unit> =
        apiCall { api.disableCourse(courseId); Unit }

    suspend fun enableCourse(courseId: String): ApiResult<Unit> =
        apiCall { api.enableCourse(courseId); Unit }

    // ── Sessions ───────────────────────────────────────────────────────────────────
    suspend fun allSessions(): ApiResult<List<StaffSessionDto>> =
        apiCall { api.allSessions().items ?: emptyList() }

    suspend fun courseSessions(courseId: String): ApiResult<List<SessionDto>> =
        apiCall { api.courseSessions(courseId).items ?: emptyList() }

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

    suspend fun sessionAttendance(sessionId: String): ApiResult<List<RosterRecordDto>> =
        apiCall { api.sessionAttendance(sessionId).records ?: emptyList() }

    // ── Attendance (student) ──────────────────────────────────────────────────────────
    suspend fun attendanceStatus(courseId: String): ApiResult<AttendanceStatusDto> =
        apiCall { api.attendanceStatus(courseId) }

    suspend fun bluetoothTarget(courseId: String): ApiResult<String?> =
        apiCall { api.bluetoothTarget(courseId).deviceName }

    suspend fun recordBluetoothAttendance(courseId: String, token: String): ApiResult<BluetoothAttendanceRes> =
        apiCall { api.recordBluetoothAttendance(BluetoothAttendanceReq(courseId, token)) }

    // ── Lecturers (admin) ───────────────────────────────────────────────────────────────
    suspend fun lecturers(query: String? = null): ApiResult<List<LecturerDto>> =
        apiCall { api.lecturers(query?.takeIf { it.isNotBlank() }).items ?: emptyList() }

    suspend fun createLecturer(req: CreateLecturerReq): ApiResult<LecturerDto?> =
        apiCall { api.createLecturer(req).lecturer }

    suspend fun updateLecturer(id: String, req: UpdateLecturerReq): ApiResult<LecturerDto?> =
        apiCall { api.updateLecturer(id, req).lecturer }

    suspend fun matrix(courseId: String): ApiResult<AttendanceMatrixRes> =
        apiCall { api.attendanceMatrix(courseId) }

    suspend fun deleteLecturer(id: String): ApiResult<Unit> =
        apiCall { api.deleteLecturer(id); Unit }
}
