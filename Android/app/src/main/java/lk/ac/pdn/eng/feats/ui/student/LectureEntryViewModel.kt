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
import lk.ac.pdn.eng.feats.data.net.CourseDto
import lk.ac.pdn.eng.feats.data.net.GpsFixDto
import lk.ac.pdn.eng.feats.data.net.SeedingDto
import lk.ac.pdn.eng.feats.location.GpsLocationSource
import lk.ac.pdn.eng.feats.location.LocationPermissions
import lk.ac.pdn.eng.feats.location.LocationUnavailableException
import lk.ac.pdn.eng.feats.ui.container

enum class ScanPhase(val label: String) {
    Idle("📡  Scan for Bluetooth Attendance"),
    Fetching("Looking up session…"),
    Watching("Scanning for classroom signal…"),
    WatchingGps("Verifying your location…"),
    Submitting("Verifying attendance…"),
    Seeding("Finishing up…"),
}

data class LectureEntryState(
    val courses: List<CourseDto> = emptyList(),
    val selectedCourseId: String? = null,
    val phase: ScanPhase = ScanPhase.Idle,
    val recorded: Boolean = false,
    val checkingStatus: Boolean = false,
    val error: String? = null,
    val needsPermission: Boolean = false,
) {
    val scanning: Boolean get() = phase != ScanPhase.Idle
    val busy: Boolean get() = scanning || checkingStatus

    val selectedCourse: CourseDto? get() = courses.firstOrNull { it.id == selectedCourseId }
    /** "bluetooth" | "geofence" | "both" — defaults to today's only mode when absent/unknown. */
    val verification: String get() = selectedCourse?.verification ?: "bluetooth"
}

class LectureEntryViewModel(app: Application) : AndroidViewModel(app) {

    private val repo get() = container.repository
    private val scanner = BleScanner(app)
    private val gpsSource = GpsLocationSource(app)
    private val seedAdvertiser = BleAdvertiser(app)

    private val _state = MutableStateFlow(LectureEntryState())
    val state: StateFlow<LectureEntryState> = _state.asStateFlow()

