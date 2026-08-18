package lk.ac.pdn.eng.feats.ui.staff

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
import lk.ac.pdn.eng.feats.ble.BroadcastService
import lk.ac.pdn.eng.feats.ble.BroadcastState
import lk.ac.pdn.eng.feats.data.net.ApiResult
import lk.ac.pdn.eng.feats.data.net.CourseDto
import lk.ac.pdn.eng.feats.data.net.CreateCourseReq
import lk.ac.pdn.eng.feats.data.net.CreateLecturerReq
import lk.ac.pdn.eng.feats.data.net.CreateSessionReq
import lk.ac.pdn.eng.feats.data.net.LecturerDto
import lk.ac.pdn.eng.feats.data.net.RunningSessionDto
import lk.ac.pdn.eng.feats.data.net.StaffSessionDto
import lk.ac.pdn.eng.feats.data.net.UpdateLecturerReq
import lk.ac.pdn.eng.feats.ui.container

data class StaffState(
    val role: String = "lecturer",
    val courses: List<CourseDto> = emptyList(),
    val sessions: List<StaffSessionDto> = emptyList(),
    val lecturers: List<LecturerDto> = emptyList(),
    val running: Map<String, RunningSessionDto> = emptyMap(),
    val loading: Boolean = false,
    val error: String? = null,
    val flash: String? = null,
    /** Mirrors [BroadcastService.state]: non-null while THIS phone is on the air. */
    val broadcast: BroadcastState? = null,
    /** Admin Courses tab: filter list + create-for lecturer. */
    val selectedLecturerFilter: LecturerDto? = null,
    val lecturerSearchResults: List<LecturerDto> = emptyList(),
    val lecturerSearchLoading: Boolean = false,
) {
    val isAdmin: Boolean get() = role == "admin"
    fun isRunning(sessionId: String?): Boolean = sessionId != null && running.containsKey(sessionId)

    /** Courses visible in the admin Courses tab (filtered by selected lecturer). */
    fun filteredCourses(): List<CourseDto> {
        val filterId = selectedLecturerFilter?.id ?: return courses
        return courses.filter { c -> c.lecturers?.any { it.id == filterId } == true }
    }
}

class StaffViewModel(app: Application) : AndroidViewModel(app) {

    private val repo get() = container.repository

    private val _state = MutableStateFlow(StaffState(role = container.prefs.cachedUser()?.role ?: "lecturer"))
    val state: StateFlow<StaffState> = _state.asStateFlow()
    private var lecturerSearchJob: Job? = null

    init {
        refresh()
        pollRunning()
        observeBroadcastService()
    }

