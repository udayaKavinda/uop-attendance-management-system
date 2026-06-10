package lk.ac.pdn.eng.attendance.data.repo

import lk.ac.pdn.eng.attendance.data.net.ApiResult
import lk.ac.pdn.eng.attendance.data.net.ApiService
import lk.ac.pdn.eng.attendance.data.net.AssignLecturerReq
import lk.ac.pdn.eng.attendance.data.net.AttendanceMatrixRes
import lk.ac.pdn.eng.attendance.data.net.AttendanceStatusDto
import lk.ac.pdn.eng.attendance.data.net.BluetoothAttendanceReq
import lk.ac.pdn.eng.attendance.data.net.BluetoothAttendanceRes
import lk.ac.pdn.eng.attendance.data.net.BluetoothBroadcastDto
import lk.ac.pdn.eng.attendance.data.net.CourseDto
import lk.ac.pdn.eng.attendance.data.net.CreateCourseReq
import lk.ac.pdn.eng.attendance.data.net.CreateLecturerReq
import lk.ac.pdn.eng.attendance.data.net.CreateSessionReq
import lk.ac.pdn.eng.attendance.data.net.LecturerDto
import lk.ac.pdn.eng.attendance.data.net.MeDto
import lk.ac.pdn.eng.attendance.data.net.RosterRecordDto
import lk.ac.pdn.eng.attendance.data.net.RunningSessionDto
import lk.ac.pdn.eng.attendance.data.net.SessionDto
import lk.ac.pdn.eng.attendance.data.net.SetPausedReq
import lk.ac.pdn.eng.attendance.data.net.StaffSessionDto
import lk.ac.pdn.eng.attendance.data.net.UpdateLecturerReq
import lk.ac.pdn.eng.attendance.data.net.apiCall

/**
 * Thin facade over [ApiService] returning [ApiResult]. Repositories are kept
 * stateless; UI state lives in the ViewModels.
 */
class AppRepository(private val api: ApiService) {

    // ── Auth ─────────────────────────────────────────────────────────────────────
    suspend fun exchangeCode(code: String): ApiResult<Unit> =
        apiCall { api.exchangeCode(lk.ac.pdn.eng.attendance.data.net.ExchangeCodeReq(code)); Unit }

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

    suspend fun startBluetooth(sessionId: String): ApiResult<SessionDto?> =
        apiCall { api.startBluetooth(sessionId).session }

    suspend fun stopBluetooth(sessionId: String): ApiResult<SessionDto?> =
        apiCall { api.stopBluetooth(sessionId).session }

    suspend fun setAttendancePaused(sessionId: String, paused: Boolean): ApiResult<SessionDto?> =
        apiCall { api.setAttendancePaused(sessionId, SetPausedReq(paused)).session }

    suspend fun deleteSession(sessionId: String): ApiResult<Unit> =
        apiCall { api.deleteSession(sessionId); Unit }

    suspend fun bluetoothBroadcast(sessionId: String): ApiResult<BluetoothBroadcastDto> =
        apiCall { api.bluetoothBroadcast(sessionId) }

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
