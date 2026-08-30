package lk.ac.pdn.eng.feats.ui.student

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import lk.ac.pdn.eng.feats.data.net.ApiResult
import lk.ac.pdn.eng.feats.data.net.RunningCourseDto
import lk.ac.pdn.eng.feats.ui.container

data class CourseRegistrationState(
    val loading: Boolean = true,
    val courses: List<RunningCourseDto> = emptyList(),
    val registeredIds: Set<String> = emptySet(),
    /** Course id with a register/unregister request in flight, if any. */
    val pendingId: String? = null,
    val error: String? = null,
)

/** Backs the optional "Register for courses" screen — see CourseRegistrationScreen. */
class CourseRegistrationViewModel(app: Application) : AndroidViewModel(app) {
    private val repo get() = container.repository

    private val _state = MutableStateFlow(CourseRegistrationState())
    val state: StateFlow<CourseRegistrationState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val catalog = repo.courseCatalog()
            val registered = repo.registeredCourses()
            _state.update {
                it.copy(
                    loading = false,
                    courses = (catalog as? ApiResult.Success)?.data ?: emptyList(),
                    registeredIds = (registered as? ApiResult.Success)?.data?.toSet() ?: emptySet(),
                    error = (catalog as? ApiResult.Error)?.message,
                )
            }
        }
    }

    fun toggle(courseId: String) {
        if (_state.value.pendingId != null) return
        val wasRegistered = _state.value.registeredIds.contains(courseId)
        _state.update { it.copy(pendingId = courseId, error = null) }
        viewModelScope.launch {
            val res = if (wasRegistered) repo.unregisterCourse(courseId) else repo.registerCourse(courseId)
            _state.update { s ->
                when (res) {
                    is ApiResult.Success -> s.copy(
                        pendingId = null,
                        registeredIds = if (wasRegistered) s.registeredIds - courseId else s.registeredIds + courseId,
                    )
                    is ApiResult.Error -> s.copy(pendingId = null, error = res.message)
                }
            }
        }
    }
}
