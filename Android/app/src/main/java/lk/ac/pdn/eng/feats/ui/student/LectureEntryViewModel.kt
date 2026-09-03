package lk.ac.pdn.eng.feats.ui.student

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import lk.ac.pdn.eng.feats.ble.BleAdvertiser
import lk.ac.pdn.eng.feats.ble.BlePermissions
import lk.ac.pdn.eng.feats.ble.BleScanner
import lk.ac.pdn.eng.feats.ble.BleUnavailableException
import lk.ac.pdn.eng.feats.data.net.ApiResult
import lk.ac.pdn.eng.feats.data.net.GpsFixDto
import lk.ac.pdn.eng.feats.data.net.RunningCourseDto
import lk.ac.pdn.eng.feats.data.net.SeedingDto
import lk.ac.pdn.eng.feats.location.GpsLocationSource
import lk.ac.pdn.eng.feats.location.MockLocationException
import lk.ac.pdn.eng.feats.location.LocationPermissions
import lk.ac.pdn.eng.feats.ui.container

/** Where the student is in the single check-in attempt. */
enum class CheckInPhase { Idle, Preparing, Checking, Seeding }

/** The server's verdict, as far as the student is allowed to know it. */
enum class Outcome { None, Present, Flagged }

data class CheckInState(
    val courses: List<RunningCourseDto> = emptyList(),
    val selectedCourseId: String? = null,
    val phase: CheckInPhase = CheckInPhase.Idle,
    val outcome: Outcome = Outcome.None,
    /** Countdown shown during the window, purely cosmetic. */
    val secondsLeft: Int = 0,
    /** True once the window elapsed without a pass: offer Try again / Get help. */
    val needsHelp: Boolean = false,
    val helpDialogOpen: Boolean = false,
    val helpSubmitting: Boolean = false,
    val helpError: String? = null,
    val error: String? = null,
    val checkingStatus: Boolean = false,
    /** Courses this student registered ahead of time — see CourseRegistrationScreen. */
    val registeredIds: Set<String> = emptySet(),
) {
    val busy: Boolean get() = phase != CheckInPhase.Idle || checkingStatus
    val running: Boolean get() = phase == CheckInPhase.Preparing || phase == CheckInPhase.Checking
    val selectedCourse: RunningCourseDto? get() = courses.firstOrNull { it.id == selectedCourseId }
    val settled: Boolean get() = outcome != Outcome.None
}

/**
 * One attempt = one 90-second window in which Bluetooth and GPS run together and
 * either one can win. The client never learns *why* it failed — the server
 * answers "collecting" for both "still gathering fixes" and "gathered enough but
 * you are too far away" — so all this can conclude when the window ends is
 * "not verified", and offer the lecturer's code as the way out.
 */
class LectureEntryViewModel(app: Application) : AndroidViewModel(app) {

    private val repo get() = container.repository
    private val scanner = BleScanner(app)
    private val gpsSource = GpsLocationSource(app)
    private val seedAdvertiser = BleAdvertiser(app)

    private val _state = MutableStateFlow(CheckInState())
    val state: StateFlow<CheckInState> = _state.asStateFlow()

    /**
     * Latches true the moment the platform reports a mocked fix. The screen
     * observes this and closes the app; it is one-way on purpose, so nothing that
     * happens afterwards can clear it before the shutdown lands.
     */
    private val _mockLocationDetected = MutableStateFlow(false)
    val mockLocationDetected: StateFlow<Boolean> = _mockLocationDetected.asStateFlow()

    private var windowJob: Job? = null
    private var seedingJob: Job? = null

    init {
        pollRunningCourses()
        refreshRegistered()
    }

    // ── Course registration ──────────────────────────────────────────────────────
    // Registration is edited on a separate screen (CourseRegistrationScreen), so
    // this only needs to (re)fetch the set — once on init, and again whenever the
    // student returns from that screen.

    fun refreshRegistered() {
        viewModelScope.launch {
            when (val res = repo.registeredCourses()) {
                is ApiResult.Success -> _state.update { it.copy(registeredIds = res.data.toSet()) }
                is ApiResult.Error -> Unit
            }
        }
    }

    // ── Course list ──────────────────────────────────────────────────────────────

