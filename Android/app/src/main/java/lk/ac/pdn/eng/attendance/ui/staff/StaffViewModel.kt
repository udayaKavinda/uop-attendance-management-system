package lk.ac.pdn.eng.attendance.ui.staff

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import lk.ac.pdn.eng.attendance.ble.BleAdvertiser
import lk.ac.pdn.eng.attendance.data.net.ApiResult
import lk.ac.pdn.eng.attendance.data.net.CourseDto
import lk.ac.pdn.eng.attendance.data.net.CreateCourseReq
import lk.ac.pdn.eng.attendance.data.net.CreateLecturerReq
import lk.ac.pdn.eng.attendance.data.net.CreateSessionReq
import lk.ac.pdn.eng.attendance.data.net.LecturerDto
import lk.ac.pdn.eng.attendance.data.net.RunningSessionDto
import lk.ac.pdn.eng.attendance.data.net.StaffSessionDto
import lk.ac.pdn.eng.attendance.data.net.UpdateLecturerReq
import lk.ac.pdn.eng.attendance.ui.container

data class BroadcastState(
    val sessionId: String,
    val deviceName: String? = null,
    val token: String? = null,
    val rotatesIn: Long? = null,
    val error: String? = null,
)

data class StaffState(
    val role: String = "lecturer",
    val courses: List<CourseDto> = emptyList(),
    val sessions: List<StaffSessionDto> = emptyList(),
    val lecturers: List<LecturerDto> = emptyList(),
    val running: Map<String, RunningSessionDto> = emptyMap(),
    val loading: Boolean = false,
    val error: String? = null,
    val flash: String? = null,
    val broadcast: BroadcastState? = null,
) {
    val isAdmin: Boolean get() = role == "admin"
    fun isRunning(sessionId: String?): Boolean = sessionId != null && running.containsKey(sessionId)
}

class StaffViewModel(app: Application) : AndroidViewModel(app) {

    private val repo get() = container.repository
    private val advertiser = BleAdvertiser(app)

    private val _state = MutableStateFlow(StaffState(role = container.prefs.cachedUser()?.role ?: "lecturer"))
    val state: StateFlow<StaffState> = _state.asStateFlow()

    private var broadcastJob: Job? = null

    init {
        refresh()
        pollRunning()
    }

    fun clearFlash() { _state.value = _state.value.copy(flash = null) }
    fun clearError() { _state.value = _state.value.copy(error = null) }

    private fun setFlash(msg: String) { _state.value = _state.value.copy(flash = msg) }
    private fun setError(msg: String) { _state.value = _state.value.copy(error = msg) }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            val coursesRes = repo.adminCourses()
            val sessionsRes = repo.allSessions()
            val lecturersRes = if (_state.value.isAdmin) repo.lecturers() else null

