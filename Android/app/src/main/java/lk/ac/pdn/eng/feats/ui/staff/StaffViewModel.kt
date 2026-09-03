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
) {
    val isAdmin: Boolean get() = role == "admin"
    val bleEnabled: Boolean get() = settings?.bleEnabled != false

    /** In the session's scheduled window right now — regardless of `active`. See [stageOf]. */
    fun isRunning(sessionId: String?): Boolean = sessionId != null && running.containsKey(sessionId)

    /**
     * `active`, preferring [running] — refreshed every ~10s by pollRunning() — over the
     * session's own `active` field, which is only as fresh as the last full [sessions]
     * reload. Same freshness reasoning as [isBroadcastingOnServer]: another staff member's
     * dashboard (or the recurring-session window-close sweep) can flip this between two
     * full reloads, and a stale read here would show the wrong stage.
     */
    fun isActiveOnServer(session: StaffSessionDto): Boolean =
        running[session.id]?.active ?: (session.active == true)

    /** In-window AND active — the session is actually accepting attendance right now. */
    fun isCollecting(session: StaffSessionDto): Boolean = isRunning(session.id) && isActiveOnServer(session)

    /** The three-stage session-card model — see stageOf's callers for the full contract. */
    fun stageOf(session: StaffSessionDto): SessionStage = when {
        !isRunning(session.id) -> SessionStage.Inactive
        isActiveOnServer(session) -> SessionStage.Collecting
        else -> SessionStage.WithinSession
    }

    /**
     * Server-side "is this session broadcasting" truth, visible to every viewer (not just
     * the device actually transmitting). Prefers [running] — refreshed every ~10s by
     * pollRunning() — over the session's own `broadcasting` field, which is only as fresh
     * as the last full [sessions] reload, so another staff member's dashboard reflects a
     * broadcast starting/stopping within seconds rather than only after a manual refresh.
     */
    fun isBroadcastingOnServer(session: StaffSessionDto): Boolean =
        running[session.id]?.broadcasting ?: (session.broadcasting == true)
}

/**
 * The three session-card stages: [Inactive] (out of the scheduled window, regardless of
 * `active`), [WithinSession] (in window, nobody has tapped Collect yet), and [Collecting]
 * (in window and active — GPS is verifying every student regardless of Bluetooth, which is
 * exactly why a Bluetooth radio failure never changes this stage: it isn't tied to it).
 */