    private fun pollRunningCourses() {
        viewModelScope.launch {
            while (isActive) {
                when (val res = repo.runningCourses()) {
                    is ApiResult.Success -> _state.update { s ->
                        val items = res.data
                        val stillRunning = s.selectedCourseId == null || items.any { it.id == s.selectedCourseId }
                        s.copy(
                            courses = items,
                            error = null,
                            selectedCourseId = if (stillRunning) s.selectedCourseId else null,
                            outcome = if (stillRunning) s.outcome else Outcome.None,
                            needsHelp = if (stillRunning) s.needsHelp else false,
                        )
                    }
                    is ApiResult.Error -> {
                        // 401 means the session is gone, and this ViewModel outlives
                        // sign-out: it is resolved from the Activity's ViewModelStore,
                        // which is only cleared when the Activity is destroyed, not
                        // when the screen leaves composition. Left running, this loop
                        // polled every 10s indefinitely after logout (confirmed in the
                        // server access log), and every one of those 401s fires
                        // SessionEvents.notifyUnauthorized() -> forceLoggedOut(). That
                        // is not just wasted battery: a stale poll dispatched before a
                        // fresh sign-in can land *after* it and wipe the new session,
                        // bouncing the user straight back to the login screen. Stop.
                        if (res.code == 401) return@launch
                        _state.update { it.copy(error = res.message) }
                    }
                }
                delay(10_000)
            }
        }
    }

    fun selectCourse(courseId: String?) {
        cancelAttempt()
        _state.update {
            it.copy(
                selectedCourseId = courseId,
                outcome = Outcome.None,
                needsHelp = false,
                error = null,
                helpError = null,
            )
        }
        if (courseId != null) refreshStatus(courseId)
    }

    /** Picks up a record made earlier — including one still awaiting the lecturer. */
    private fun refreshStatus(courseId: String) {
        viewModelScope.launch {
            _state.update { it.copy(checkingStatus = true) }
            when (val res = repo.attendanceStatus(courseId)) {
                is ApiResult.Success -> _state.update {
                    it.copy(outcome = outcomeOf(res.data.status), checkingStatus = false)
                }
                is ApiResult.Error -> _state.update {
                    it.copy(error = res.message, checkingStatus = false)
                }
            }
        }
    }

    // ── The 90-second window ─────────────────────────────────────────────────────

    fun startCheckIn() {
        val courseId = _state.value.selectedCourseId
        if (courseId == null) {
            _state.update { it.copy(error = "Select your course first.") }
            return
        }
        if (_state.value.running) return
        windowJob?.cancel()
        windowJob = viewModelScope.launch { runWindow(courseId) }
    }

    /**
     * "Try again" is simply another full window — but the caller must still run
     * the screen's `begin()` gate first (permission + Bluetooth-off prompt) rather
     * than calling [startCheckIn] here directly, so a student who never reacted to
     * (or dismissed) the enable-Bluetooth prompt on the first attempt gets asked
     * again on every retry instead of silently running GPS-only forever.
     */
    fun tryAgain() {
        _state.update { it.copy(needsHelp = false, error = null) }
    }

    private suspend fun runWindow(courseId: String) = coroutineScope {
        val app = getApplication<Application>()
        _state.update {
            it.copy(phase = CheckInPhase.Preparing, error = null, needsHelp = false, secondsLeft = WINDOW_SECONDS)
        }

        // Only scan when the radio is usable AND a lecturer is actually broadcasting;
        // otherwise the whole window goes to GPS instead of splitting attention.
        val bleUsable = BlePermissions.scanBlocker(app) == null && bluetoothWorthScanning(courseId)
        val gpsUsable = LocationPermissions.hasFineLocation(app)

        if (!bleUsable && !gpsUsable) {
            _state.update {
                it.copy(
                    phase = CheckInPhase.Idle,
                    needsHelp = true,
                    secondsLeft = 0,
                    error = "We could not use Bluetooth or your location. Ask your lecturer for the code.",
                )
            }
            return@coroutineScope
        }

        val canAdvertise = canParticipateInSeeding()
        _state.update { it.copy(phase = CheckInPhase.Checking) }

        val ticker = launch {
            for (remaining in WINDOW_SECONDS - 1 downTo 0) {
                delay(1_000)
                _state.update { it.copy(secondsLeft = remaining) }
            }
        }

        withTimeoutOrNull(WINDOW_SECONDS * 1_000L) {
            val paths = buildList {
                if (bleUsable) add(launch { bluetoothPath(courseId, canAdvertise) })
                if (gpsUsable) add(launch { gpsPath(courseId, canAdvertise) })
            }
            // Whichever path succeeds first ends the window for both.
            while (!_state.value.settled && paths.any { it.isActive }) delay(100)
            paths.forEach { it.cancel() }
        }
        ticker.cancel()

        if (!_state.value.settled) {
            _state.update { it.copy(phase = CheckInPhase.Idle, needsHelp = true, secondsLeft = 0) }
        }
    }

