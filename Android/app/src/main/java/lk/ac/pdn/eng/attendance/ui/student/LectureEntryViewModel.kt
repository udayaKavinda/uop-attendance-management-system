package lk.ac.pdn.eng.attendance.ui.student

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import lk.ac.pdn.eng.attendance.ble.BleScanner
import lk.ac.pdn.eng.attendance.ble.BleUnavailableException
import lk.ac.pdn.eng.attendance.data.net.ApiResult
import lk.ac.pdn.eng.attendance.data.net.CourseDto
import lk.ac.pdn.eng.attendance.ui.container

enum class ScanPhase(val label: String) {
    Idle("📡  Scan for Bluetooth Attendance"),
    Fetching("Looking up session…"),
    Watching("Scanning for classroom signal…"),
    Submitting("Verifying attendance…"),
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
}

class LectureEntryViewModel(app: Application) : AndroidViewModel(app) {

    private val repo get() = container.repository
    private val scanner = BleScanner(app)

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

    fun onPermissionResult(granted: Boolean) {
        if (granted) {
            _state.value = _state.value.copy(needsPermission = false)
            startScan()
        } else {
            _state.value = _state.value.copy(
                needsPermission = false,
                error = "Bluetooth permission is required to scan for the classroom signal.",
            )
        }
    }

    /** Called by the screen once Bluetooth permissions are confirmed granted. */
    fun startScan() {
        val courseId = _state.value.selectedCourseId
        if (courseId == null) {
            _state.value = _state.value.copy(error = "Select a course first.")
            return
        }
        if (_state.value.scanning) return
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            _state.value = _state.value.copy(phase = ScanPhase.Fetching, error = null)

            // Validate the target first (BT enabled, not paused, within window).
            when (val target = repo.bluetoothTarget(courseId)) {
                is ApiResult.Error -> {
                    _state.value = _state.value.copy(phase = ScanPhase.Idle, error = target.message)
                    return@launch
                }
                is ApiResult.Success -> Unit
            }

            _state.value = _state.value.copy(phase = ScanPhase.Watching)
            val token = try {
                withTimeoutOrNull(30_000) { scanner.tokenFlow().first() }
            } catch (e: BleUnavailableException) {
                _state.value = _state.value.copy(phase = ScanPhase.Idle, error = e.message)
                return@launch
            }

            if (token == null) {
                _state.value = _state.value.copy(
                    phase = ScanPhase.Idle,
                    error = "No Bluetooth signal received in 30 s. Make sure the lecturer is broadcasting and you are near the room.",
                )
                return@launch
            }

            _state.value = _state.value.copy(phase = ScanPhase.Submitting)
            when (val res = repo.recordBluetoothAttendance(courseId, token)) {
                is ApiResult.Success -> {
                    val ok = res.data.success == true || res.data.duplicate == true
                    _state.value = _state.value.copy(
                        phase = ScanPhase.Idle,
                        recorded = ok,
                        error = if (ok) null else "Verification failed. Move closer and try again.",
                    )
                }
                is ApiResult.Error ->
                    _state.value = _state.value.copy(phase = ScanPhase.Idle, error = res.message)
            }
        }
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
