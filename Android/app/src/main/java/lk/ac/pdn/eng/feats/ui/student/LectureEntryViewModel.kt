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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import lk.ac.pdn.eng.feats.ble.BleAdvertiser
import lk.ac.pdn.eng.feats.ble.BlePermissions
import lk.ac.pdn.eng.feats.ble.BleScanner
import lk.ac.pdn.eng.feats.ble.BleUnavailableException
import lk.ac.pdn.eng.feats.data.net.ApiResult
import lk.ac.pdn.eng.feats.data.net.RunningCourseDto
import lk.ac.pdn.eng.feats.data.net.GpsFixDto
import lk.ac.pdn.eng.feats.data.net.SeedingDto
import lk.ac.pdn.eng.feats.location.GpsLocationSource
import lk.ac.pdn.eng.feats.location.LocationPermissions
import lk.ac.pdn.eng.feats.location.LocationUnavailableException
import lk.ac.pdn.eng.feats.ui.container
import lk.ac.pdn.eng.feats.ui.AutomaticPath
import lk.ac.pdn.eng.feats.ui.VerificationPolicy

enum class ScanPhase(val label: String) {
    Idle("📡  Scan for Bluetooth Attendance"),
    Fetching("Looking up session…"),
    Watching("Scanning for classroom signal…"),
    WatchingGps("Verifying your location…"),
    Submitting("Verifying attendance…"),
    Seeding("Finishing up…"),
}

data class LectureEntryState(
    val courses: List<RunningCourseDto> = emptyList(),
    val selectedCourseId: String? = null,
    val phase: ScanPhase = ScanPhase.Idle,
    val recorded: Boolean = false,
    val checkingStatus: Boolean = false,
    val error: String? = null,
    val needsPermission: Boolean = false,
) {
    val scanning: Boolean get() = phase != ScanPhase.Idle
    val busy: Boolean get() = scanning || checkingStatus

    val selectedCourse: RunningCourseDto? get() = courses.firstOrNull { it.id == selectedCourseId }
    val verification: String? get() = selectedCourse?.verification
}

class LectureEntryViewModel(app: Application) : AndroidViewModel(app) {

    private val repo get() = container.repository
    private val scanner = BleScanner(app)
    private val gpsSource = GpsLocationSource(app)
    private val seedAdvertiser = BleAdvertiser(app)

    private val _state = MutableStateFlow(LectureEntryState())
    val state: StateFlow<LectureEntryState> = _state.asStateFlow()

    private var scanJob: Job? = null
    private var seedingJob: Job? = null

    init {
        pollRunningCourses()
    }

    private fun pollRunningCourses() {
        viewModelScope.launch {
            while (isActive) {
                when (val res = repo.runningCourses()) {
                    is ApiResult.Success -> {
                        val items = res.data
                        _state.value = _state.value.copy(courses = items, error = null).let { s ->
                            // Drop selection if its course stopped running.
                            if (s.selectedCourseId != null && items.none { it.id == s.selectedCourseId }) {
                                s.copy(selectedCourseId = null, recorded = false)
                            } else s
                        }
                    }
                    is ApiResult.Error -> _state.value = _state.value.copy(error = res.message)
                }
                delay(10_000)
            }
        }
    }

    fun selectCourse(courseId: String?) {
        _state.value = _state.value.copy(selectedCourseId = courseId, recorded = false, error = null)
        if (courseId != null) refreshStatus(courseId)
    }

