package lk.ac.pdn.eng.feats.ui.staff

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
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
import lk.ac.pdn.eng.feats.data.net.GeofenceDto
import lk.ac.pdn.eng.feats.data.net.GeofenceUpdateReq
import lk.ac.pdn.eng.feats.data.net.LecturerDto
import lk.ac.pdn.eng.feats.data.net.ManualCodeConfigReq
import lk.ac.pdn.eng.feats.data.net.ManualCodeStatusDto
import lk.ac.pdn.eng.feats.data.net.PendingReviewDto
import lk.ac.pdn.eng.feats.data.net.RunningSessionDto
import lk.ac.pdn.eng.feats.data.net.SettingsDto
import lk.ac.pdn.eng.feats.data.net.SettingsReq
import lk.ac.pdn.eng.feats.data.net.StaffSessionDto
import lk.ac.pdn.eng.feats.ui.container

data class StaffState(
    val role: String = "lecturer",
    val courses: List<CourseDto> = emptyList(),
    val coursesPage: Int = 1,
    val coursesHasMore: Boolean = false,
    val coursesLoadingMore: Boolean = false,
    val sessions: List<StaffSessionDto> = emptyList(),
    val sessionsPage: Int = 1,
    val sessionsHasMore: Boolean = false,
    val sessionsLoadingMore: Boolean = false,
    val lecturers: List<LecturerDto> = emptyList(),
    val lecturersPage: Int = 1,
    val lecturersHasMore: Boolean = false,
    val lecturersLoadingMore: Boolean = false,
    val running: Map<String, RunningSessionDto> = emptyMap(),
    val loading: Boolean = false,
    val error: String? = null,
    val flash: String? = null,
    /** Mirrors [BroadcastService.state]: non-null while THIS phone is on the air. */
    val broadcast: BroadcastState? = null,
    /** Admin Courses tab: filter list + create-for lecturer. Server-side scoped (not a client filter),
     *  so it stays correct regardless of how many course pages are loaded. */
    val selectedLecturerFilter: LecturerDto? = null,
    val lecturerSearchResults: List<LecturerDto> = emptyList(),
    val lecturerSearchLoading: Boolean = false,
    /** Per-session lecturer-code status, fetched on demand when a card is expanded. */
    val manualCodes: Map<String, ManualCodeStatusDto> = emptyMap(),
    /** Global policy (BLE kill switch, distance buffers, seeding); null until loaded. */
    val settings: SettingsDto? = null,
    /** Building list for the session builder + the admin map tool. */
    val geofences: List<GeofenceDto> = emptyList(),
    /** Per-session queue of code submissions awaiting a decision. */
    val pendingReviews: Map<String, List<PendingReviewDto>> = emptyMap(),
) {
    val isAdmin: Boolean get() = role == "admin"
    val bleEnabled: Boolean get() = settings?.bleEnabled != false
    fun isRunning(sessionId: String?): Boolean = sessionId != null && running.containsKey(sessionId)
    fun reviewsFor(sessionId: String?): List<PendingReviewDto> =
        sessionId?.let { pendingReviews[it] } ?: emptyList()
}

class StaffViewModel(app: Application) : AndroidViewModel(app) {

    private val repo get() = container.repository

    private val _state = MutableStateFlow(StaffState(role = container.prefs.cachedUser()?.role ?: "lecturer"))
    val state: StateFlow<StaffState> = _state.asStateFlow()
    private var lecturerSearchJob: Job? = null

    /**
     * Emits once a just-activated session is confirmed running (and BLE is on) —
     * the UI layer collects this to run the broadcast permission preflight, since
     * that needs an Activity to host permission launchers. This is what makes
     * "Activate" double as "start broadcast" without a separate button.
     */
    private val _broadcastReady = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val broadcastReady: SharedFlow<String> = _broadcastReady.asSharedFlow()