    private suspend fun bluetoothWorthScanning(courseId: String): Boolean =
        when (val res = repo.bluetoothAvailable(courseId)) {
            is ApiResult.Success -> res.data
            is ApiResult.Error -> false
        }

    /**
     * Scans and submits for the whole window rather than taking a single token,
     * because a rejected token is routine and is NOT a reason to abandon Bluetooth
     * for the rest of the attempt:
     *
     *  - the scan filter matches the fixed UOP beacon prefix, not this session, so
     *    in a building running two lectures at once the first token heard is very
     *    often the other room's and is rejected outright;
     *  - a phone that joined an already-running broadcast briefly advertises the
     *    previous token after a rotation (see GRACE_MS in bluetoothCode.service.js).
     *
     * This used to take `.first()` and submit exactly once, so either case silently
     * downgraded the student to GPS-only for the remaining ~90 seconds.
     *
     * `attempted` collapses the scanner's repeated emissions of the same beacon
     * (several per second) down to one submission per distinct token.
     */
    private suspend fun bluetoothPath(courseId: String, canAdvertise: Boolean) {
        val attempted = mutableSetOf<String>()
        try {
            scanner.tokenFlow()
                .takeWhile { !_state.value.settled }
                .collect { token ->
                    if (!attempted.add(token)) return@collect
                    // A transport failure says nothing about this token, so allow a
                    // later retry; a real server verdict is final for that token.
                    if (!submit(courseId, token = token, canAdvertise = canAdvertise)) {
                        attempted.remove(token)
                    }
                }
        } catch (e: BleUnavailableException) {
            // Radio unusable: GPS carries the rest of the window on its own.
        }
    }

    private suspend fun gpsPath(courseId: String, canAdvertise: Boolean) {
        try {
            gpsSource.fixFlow()
                .takeWhile { !_state.value.settled }
                .collect { fix ->
                    submit(
                        courseId,
                        fix = GpsFixDto(fix.lat, fix.lng, fix.accuracy),
                        canAdvertise = canAdvertise,
                    )
                }
        } catch (e: MockLocationException) {
            // Not a failure to recover from: the device is reporting a manufactured
            // position, so end the whole attempt and let the screen close the app.
            cancelCheckIn()
            _mockLocationDetected.value = true
        } catch (e: Exception) {
            // No provider, permission revoked mid-window, etc. Bluetooth may still win.
        }
    }

    /**
     * Anything other than "accepted" is treated as "keep trying" — including the
     * server's deliberately ambiguous "collecting". Transport errors are ignored
     * for the same reason: the window, not any single request, decides.
     *
     * @return whether the server actually answered. False means the request never
     *   reached it (no HTTP status), so the caller may retry the same evidence;
     *   true means this submission got a real verdict and should not be repeated.
     */
    private suspend fun submit(
        courseId: String,
        token: String? = null,
        fix: GpsFixDto? = null,
        canAdvertise: Boolean,
    ): Boolean {
        val res = repo.recordAttendance(courseId, token = token, fix = fix, canAdvertise = canAdvertise)
        if (res is ApiResult.Success && res.data.status == "accepted") {
            onAccepted(res.data.seeding)
        }
        return res is ApiResult.Success || (res as? ApiResult.Error)?.code != null
    }

    private fun onAccepted(seeding: SeedingDto?) {
        _state.update {
            it.copy(
                phase = CheckInPhase.Idle,
                outcome = Outcome.Present,
                needsHelp = false,
                helpDialogOpen = false,
                error = null,
                secondsLeft = 0,
            )
        }
        startSeedingWindow(seeding)
    }

    // ── "Get help": the lecturer's code ──────────────────────────────────────────

    fun openHelp() {
        _state.update { it.copy(helpDialogOpen = true, helpError = null) }
    }

    fun dismissHelp() {
        _state.update { it.copy(helpDialogOpen = false, helpError = null) }
    }

