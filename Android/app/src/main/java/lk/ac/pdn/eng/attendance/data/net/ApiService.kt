package lk.ac.pdn.eng.attendance.data.net

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Retrofit declaration of every server endpoint the app uses. Paths match
 * the server's `routes` folder exactly. The origin (scheme/host/port) is rewritten at
 * request time by BaseUrlInterceptor, so only the path matters here.
 */
interface ApiService {

    // ── Auth ────────────────────────────────────────────────────────────────────
    @POST("api/auth/exchange-code")
    suspend fun exchangeCode(@Body body: ExchangeCodeReq): SimpleSuccess

    @GET("api/me")
    suspend fun me(): MeDto

    @POST("api/logout")
    suspend fun logout(): SimpleSuccess

    // ── Courses (any authenticated user) ──────────────────────────────────────────
    @GET("api/courses")
    suspend fun courses(): CoursesRes

    @GET("api/courses/running")
    suspend fun runningCourses(): CoursesRes

    // ── Student attendance ──────────────────────────────────────────────────────────
    @GET("api/attendance-status")
    suspend fun attendanceStatus(@Query("courseId") courseId: String): AttendanceStatusDto

    @GET("api/bluetooth-target")
    suspend fun bluetoothTarget(@Query("courseId") courseId: String): BluetoothTargetDto

    @POST("api/bluetooth-attendance")
    suspend fun recordBluetoothAttendance(@Body body: BluetoothAttendanceReq): BluetoothAttendanceRes

    // ── Admin / staff: courses ───────────────────────────────────────────────────────
    @GET("api/admin/courses")
    suspend fun adminCourses(): CoursesRes

    @POST("api/admin/courses")
    suspend fun createCourse(@Body body: CreateCourseReq): CourseRes

    @PATCH("api/admin/courses/{courseId}/assign-lecturer")
    suspend fun assignLecturer(
        @Path("courseId") courseId: String,
        @Body body: AssignLecturerReq,
    ): CourseRes

    @DELETE("api/admin/courses/{courseId}")
    suspend fun deleteCourse(@Path("courseId") courseId: String): SimpleSuccess

    @PATCH("api/admin/courses/{courseId}/disable")
    suspend fun disableCourse(@Path("courseId") courseId: String): CourseRes

    @PATCH("api/admin/courses/{courseId}/enable")
    suspend fun enableCourse(@Path("courseId") courseId: String): CourseRes

    @GET("api/admin/courses/{courseId}/sessions")
    suspend fun courseSessions(@Path("courseId") courseId: String): SessionsRes

    @POST("api/admin/courses/{courseId}/sessions")
    suspend fun createSession(
        @Path("courseId") courseId: String,
        @Body body: CreateSessionReq,
    ): SessionRes

    @GET("api/admin/courses/{courseId}/attendance-matrix")
    suspend fun attendanceMatrix(@Path("courseId") courseId: String): AttendanceMatrixRes

    // ── Admin / staff: sessions ──────────────────────────────────────────────────────
    @GET("api/admin/sessions")
    suspend fun allSessions(): StaffSessionsRes

    @GET("api/admin/sessions/running")
    suspend fun runningSessions(): RunningSessionsRes

    @DELETE("api/admin/sessions/{sessionId}")
    suspend fun deleteSession(@Path("sessionId") sessionId: String): SimpleSuccess

    @PATCH("api/admin/sessions/{sessionId}/activate")
    suspend fun activateSession(@Path("sessionId") sessionId: String): SessionRes

    @PATCH("api/admin/sessions/{sessionId}/deactivate")
    suspend fun deactivateSession(@Path("sessionId") sessionId: String): SessionRes

    @PATCH("api/admin/sessions/{sessionId}/bluetooth/start")
    suspend fun startBluetooth(@Path("sessionId") sessionId: String): SessionRes

    @PATCH("api/admin/sessions/{sessionId}/bluetooth/stop")
    suspend fun stopBluetooth(@Path("sessionId") sessionId: String): SessionRes

    @GET("api/admin/sessions/{sessionId}/bluetooth-broadcast")
    suspend fun bluetoothBroadcast(@Path("sessionId") sessionId: String): BluetoothBroadcastDto

    @PATCH("api/admin/sessions/{sessionId}/attendance-paused")
    suspend fun setAttendancePaused(
        @Path("sessionId") sessionId: String,
        @Body body: SetPausedReq,
    ): SessionRes

    @GET("api/admin/sessions/{sessionId}/attendance")
    suspend fun sessionAttendance(@Path("sessionId") sessionId: String): SessionAttendanceRes

    // ── Admin: lecturers ─────────────────────────────────────────────────────────────
    @GET("api/admin/lecturers")
    suspend fun lecturers(@Query("q") q: String? = null): LecturersRes

    @POST("api/admin/lecturers")
    suspend fun createLecturer(@Body body: CreateLecturerReq): LecturerRes

    @PATCH("api/admin/lecturers/{id}")
    suspend fun updateLecturer(
        @Path("id") id: String,
        @Body body: UpdateLecturerReq,
    ): LecturerRes

    @DELETE("api/admin/lecturers/{id}")
    suspend fun deleteLecturer(@Path("id") id: String): SimpleSuccess
}