    init {
        refresh()
        pollRunning()
        observeBroadcastService()
        // Both are staff-readable, not admin-only: every lecturer needs the BLE
        // switch to know whether broadcasting is even offered, and the building
        // list to create a session at all.
        loadGlobalSettings()
        loadGeofences()
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

    /** Reloads page 1 of every list — used at startup and after any mutation. */
    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            val lecturerFilterId = _state.value.selectedLecturerFilter?.id
            val coursesRes = repo.adminCourses(1, lecturerFilterId)
            val sessionsRes = repo.allSessions(1)
            val lecturersRes = if (_state.value.isAdmin) repo.lecturersPage(1) else null

            var next = _state.value.copy(loading = false)
            when (coursesRes) {
                is ApiResult.Success -> next = next.copy(
                    courses = coursesRes.data.items,
                    coursesPage = 1,
                    coursesHasMore = coursesRes.data.hasMore,
                )
                is ApiResult.Error -> next = next.copy(error = coursesRes.message)
            }
            when (sessionsRes) {
                is ApiResult.Success -> next = next.copy(
                    sessions = sessionsRes.data.items,
                    sessionsPage = 1,
                    sessionsHasMore = sessionsRes.data.hasMore,
                )
                is ApiResult.Error -> next = next.copy(error = sessionsRes.message)
            }
            if (lecturersRes is ApiResult.Success) next = next.copy(
                lecturers = lecturersRes.data.items,
                lecturersPage = 1,
                lecturersHasMore = lecturersRes.data.hasMore,
            )
            _state.value = next

            if (sessionsRes is ApiResult.Success) reconcileBroadcast(sessionsRes.data.items)
        }
    }

    fun loadMoreCourses() {
        val s = _state.value
        if (!s.coursesHasMore || s.coursesLoadingMore) return
        viewModelScope.launch {
            _state.value = _state.value.copy(coursesLoadingMore = true)
            val nextPage = s.coursesPage + 1
            when (val res = repo.adminCourses(nextPage, s.selectedLecturerFilter?.id)) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    courses = _state.value.courses + res.data.items,
                    coursesPage = nextPage,
                    coursesHasMore = res.data.hasMore,
                    coursesLoadingMore = false,
                )
                is ApiResult.Error -> _state.value = _state.value.copy(coursesLoadingMore = false, error = res.message)
            }
        }
    }

    fun loadMoreSessions() {
        val s = _state.value
        if (!s.sessionsHasMore || s.sessionsLoadingMore) return
        viewModelScope.launch {
            _state.value = _state.value.copy(sessionsLoadingMore = true)
            val nextPage = s.sessionsPage + 1
            when (val res = repo.allSessions(nextPage)) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    sessions = _state.value.sessions + res.data.items,
                    sessionsPage = nextPage,
                    sessionsHasMore = res.data.hasMore,
                    sessionsLoadingMore = false,
                )
                is ApiResult.Error -> _state.value = _state.value.copy(sessionsLoadingMore = false, error = res.message)
            }
        }
    }

    fun loadMoreLecturers() {
        val s = _state.value
        if (!s.lecturersHasMore || s.lecturersLoadingMore) return
        viewModelScope.launch {
            _state.value = _state.value.copy(lecturersLoadingMore = true)
            val nextPage = s.lecturersPage + 1
            when (val res = repo.lecturersPage(nextPage)) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    lecturers = _state.value.lecturers + res.data.items,
                    lecturersPage = nextPage,
                    lecturersHasMore = res.data.hasMore,
                    lecturersLoadingMore = false,
                )
                is ApiResult.Error -> _state.value = _state.value.copy(lecturersLoadingMore = false, error = res.message)
            }
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
        when (val res = repo.allSessions(1)) {
            is ApiResult.Success -> _state.value = _state.value.copy(
                sessions = res.data.items,
                sessionsPage = 1,
                sessionsHasMore = res.data.hasMore,
            )
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
                refreshRunningNow()
                delay(10_000)
            }
        }
    }

    /** Out-of-cycle running-set refresh, so a just-activated session doesn't wait for the next poll tick. */
    private suspend fun refreshRunningNow() {
        when (val res = repo.runningSessions()) {
            is ApiResult.Success ->
                _state.value = _state.value.copy(
                    running = res.data.associateBy { it.sessionId ?: "" }.filterKeys { it.isNotEmpty() },
                )
            is ApiResult.Error -> Unit // keep last known running set
        }
    }

    // ── Courses ────────────────────────────────────────────────────────────────────

    /** Re-fetches courses scoped to this lecturer server-side, so the filter stays correct however many pages exist. */
    fun setLecturerFilter(lecturer: LecturerDto?) {
        _state.value = _state.value.copy(
            selectedLecturerFilter = lecturer,
            lecturerSearchResults = emptyList(),
        )
        viewModelScope.launch {
            when (val res = repo.adminCourses(1, lecturer?.id)) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    courses = res.data.items,
                    coursesPage = 1,
                    coursesHasMore = res.data.hasMore,
                )
                is ApiResult.Error -> setError(res.message)
            }
        }
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

    fun createCourse(code: String, batches: List<String>, name: String) {
        if (code.isBlank() || name.isBlank() || batches.isEmpty()) {
            setError("Course code, at least one batch, and name are required.")
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
            when (val res = repo.createCourse(CreateCourseReq(name.trim(), code.trim(), batches, lecturerIds))) {
                is ApiResult.Success -> { setFlash("Course added."); refresh() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    fun disableCourse(courseId: String) = mutate("Course archived.") { repo.disableCourse(courseId) }
    fun enableCourse(courseId: String) = mutate("Course unarchived.") { repo.enableCourse(courseId) }

    fun assignLecturers(courseId: String, lecturerIds: List<String>) {
        viewModelScope.launch {
            when (val res = repo.assignLecturer(courseId, lecturerIds)) {
                is ApiResult.Success -> { setFlash("Owners updated."); refresh() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    /** Additive-only: a course owner adds ONE more co-owner (cannot remove one this way). */
    fun addLecturer(courseId: String, lecturerId: String) {
        viewModelScope.launch {
            when (val res = repo.addLecturer(courseId, lecturerId)) {
                is ApiResult.Success -> { setFlash("Owner added."); refresh() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    // ── Sessions ───────────────────────────────────────────────────────────────────

    fun createSession(
        courseId: String,
        day: String,
        start: String,
        end: String,
        recurring: Boolean,
        buildings: List<String> = emptyList(),
        manualCodeRotationMode: String = "none",
        manualCodeRotationSeconds: Int = 60,
    ) {
        if (courseId.isBlank()) { setError("Choose a course first."); return }
        // Mandatory: GPS runs for every session, so without a polygon nobody could
        // ever land in a passing band.
        if (buildings.isEmpty()) {
            setError("Select at least one building for this session.")
            return
        }
        viewModelScope.launch {
            val req = CreateSessionReq(
                lectureDay = day.uppercase(),
                startTime = start,
                endTime = end,
                recurring = recurring,
                buildings = buildings,
                manualCodeRotationMode = manualCodeRotationMode,
                manualCodeRotationSeconds = manualCodeRotationSeconds,
            )
            when (val res = repo.createSession(courseId, req)) {
                is ApiResult.Success -> {
                    setFlash("Session created.")
                    refresh()
                }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    /** Activating also doubles as "start broadcast" — see [broadcastReady]. */
    fun activate(sessionId: String) {
        viewModelScope.launch {
            when (val res = repo.activateSession(sessionId)) {
                is ApiResult.Success -> {
                    setFlash("Session activated.")
                    refresh()
                    refreshRunningNow()
                    if (_state.value.isRunning(sessionId) && _state.value.bleEnabled) {
                        _broadcastReady.emit(sessionId)
                    }
                }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    /** Deactivating also stops this phone's radio if it's the one broadcasting this session. */
    fun deactivate(sessionId: String) {
        viewModelScope.launch {
            if (BroadcastService.state.value?.sessionId == sessionId) {
                BroadcastService.stop(getApplication())
            }
            when (val res = repo.deactivateSession(sessionId)) {
                is ApiResult.Success -> { setFlash("Session deactivated."); refresh() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

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
        if (!_state.value.bleEnabled) {
            setError("Bluetooth is switched off by the administrator. GPS still verifies this session.")
            return
        }
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

    // ── Manual attendance code (fallback, staff-controlled) ───────────────────────────

    /** Loads current status for one session's manual code, e.g. when its card is expanded. */
    fun loadManualCode(sessionId: String) {
        viewModelScope.launch {
            when (val res = repo.manualCodeStatus(sessionId)) {
                is ApiResult.Success -> putManualCode(sessionId, res.data)
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    fun pauseManualCode(sessionId: String) = patchManualCode(sessionId, ManualCodeConfigReq(paused = true))
    fun resumeManualCode(sessionId: String) = patchManualCode(sessionId, ManualCodeConfigReq(paused = false))
    fun regenerateManualCode(sessionId: String) = patchManualCode(sessionId, ManualCodeConfigReq(regenerate = true))

    private fun patchManualCode(sessionId: String, body: ManualCodeConfigReq) {
        viewModelScope.launch {
            when (val res = repo.setManualCode(sessionId, body)) {
                is ApiResult.Success -> putManualCode(sessionId, res.data)
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    private fun putManualCode(sessionId: String, status: ManualCodeStatusDto) {
        _state.value = _state.value.copy(manualCodes = _state.value.manualCodes + (sessionId to status))
    }

    fun setCodeRotation(sessionId: String, rotates: Boolean, seconds: Int) = patchManualCode(
        sessionId,
        ManualCodeConfigReq(
            rotationMode = if (rotates) "interval" else "none",
            rotationSeconds = seconds,
        ),
    )

    // ── Review queue (code submissions from outside the trusted bands) ────────────────

    fun loadPendingReviews(sessionId: String) {
        viewModelScope.launch {
            when (val res = repo.pendingReviews(sessionId)) {
                is ApiResult.Success ->
                    _state.value = _state.value.copy(
                        pendingReviews = _state.value.pendingReviews + (sessionId to res.data),
                    )
                is ApiResult.Error -> Unit // a stale queue is better than an error banner here
            }
        }
    }

    fun reviewSubmission(sessionId: String, attendanceId: String, approve: Boolean) {
        viewModelScope.launch {
            when (val res = repo.reviewSubmission(sessionId, attendanceId, approve)) {
                is ApiResult.Success -> {
                    setFlash(if (approve) "Marked present." else "Submission rejected.")
                    loadPendingReviews(sessionId)
                }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    // ── Settings (admin: mode policy, seeding, buffers, manual-code kill-switch) ───────

    private fun loadGlobalSettings() {
        viewModelScope.launch {
            when (val res = repo.settings()) {
                is ApiResult.Success -> _state.value = _state.value.copy(settings = res.data)
                is ApiResult.Error -> Unit
            }
        }
    }

    fun setBleEnabled(enabled: Boolean) = patchSettings(
        SettingsReq(bleEnabled = enabled),
        if (enabled) "Bluetooth turned on for every session." else "Bluetooth switched off. GPS still verifies attendance.",
    )

    fun setSuspiciousBandAutoPass(autoPass: Boolean) = patchSettings(
        SettingsReq(suspiciousBandAutoPass = autoPass),
        if (autoPass) "A correct code now passes students in the outer band." else "The outer band now goes to lecturer review.",
    )

    fun setSeedingParams(seedRate: Int, seedWindowMs: Long) =
        patchSettings(SettingsReq(seedRate = seedRate, seedWindowMs = seedWindowMs), "Seeding settings updated.")

    fun setStudentEmailDomain(domain: String) = patchSettings(
        SettingsReq(studentEmailDomain = domain),
        if (domain.isBlank()) "Student email domain check disabled." else "Student email domain updated.",
    )

    fun setMinSupportedVersionCode(versionCode: Int) = patchSettings(
        SettingsReq(minSupportedVersionCode = versionCode),
        if (versionCode <= 0) "Mandatory update check disabled." else "Minimum app version updated.",
    )

    fun setDistanceBuffers(nearBufferM: Int, farBufferM: Int) {
        if (farBufferM < nearBufferM) {
            setError("The outer distance must be at least as large as the pass distance.")
            return
        }
        patchSettings(
            SettingsReq(nearBufferM = nearBufferM, farBufferM = farBufferM),
            "Distance thresholds updated.",
        )
    }

    private fun patchSettings(req: SettingsReq, success: String) {
        viewModelScope.launch {
            when (val res = repo.updateSettings(req)) {
                is ApiResult.Success -> { _state.value = _state.value.copy(settings = res.data); setFlash(success) }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    // ── Geofences (admin building polygons) ─────────────────────────────────────────────

    private fun loadGeofences() {
        viewModelScope.launch {
            when (val res = repo.geofences()) {
                is ApiResult.Success -> _state.value = _state.value.copy(geofences = res.data)
                is ApiResult.Error -> setError("Could not load buildings: ${res.message}")
            }
        }
    }

    /** `polygon` is ordered [lng, lat] vertices — see [lk.ac.pdn.eng.feats.data.net.GeofenceDto]. */
    fun createGeofence(name: String, polygon: List<List<Double>>) {
        if (name.isBlank() || polygon.size < 3) {
            setError("Name a building and draw at least 3 points.")
            return
        }
        viewModelScope.launch {
            when (val res = repo.createGeofence(name.trim(), polygon)) {
                is ApiResult.Success -> { setFlash("Building saved."); loadGeofences() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    fun deleteGeofence(id: String) {
        viewModelScope.launch {
            when (val res = repo.deleteGeofence(id)) {
                is ApiResult.Success -> { setFlash("Building removed."); loadGeofences() }
                is ApiResult.Error -> setError(res.message)
            }
        }
    }

    fun renameGeofence(id: String, name: String) {
        viewModelScope.launch {
            when (val res = repo.updateGeofence(id, GeofenceUpdateReq(name = name))) {
                is ApiResult.Success -> { setFlash("Building renamed."); loadGeofences() }
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