            var next = _state.value.copy(loading = false)
            when (coursesRes) {
                is ApiResult.Success -> next = next.copy(courses = coursesRes.data)
                is ApiResult.Error -> next = next.copy(error = coursesRes.message)
            }
            when (sessionsRes) {
                is ApiResult.Success -> next = next.copy(sessions = sessionsRes.data)
                is ApiResult.Error -> next = next.copy(error = sessionsRes.message)
            }
            if (lecturersRes is ApiResult.Success) next = next.copy(lecturers = lecturersRes.data)
            _state.value = next
        }
    }

    private fun pollRunning() {
        viewModelScope.launch {
            while (isActive) {
                when (val res = repo.runningSessions()) {
                    is ApiResult.Success ->
                        _state.value = _state.value.copy(
                            running = res.data.associateBy { it.sessionId ?: "" }.filterKeys { it.isNotEmpty() },
                        )
                    is ApiResult.Error -> Unit // keep last known running set
                }
                delay(10_000)
            }
        }
    }

    // ── Courses ────────────────────────────────────────────────────────────────────

    fun createCourse(code: String, batch: String, name: String, lecturerIds: List<String>?) {
        if (code.isBlank() || name.isBlank() || batch.isBlank()) {
            setError("Course code, batch and name are required.")
            return
        }
        viewModelScope.launch {
            when (val res = repo.createCourse(CreateCourseReq(name.trim(), code.trim(), batch.trim(), lecturerIds))) {
                is ApiResult.Success -> { setFlash("Course added."); refresh() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    fun deleteCourse(courseId: String) = mutate("Course deleted.") { repo.deleteCourse(courseId) }
    fun disableCourse(courseId: String) = mutate("Course disabled.") { repo.disableCourse(courseId) }
    fun enableCourse(courseId: String) = mutate("Course enabled.") { repo.enableCourse(courseId) }

    fun assignLecturers(courseId: String, lecturerIds: List<String>) {
        viewModelScope.launch {
            when (val res = repo.assignLecturer(courseId, lecturerIds)) {
                is ApiResult.Success -> { setFlash("Owners updated."); refresh() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    // ── Sessions ───────────────────────────────────────────────────────────────────

    fun createSession(courseId: String, day: String, start: String, end: String, recurring: Boolean) {
        if (courseId.isBlank()) { setError("Choose a course first."); return }
        viewModelScope.launch {
            val req = CreateSessionReq(day.uppercase(), start, end, recurring)
            when (val res = repo.createSession(courseId, req)) {
                is ApiResult.Success -> { setFlash("Session created."); refresh() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    fun activate(sessionId: String) = mutate("Session activated.") { repo.activateSession(sessionId) }
    fun deactivate(sessionId: String) = mutate("Session deactivated.") { repo.deactivateSession(sessionId) }
    fun startBluetooth(sessionId: String) = mutate("Bluetooth enabled.") { repo.startBluetooth(sessionId) }
    fun stopBluetooth(sessionId: String) = mutate("Bluetooth disabled.") { repo.stopBluetooth(sessionId) }
    fun deleteSession(sessionId: String) = mutate("Session deleted.") { repo.deleteSession(sessionId) }

    fun togglePaused(sessionId: String, paused: Boolean) {
        viewModelScope.launch {
            when (val res = repo.setAttendancePaused(sessionId, paused)) {
                is ApiResult.Success -> { setFlash(if (paused) "Attendance paused." else "Attendance resumed."); refresh() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    // ── Lecturers (admin) ────────────────────────────────────────────────────────────

    fun createLecturer(name: String, email: String, phone: String) {
        if (name.isBlank() || email.isBlank()) { setError("Name and email are required."); return }
        viewModelScope.launch {
            when (val res = repo.createLecturer(CreateLecturerReq(name.trim(), email.trim(), phone.trim()))) {
                is ApiResult.Success -> { setFlash("Lecturer added."); refresh() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    fun deleteLecturer(id: String) = mutate("Lecturer removed.") { repo.deleteLecturer(id) }

    // ── BLE broadcast ─────────────────────────────────────────────────────────────────

    /** Starts (or switches) the on-device broadcast for [sessionId]. Caller must hold advertise permission. */
    fun startBroadcast(sessionId: String) {
        if (!advertiser.isSupported()) {
            setError("This device cannot broadcast over BLE (no peripheral support).")
            return
        }
        broadcastJob?.cancel()
        advertiser.stop()
        _state.value = _state.value.copy(broadcast = BroadcastState(sessionId = sessionId))
        broadcastJob = viewModelScope.launch {
            while (isActive) {
                when (val res = repo.bluetoothBroadcast(sessionId)) {
                    is ApiResult.Success -> {
                        val token = res.data.token
                        if (token != null) {
                            advertiser.advertise(token) { err ->
                                _state.value = _state.value.copy(
                                    broadcast = _state.value.broadcast?.copy(error = err),
                                )
                            }
                        }
                        _state.value = _state.value.copy(
                            broadcast = BroadcastState(
                                sessionId = sessionId,
                                deviceName = res.data.deviceName,
                                token = token,
                                rotatesIn = res.data.rotatesIn,
                                error = if (token == null) "Bluetooth not enabled for this session." else null,
                            ),
                        )
                    }
                    is ApiResult.Error ->
                        _state.value = _state.value.copy(
                            broadcast = _state.value.broadcast?.copy(error = res.message),
                        )
                }
                // Re-fetch ahead of the 15s rotation so the advertised token stays valid.
                delay(5_000)
            }
        }
    }

    fun stopBroadcast() {
        broadcastJob?.cancel()
        broadcastJob = null
        advertiser.stop()
        _state.value = _state.value.copy(broadcast = null)
    }

    private fun mutate(success: String, block: suspend () -> ApiResult<*>) {
        viewModelScope.launch {
            when (val res = block()) {
                is ApiResult.Success -> { setFlash(success); refresh() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        broadcastJob?.cancel()
        advertiser.stop()
    }
}