enum class SessionStage { Inactive, WithinSession, Collecting }

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
     * Load-time reconciliation for THIS device's own local radio only — never starts
     * broadcasting here. `BroadcastService.state` is in-memory and per-process, so
     * `current == null` means either "this device was never broadcasting" or "this
     * device's app process died," and there is no reliable way to tell those apart from
     * "a completely different device (e.g. an admin's phone, or a co-owning lecturer's)
     * is legitimately broadcasting right now." Treating the latter as "nobody's on it,
     * so I'll take over" would make a second device silently start advertising the same
     * session's BLE token the moment its owner opens the Sessions tab — exactly the bug
     * this used to have. The server's own stale-broadcast sweep is what closes a genuinely
     * abandoned broadcast; this method only ever stops a service actually running here.
     */
    private fun reconcileBroadcast(sessions: List<StaffSessionDto>) {
        val current = BroadcastService.state.value?.sessionId ?: return
        val stillOnServer = sessions.any { it.id == current && it.broadcasting == true }
        if (!stillOnServer) {
            // Someone else deactivated/stopped it, or the server swept it as stale —
            // this device's radio must not keep advertising a channel the server closed.
            BroadcastService.stop(getApplication())
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
                // Stops on 401 for the same reason the student poll does: this
                // ViewModel is resolved from the Activity's store and outlives
                // sign-out, so an un-stopped loop keeps polling forever afterwards,
                // and a stale poll's 401 can land after a fresh sign-in and force
                // that new session straight back out. See LectureEntryViewModel.
                if (!refreshRunningNow()) return@launch
                delay(10_000)
            }
        }
    }

    /**
     * Out-of-cycle running-set refresh, so a just-activated session doesn't wait for
     * the next poll tick. Returns false when the session is gone (401) and polling
     * should stop.
     */
    private suspend fun refreshRunningNow(): Boolean {
        when (val res = repo.runningSessions()) {
            is ApiResult.Success ->
                _state.value = _state.value.copy(
                    running = res.data.associateBy { it.sessionId ?: "" }.filterKeys { it.isNotEmpty() },
                )
            // Any other error keeps the last known running set, as before.
            is ApiResult.Error -> if (res.code == 401) return false
        }
        return true
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

    /**
     * Debounced lecturer lookup — used by the admin Courses-tab filter/Owners dialog AND by
     * a plain lecturer adding a co-owner to their own course (AddOwnerDialog), so this must
     * not be admin-gated.
     */
    fun searchLecturers(query: String) {
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

    /** Owner or admin — wholesale add/remove, same call for both roles. */
    fun assignLecturers(courseId: String, lecturerIds: List<String>) {
        viewModelScope.launch {
            when (val res = repo.assignLecturer(courseId, lecturerIds)) {
                is ApiResult.Success -> { setFlash("Owners updated."); refresh() }
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

    /**
     * "Collect" (Within-session → Collecting) and "Join" (already Collecting, this device
     * hasn't started broadcasting yet) are the same underlying action — activating an
     * already-active session is a harmless no-op server-side, so this single function
     * backs both buttons; only the displayed label differs based on current stage. Also
     * doubles as "start broadcast" — see [broadcastReady].
     */
    fun collect(sessionId: String) {
        viewModelScope.launch {
            when (val res = repo.activateSession(sessionId)) {
                is ApiResult.Success -> {
                    setFlash("Collecting attendance.")
                    // Optimistic: flips the stage to Collecting immediately instead of
                    // for one round trip still reading Within-session.
                    _state.value = _state.value.copy(
                        sessions = _state.value.sessions.map { if (it.id == sessionId) it.copy(active = true) else it },
                        running = _state.value.running.mapValues { (id, r) -> if (id == sessionId) r.copy(active = true) else r },
                    )
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

    /**
     * Deactivating also stops this phone's radio if it's the one broadcasting this session.
     * Ends Collecting, but does NOT necessarily leave the scheduled window — it lands on
     * Within-session if the window is still open, Inactive only once the window itself
     * closes. So the optimistic update below flips `active` to false on the existing
     * `running` entry rather than removing it; removing it would wrongly jump the stage
     * straight to Inactive even mid-window.
     *
     * The local radio stop and the server call don't land at the same instant — the server
     * round-trip takes a beat, and `refresh()` after it takes another. Without an optimistic
     * update, a card briefly shows `liveHere = false` (radio just stopped) while `liveOnServer`
     * is still the last-fetched `true`, which read as "ATTENDANCE IS LIVE · Broadcasting from
     * another device" for a moment — misleadingly, since nothing is broadcasting anywhere.
     * Clearing both local sources of truth synchronously, before the network calls, closes
     * that window entirely instead of just narrowing it.
     */
    fun deactivate(sessionId: String) {
        if (BroadcastService.state.value?.sessionId == sessionId) {
            BroadcastService.stop(getApplication())
        }
        _state.value = _state.value.copy(
            sessions = _state.value.sessions.map {
                if (it.id == sessionId) it.copy(active = false, broadcasting = false) else it
            },
            running = _state.value.running.mapValues { (id, r) ->
                if (id == sessionId) r.copy(active = false, broadcasting = false) else r
            },
        )
        viewModelScope.launch {
            when (val res = repo.deactivateSession(sessionId)) {
                is ApiResult.Success -> { setFlash("Session deactivated."); refresh() }
                // The optimistic clear above assumed success — resync with the server
                // now that it didn't, rather than leaving the UI showing a state that
                // never actually happened.
                is ApiResult.Error -> { setError(res.message); refresh() }
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

    // Broadcasting is stopped only via deactivate() now — see its doc comment. There is
    // no standalone "stop broadcast, keep session active" action, matching Activate
    // doubling as "start broadcast" with a single symmetric control.

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

    fun setWebAllowNonIos(allowed: Boolean) = patchSettings(
        SettingsReq(webAllowNonIos = allowed),
        if (allowed) {
            "Anyone can now use the web client."
        } else {
            "The web client is iPhone and iPad only again."
        },
    )

    fun setNearBufferLogic(strategyId: String) = patchSettings(
        SettingsReq(nearBufferLogic = strategyId),
        "Near-buffer logic updated.",
    )

    fun setFarBufferLogic(strategyId: String) = patchSettings(
        SettingsReq(farBufferLogic = strategyId),
        "Far-buffer logic updated.",
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

    /**
     * Applies a settings write, keeping the geofence-logic option list if the
     * response happens not to carry one. The server sends it on every settings
     * response, so this is belt-and-braces — but the settings endpoint is only
     * read once per dashboard (see [loadGlobalSettings], called from `init`), so
     * a response that dropped the list would blank both dropdowns until the
     * screen was recreated, with no way to notice from here.
     */
    private fun patchSettings(req: SettingsReq, success: String) {
        viewModelScope.launch {
            when (val res = repo.updateSettings(req)) {
                is ApiResult.Success -> {
                    val merged = res.data.copy(
                        geofenceLogicOptions = res.data.geofenceLogicOptions
                            ?: _state.value.settings?.geofenceLogicOptions,
                    )
                    _state.value = _state.value.copy(settings = merged)
                    setFlash(success)
                }
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