    private var scanJob: Job? = null

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
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            _state.value = _state.value.copy(phase = ScanPhase.Fetching, error = null)
            when (verification) {
                "geofence" -> runGpsFlow(courseId)
                "both" -> runBothFlow(courseId)
                else -> runBleFlow(courseId)
            }
        }
    }

    // ── Bluetooth path (unchanged behaviour/timeout from the original BLE-only flow) ──

    private suspend fun runBleFlow(courseId: String) {
        when (val target = repo.bluetoothTarget(courseId)) {
            is ApiResult.Error -> {
                _state.value = _state.value.copy(phase = ScanPhase.Idle, error = target.message)
                return
            }
            is ApiResult.Success -> Unit
        }
        val token = scanForToken(30_000) ?: run {
            _state.value = _state.value.copy(
                phase = ScanPhase.Idle,
                error = "No Bluetooth signal received in 30 s. Make sure the lecturer is broadcasting and you are near the room.",
            )
            return
        }
        submitToken(courseId, token)
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

    private suspend fun submitToken(courseId: String, token: String) {
        _state.value = _state.value.copy(phase = ScanPhase.Submitting)
        val canAdvertise = seedAdvertiser.isSupported()
        when (val res = repo.recordAttendance(courseId, token = token, canAdvertise = canAdvertise)) {
            is ApiResult.Success -> {
                if (res.data.status == "accepted") {
                    finishAccepted(res.data.seeding)
                } else {
                    _state.value = _state.value.copy(phase = ScanPhase.Idle, error = "Verification failed. Move closer and try again.")
                }
            }
            is ApiResult.Error -> _state.value = _state.value.copy(phase = ScanPhase.Idle, error = res.message)
        }
    }

    // ── GPS geofence path ─────────────────────────────────────────────────────────────

    /**
     * Streams fixes, submitting each one, until the server accepts, errors, or the
     * window elapses. `timeoutMs` defaults to the full 90s window; [runBothFlow]
     * passes a shorter remainder when GPS is the fallback after a Bluetooth miss.
     */
    private suspend fun runGpsFlow(courseId: String, timeoutMs: Long = 90_000) {
        if (!LocationPermissions.hasFineLocation(getApplication())) {
            _state.value = _state.value.copy(phase = ScanPhase.Idle, error = LocationPermissions.permissionDeniedMessage())
            return
        }
        _state.value = _state.value.copy(phase = ScanPhase.WatchingGps)
        val canAdvertise = seedAdvertiser.isSupported()
        var done = false
        var errorMessage: String? = null

        try {
            withTimeoutOrNull(timeoutMs) {
                gpsSource.fixFlow().takeWhile { !done }.collect { fix ->
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
            _state.value = _state.value.copy(phase = ScanPhase.Idle, error = e.message)
            return
        }

        if (errorMessage != null) {
            _state.value = _state.value.copy(phase = ScanPhase.Idle, error = errorMessage)
        } else if (!_state.value.recorded) {
            _state.value = _state.value.copy(
                phase = ScanPhase.Idle,
                error = "Could not verify your location in time. Move closer to the building and try again.",
            )
        }
    }

    // ── Combined path ────────────────────────────────────────────────────────────────

    /**
     * Practical simplification of the design's "scan BLE and stream GPS
     * simultaneously": try Bluetooth first for a short window (fast when the
     * student is already in range), then fall back to GPS for the remainder of
     * the 90s budget. Same OR-acceptance outcome as running both concurrently,
     * without the added coroutine/radio-cleanup complexity of true concurrency.
     */
    private suspend fun runBothFlow(courseId: String) {
        val bleWindowMs = 20_000L
        val target = repo.bluetoothTarget(courseId)
        val token = if (target is ApiResult.Success) scanForToken(bleWindowMs) else null
        if (token != null) {
            submitToken(courseId, token)
            return
        }
        if (!_state.value.recorded) {
            runGpsFlow(courseId, timeoutMs = 70_000)
        }
    }

    // ── Shared: acceptance + peer-seeding window ────────────────────────────────────

    /**
     * Runs the seeding/decoy window (if any) before marking the record as done.
     * Seeder and decoy windows run for the identical `durationMs` with identical
     * UI (Seeding phase) — a student can't tell which one they got.
     */
    private suspend fun finishAccepted(seeding: SeedingDto?) {
        if (seeding?.role == "seed" || seeding?.role == "decoy") {
            _state.value = _state.value.copy(phase = ScanPhase.Seeding)
            runSeedingWindow(seeding)
        }
        _state.value = _state.value.copy(phase = ScanPhase.Idle, recorded = true, error = null)
    }

    private suspend fun runSeedingWindow(seeding: SeedingDto) = coroutineScope {
        val durationMs = seeding.durationMs ?: 0L
        if (seeding.role != "seed" || seeding.token == null || seeding.sessionId == null) {
            delay(durationMs.coerceAtLeast(0))
            return@coroutineScope
        }
        val sessionId = seeding.sessionId
        val endAt = System.currentTimeMillis() + durationMs
        try {
            seedAdvertiser.advertise(seeding.token) { /* best-effort; a mid-window failure just stops re-advertising */ }
            while (System.currentTimeMillis() < endAt && isActive) {
                delay(5_000)
                when (val res = repo.seedToken(sessionId)) {
                    is ApiResult.Success -> res.data.token?.let { seedAdvertiser.advertise(it) { } }
                    is ApiResult.Error -> Unit // lease may have ended server-side; keep waiting out the window regardless
                }
            }
        } finally {
            seedAdvertiser.stop()
        }
    }

    /**
     * Fallback path: submit the lecturer-announced 8-digit code instead of waiting on
     * the BLE scan. Independent of [startScan] — the automatic scan (if any is running)
     * is left alone; this is a separate, explicit student action.
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
        if (_state.value.busy) return
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            _state.value = _state.value.copy(phase = ScanPhase.Submitting, error = null)
            when (val res = repo.recordManualAttendance(courseId, trimmed)) {
                is ApiResult.Success -> {
                    val ok = res.data.success == true || res.data.duplicate == true
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
    }
}