    fun submitHelpCode(code: String) {
        val courseId = _state.value.selectedCourseId ?: return
        val trimmed = code.trim()
        if (!trimmed.matches(Regex("^[0-9]{8}$"))) {
            _state.update { it.copy(helpError = "Enter the 8-digit code your lecturer read out.") }
            return
        }
        cancelAttempt()
        windowJob = viewModelScope.launch {
            _state.update { it.copy(helpSubmitting = true, helpError = null) }
            when (val res = repo.recordAttendance(courseId, code = trimmed)) {
                is ApiResult.Success -> {
                    val outcome = outcomeOf(res.data.status)
                    _state.update {
                        it.copy(
                            helpSubmitting = false,
                            helpDialogOpen = outcome == Outcome.None,
                            helpError = if (outcome == Outcome.None) "That code was not accepted." else null,
                            outcome = outcome,
                            needsHelp = outcome == Outcome.None,
                            phase = CheckInPhase.Idle,
                        )
                    }
                }
                is ApiResult.Error -> _state.update {
                    it.copy(helpSubmitting = false, helpError = res.message)
                }
            }
        }
    }

    // ── Peer seeding ─────────────────────────────────────────────────────────────

    private fun canParticipateInSeeding(): Boolean =
        BlePermissions.hasAdvertise(getApplication()) && seedAdvertiser.isSupported()

    /**
     * Seeder and decoy windows are identical in length and appearance, so a
     * student cannot tell which one they were given.
     */
    private fun startSeedingWindow(seeding: SeedingDto?) {
        if (seeding?.role != "seed" && seeding?.role != "decoy") return
        seedingJob?.cancel()
        seedingJob = viewModelScope.launch {
            _state.update { it.copy(phase = CheckInPhase.Seeding) }
            runSeedingWindow(seeding)
            _state.update { it.copy(phase = CheckInPhase.Idle) }
        }
    }

    private suspend fun runSeedingWindow(seeding: SeedingDto) = coroutineScope {
        val durationMs = seeding.durationMs ?: 0L
        val sessionId = seeding.sessionId
        if (seeding.role != "seed" || seeding.token == null || sessionId == null) {
            delay(durationMs.coerceAtLeast(0))
            return@coroutineScope
        }
        val endAt = System.currentTimeMillis() + durationMs
        var advertiseFailed = false
        fun advertise(token: String) {
            seedAdvertiser.advertise(token) { advertiseFailed = true }
        }
        try {
            advertise(seeding.token)
            while (System.currentTimeMillis() < endAt && isActive) {
                delay(5_000)
                if (advertiseFailed) {
                    repo.releaseSeedToken(sessionId)
                    delay((endAt - System.currentTimeMillis()).coerceAtLeast(0))
                    return@coroutineScope
                }
                when (val res = repo.seedToken(sessionId)) {
                    is ApiResult.Success -> res.data.token?.let(::advertise)
                    // Lease may have ended server-side; wait the window out either way
                    // so the visible duration never depends on the real role.
                    is ApiResult.Error -> Unit
                }
            }
        } finally {
            seedAdvertiser.stop()
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────────

    private fun cancelAttempt() {
        windowJob?.cancel()
        windowJob = null
    }

    fun cancelCheckIn() {
        cancelAttempt()
        if (_state.value.running) {
            _state.update { it.copy(phase = CheckInPhase.Idle, secondsLeft = 0) }
        }
    }

    fun markAnotherCourse() {
        cancelAttempt()
        _state.update {
            it.copy(
                selectedCourseId = null,
                outcome = Outcome.None,
                needsHelp = false,
                phase = CheckInPhase.Idle,
                error = null,
                helpError = null,
                helpDialogOpen = false,
                secondsLeft = 0,
            )
        }
    }

    fun dismissError() {
        _state.update { it.copy(error = null) }
    }

    override fun onCleared() {
        super.onCleared()
        windowJob?.cancel()
        seedingJob?.cancel()
        seedAdvertiser.stop()
    }

    companion object {
        const val WINDOW_SECONDS = 90

        private fun outcomeOf(status: String?): Outcome = when (status) {
            "present", "accepted" -> Outcome.Present
            "flagged" -> Outcome.Flagged
            else -> Outcome.None
        }

        /**
         * Everything the check-in may need, asked for once up front: Bluetooth
         * scanning, precise location, and advertising for peer seeding. Denying
         * advertising never blocks attendance — it only makes this device
         * ineligible to seed.
         */
        fun requiredPermissions(): Array<String> =
            (
                BlePermissions.scanPermissions()
                    + LocationPermissions.permissions()
                    + BlePermissions.advertisePermissions()
                ).distinct().toTypedArray()
    }
}