    private fun refreshStatus(courseId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(checkingStatus = true)
            when (val res = repo.attendanceStatus(courseId)) {
                is ApiResult.Success ->
                    _state.value = _state.value.copy(recorded = res.data.attended == true, checkingStatus = false)
                is ApiResult.Error ->
                    _state.value = _state.value.copy(error = res.message, recorded = false, checkingStatus = false)
            }
        }
    }

    fun reportScanBlocked(message: String) {
        _state.value = _state.value.copy(error = message)
    }

    fun onPermissionDenied() {
        _state.value = _state.value.copy(
            needsPermission = false,
            error = BlePermissions.scanPermissionDeniedMessage(),
        )
    }

    fun onLocationPermissionDenied() {
        _state.value = _state.value.copy(error = LocationPermissions.permissionDeniedMessage())
    }

    /**
     * Called once preflight for the session's verification mode is clear — the
     * screen checks BLE and/or location permissions/adapters first, matching the
     * pattern already established for the Bluetooth-only path, then calls this.
     */
    fun startScan() {
        val courseId = _state.value.selectedCourseId
        if (courseId == null) {
            _state.value = _state.value.copy(error = "Select a course first.")
            return
        }
        if (_state.value.scanning) return
        val verification = _state.value.verification
        if (verification !in setOf("bluetooth", "geofence", "both")) {
            _state.value = _state.value.copy(error = "The session has an invalid verification policy.")
            return
        }
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            _state.value = _state.value.copy(phase = ScanPhase.Fetching, error = null)
            when (verification) {
                "geofence" -> runGpsFlow(courseId)
                "both" -> runBothFlow(courseId)
                "bluetooth" -> runBleFlow(courseId)
            }
        }
    }

    // ── Bluetooth path (unchanged behaviour/timeout from the original BLE-only flow) ──

    private suspend fun runBleFlow(courseId: String, reportFailure: Boolean = true) {
        when (val target = repo.bluetoothTarget(courseId)) {
            is ApiResult.Error -> {
                if (reportFailure) {
                    _state.value = _state.value.copy(phase = ScanPhase.Idle, error = target.message)
                }
                return
            }
            is ApiResult.Success -> Unit
        }
        val token = scanForToken(30_000) ?: run {
            if (reportFailure) {
                _state.value = _state.value.copy(
                    phase = ScanPhase.Idle,
                    error = "No Bluetooth signal received in 30 s. Make sure the lecturer is broadcasting and you are near the room.",
                )
            }
            return
        }
        if (!_state.value.recorded) submitToken(courseId, token, reportFailure)
    }

    private suspend fun scanForToken(timeoutMs: Long): String? {
        _state.value = _state.value.copy(phase = ScanPhase.Watching)
        return try {
            withTimeoutOrNull(timeoutMs) { scanner.tokenFlow().first() }
        } catch (e: BleUnavailableException) {
            _state.value = _state.value.copy(phase = ScanPhase.Idle, error = e.message)
            null
        }
    }

    private suspend fun submitToken(courseId: String, token: String, reportFailure: Boolean = true) {
        _state.value = _state.value.copy(phase = ScanPhase.Submitting)
        val canAdvertise = canParticipateInSeeding()
        when (val res = repo.recordAttendance(courseId, token = token, canAdvertise = canAdvertise)) {
            is ApiResult.Success -> {
                if (res.data.status == "accepted") {
                    finishAccepted(res.data.seeding)
                } else {
                    if (reportFailure) {
                        _state.value = _state.value.copy(phase = ScanPhase.Idle, error = "Verification failed. Move closer and try again.")
                    }
                }
            }
            is ApiResult.Error -> if (reportFailure) {
                _state.value = _state.value.copy(phase = ScanPhase.Idle, error = res.message)
            }
        }
    }

    // ── GPS geofence path ─────────────────────────────────────────────────────────────

    /**
     * Streams fixes, submitting each one, until the server accepts, errors, or the
     * window elapses. `timeoutMs` defaults to the full 90s window; [runBothFlow]
     * passes a shorter remainder when GPS is the fallback after a Bluetooth miss.
     */
    private suspend fun runGpsFlow(
        courseId: String,
        timeoutMs: Long = 90_000,
        reportFailure: Boolean = true,
    ) {
        if (!LocationPermissions.hasFineLocation(getApplication())) {
            if (reportFailure) {
                _state.value = _state.value.copy(phase = ScanPhase.Idle, error = LocationPermissions.permissionDeniedMessage())
            }
            return
        }
        _state.value = _state.value.copy(phase = ScanPhase.WatchingGps)
        val canAdvertise = canParticipateInSeeding()
        var done = false
        var errorMessage: String? = null

        try {
            withTimeoutOrNull(timeoutMs) {
                gpsSource.fixFlow().takeWhile { !done && !_state.value.recorded }.collect { fix ->
                    _state.value = _state.value.copy(phase = ScanPhase.Submitting)
                    val body = GpsFixDto(fix.lat, fix.lng, fix.accuracy)
                    when (val res = repo.recordAttendance(courseId, fix = body, canAdvertise = canAdvertise)) {
                        is ApiResult.Success -> {
                            if (res.data.status == "accepted") {
                                done = true
                                finishAccepted(res.data.seeding)
                            } else {
                                _state.value = _state.value.copy(phase = ScanPhase.WatchingGps)
                            }
                        }
                        is ApiResult.Error -> {
                            done = true
                            errorMessage = res.message
                        }
                    }
                }
            }
        } catch (e: LocationUnavailableException) {
            if (reportFailure) _state.value = _state.value.copy(phase = ScanPhase.Idle, error = e.message)
            return
        }

        if (errorMessage != null && reportFailure) {
            _state.value = _state.value.copy(phase = ScanPhase.Idle, error = errorMessage)
        } else if (!_state.value.recorded && reportFailure) {
            _state.value = _state.value.copy(
                phase = ScanPhase.Idle,
                error = "Could not verify your location in time. Move closer to the building and try again.",
            )
        }
    }

    // ── Combined path ────────────────────────────────────────────────────────────────

    /** Runs every available radio concurrently; either successful method wins. */
    private suspend fun runBothFlow(courseId: String) = coroutineScope {
        val app = getApplication<Application>()
        val canBle = BlePermissions.scanBlocker(app) == null
        val canGps = LocationPermissions.hasFineLocation(app)
        val paths = VerificationPolicy.availablePaths("both", canBle, canGps)
        if (paths.isEmpty()) {
            _state.value = _state.value.copy(
                phase = ScanPhase.Idle,
                error = "Allow Bluetooth or precise location to verify this session.",
            )
            return@coroutineScope
        }

        val jobs = buildList {
            if (AutomaticPath.Bluetooth in paths) add(launch { runBleFlow(courseId, reportFailure = false) })
            if (AutomaticPath.Gps in paths) add(launch { runGpsFlow(courseId, timeoutMs = 90_000, reportFailure = false) })
        }
        while (!_state.value.recorded && jobs.any { it.isActive }) delay(100)
        if (_state.value.recorded) jobs.filter { it.isActive }.forEach { it.cancel() }
        jobs.forEach { it.join() }
        if (!_state.value.recorded) {
            _state.value = _state.value.copy(
                phase = ScanPhase.Idle,
                error = "Neither Bluetooth nor GPS could verify attendance. Move closer and try again.",
            )
        }
    }

    // ── Shared: acceptance + peer-seeding window ────────────────────────────────────

    /**
     * Starts the seeding/decoy window (if any) after marking attendance accepted.
     * Seeder and decoy windows run for the identical `durationMs` with identical
     * UI (Seeding phase) — a student can't tell which one they got.
     */
    private fun finishAccepted(seeding: SeedingDto?) {
        // Mark accepted immediately so a concurrent verification path stops submitting.
        _state.value = _state.value.copy(phase = ScanPhase.Idle, recorded = true, error = null)
        if (seeding?.role == "seed" || seeding?.role == "decoy") {
            seedingJob?.cancel()
            seedingJob = viewModelScope.launch {
                _state.value = _state.value.copy(phase = ScanPhase.Seeding)
                runSeedingWindow(seeding)
                if (_state.value.recorded) _state.value = _state.value.copy(phase = ScanPhase.Idle)
            }
        }
    }

    private fun canParticipateInSeeding(): Boolean =
        BlePermissions.hasAdvertise(getApplication()) && seedAdvertiser.isSupported()

    private suspend fun runSeedingWindow(seeding: SeedingDto) = coroutineScope {
        val durationMs = seeding.durationMs ?: 0L
        if (seeding.role != "seed" || seeding.token == null || seeding.sessionId == null) {
            delay(durationMs.coerceAtLeast(0))
            return@coroutineScope
        }
        val sessionId = seeding.sessionId
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
                    is ApiResult.Error -> Unit // lease may have ended server-side; keep waiting out the window regardless
                }
            }
        } finally {
            seedAdvertiser.stop()
        }
    }

    /**
     * Fallback path: submit the lecturer-announced 8-digit code instead of waiting on
     * the automatic attempt. If one is running it is cancelled so the code is handled
     * immediately as a separate, explicit student action.
     */
    fun submitManualCode(code: String) {
        val courseId = _state.value.selectedCourseId
        if (courseId == null) {
            _state.value = _state.value.copy(error = "Select a course first.")
            return
        }
        val trimmed = code.trim()
        if (!trimmed.matches(Regex("^[0-9]{8}$"))) {
            _state.value = _state.value.copy(error = "Enter the 8-digit attendance code.")
            return
        }
        // The manual fallback is always available: stop an in-progress automatic
        // attempt and submit the code immediately.
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            _state.value = _state.value.copy(phase = ScanPhase.Submitting, error = null)
            when (val res = repo.recordAttendance(courseId, code = trimmed)) {
                is ApiResult.Success -> {
                    val ok = res.data.status == "accepted"
                    _state.value = _state.value.copy(
                        phase = ScanPhase.Idle,
                        recorded = ok,
                        error = if (ok) null else "Incorrect code. Try again.",
                    )
                }
                is ApiResult.Error ->
                    _state.value = _state.value.copy(phase = ScanPhase.Idle, error = res.message)
            }
        }
    }

    /** Returns to the course picker so the student can mark attendance for another lecture. */
    fun resetForAnotherCourse() {
        scanJob?.cancel()
        scanJob = null
        _state.value = _state.value.copy(
            selectedCourseId = null,
            recorded = false,
            phase = ScanPhase.Idle,
            error = null,
        )
    }

    fun cancelScan() {
        scanJob?.cancel()
        scanJob = null
        if (_state.value.scanning) _state.value = _state.value.copy(phase = ScanPhase.Idle)
    }

    override fun onCleared() {
        super.onCleared()
        scanJob?.cancel()
        seedingJob?.cancel()
        seedAdvertiser.stop()
    }
}