    /** Mirror the foreground service's state and surface its self-stop reasons. */
    private fun observeBroadcastService() {
        viewModelScope.launch {
            BroadcastService.state.collect { b ->
                _state.value = _state.value.copy(broadcast = b)
            }
        }
        viewModelScope.launch {
            BroadcastService.stopReason.collect { reason ->
                if (reason != null) {
                    BroadcastService.consumeStopReason()
                    setError(reason)
                    refresh()
                }
            }
        }
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

            if (sessionsRes is ApiResult.Success) reconcileBroadcast(sessionsRes.data)
        }
    }

    /**
     * Load-time reconciliation: if the server says a session is broadcasting,
     * this phone either takes over the broadcast (silent preflight passed) or
     * turns it off on the server, so server state and the radio always agree.
     * With multiple flagged sessions (stale leftovers), the one inside its
     * schedule window wins and the rest are turned off.
     */
    private suspend fun reconcileBroadcast(sessions: List<StaffSessionDto>) {
        val serverOn = sessions.filter { it.broadcasting == true && it.id != null }
        if (serverOn.isEmpty()) return
        val current = BroadcastService.state.value?.sessionId

        val target = when {
            serverOn.any { it.id == current } -> serverOn.first { it.id == current }
            serverOn.size == 1 -> serverOn.first()
            else -> {
                val runningIds = when (val res = repo.runningSessions()) {
                    is ApiResult.Success -> res.data.mapNotNull { it.sessionId }.toSet()
                    is ApiResult.Error -> emptySet()
                }
                serverOn.firstOrNull { it.id in runningIds } ?: serverOn.first()
            }
        }

        // Stale leftovers: anything else still flagged on the server gets closed.
        serverOn.filter { it.id != target.id }.forEach { s ->
            s.id?.let { repo.setBroadcasting(it, false) }
        }

        if (target.id == current) return
        val app = getApplication<Application>()
        val blocker = BroadcastService.broadcastBlocker(app)
        if (blocker == null) {
            BroadcastService.start(app, target.id!!, sessionLabel(target))
        } else {
            repo.setBroadcasting(target.id!!, false)
            setError("Broadcast was turned off: $blocker")
            refreshSessionsOnly()
        }
    }

    private suspend fun refreshSessionsOnly() {
        when (val res = repo.allSessions()) {
            is ApiResult.Success -> _state.value = _state.value.copy(sessions = res.data)
            is ApiResult.Error -> Unit
        }
    }

    private fun sessionLabel(session: StaffSessionDto): String =
        listOfNotNull(
            session.course?.code,
            session.lectureDay,
            "${session.startTime}-${session.endTime}",
        ).joinToString(" ")

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

    fun setLecturerFilter(lecturer: LecturerDto?) {
        _state.value = _state.value.copy(
            selectedLecturerFilter = lecturer,
            lecturerSearchResults = emptyList(),
        )
    }

    /** Debounced lecturer lookup for the Courses filter and Owners dialog. */
    fun searchLecturers(query: String) {
        if (!_state.value.isAdmin) return
        lecturerSearchJob?.cancel()
        val q = query.trim()
        if (q.length < 2) {
            _state.value = _state.value.copy(lecturerSearchResults = emptyList(), lecturerSearchLoading = false)
            return
        }
        lecturerSearchJob = viewModelScope.launch {
            delay(300)
            _state.value = _state.value.copy(lecturerSearchLoading = true)
            when (val res = repo.lecturers(q)) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    lecturerSearchResults = res.data,
                    lecturerSearchLoading = false,
                )
                is ApiResult.Error -> _state.value = _state.value.copy(lecturerSearchLoading = false)
            }
        }
    }

    fun createCourse(code: String, batch: String, name: String) {
        if (code.isBlank() || name.isBlank() || batch.isBlank()) {
            setError("Course code, batch and name are required.")
            return
        }
        val lecturerIds = if (_state.value.isAdmin) {
            val id = _state.value.selectedLecturerFilter?.id
            if (id == null) {
                setError("Select a lecturer above to create a course for them.")
                return
            }
            listOf(id)
        } else {
            null
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
    fun deleteSession(sessionId: String) = mutate("Session deleted.") { repo.deleteSession(sessionId) }

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

    // ── BLE broadcast (one switch: server flag + this phone's radio) ─────────────────

    /** Surfaces a preflight failure message from the UI layer (permission/BT/support). */
    fun reportBroadcastBlocked(message: String) = setError(message)

    /**
     * Turn the broadcast ON. Caller (UI) has already run the visible preflight;
     * this re-checks silently, flips the server flag, then starts the foreground
     * service. If the radio later fails, the service rolls the server back.
     */
    fun startBroadcast(sessionId: String) {
        if (!_state.value.isRunning(sessionId)) {
            setError("Broadcast can only run while this session is in its scheduled time window.")
            return
        }
        val app = getApplication<Application>()
        BroadcastService.broadcastBlocker(app)?.let { setError(it); return }
        viewModelScope.launch {
            when (val res = repo.setBroadcasting(sessionId, true)) {
                is ApiResult.Success -> {
                    val label = _state.value.sessions.firstOrNull { it.id == sessionId }
                        ?.let(::sessionLabel)
                    BroadcastService.start(app, sessionId, label)
                    setFlash("Broadcast started.")
                    refreshSessionsOnly()
                }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    /** Turn the broadcast OFF: radio first, then the server flag. */
    fun stopBroadcast(sessionId: String) {
        BroadcastService.stop(getApplication())
        viewModelScope.launch {
            when (val res = repo.setBroadcasting(sessionId, false)) {
                is ApiResult.Success -> { setFlash("Broadcast stopped."); refreshSessionsOnly() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    private fun mutate(success: String, block: suspend () -> ApiResult<*>) {
        viewModelScope.launch {
            when (val res = block()) {
                is ApiResult.Success -> { setFlash(success); refresh() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }
}
