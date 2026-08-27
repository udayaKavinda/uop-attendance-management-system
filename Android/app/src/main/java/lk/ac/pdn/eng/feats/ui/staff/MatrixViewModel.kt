package lk.ac.pdn.eng.feats.ui.staff

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import lk.ac.pdn.eng.feats.data.net.ApiResult
import lk.ac.pdn.eng.feats.data.net.AttendanceMatrixRes
import lk.ac.pdn.eng.feats.ui.container
import java.io.File

data class MatrixState(
    val loading: Boolean = true,
    val error: String? = null,
    val data: AttendanceMatrixRes? = null,
)

class MatrixViewModel(app: Application) : AndroidViewModel(app) {
    private val repo get() = container.repository

    private val _state = MutableStateFlow(MatrixState())
    val state: StateFlow<MatrixState> = _state.asStateFlow()

    private var loadedCourseId: String? = null

    fun load(courseId: String) {
        if (loadedCourseId == courseId && _state.value.data != null) return
        loadedCourseId = courseId
        viewModelScope.launch {
            _state.value = MatrixState(loading = true)
            when (val res = repo.matrix(courseId)) {
                is ApiResult.Success -> _state.value = MatrixState(loading = false, data = res.data)
                is ApiResult.Error -> _state.value = MatrixState(loading = false, error = res.message)
            }
        }
    }

    /**
     * Downloads the Excel export to a cache file ready to share — flagged cells carry
     * their red fill and reason comment server-side, which a plain CSV string could
     * never represent. Returns null (and sets [MatrixState.error]) on failure.
     */
    suspend fun downloadXlsx(courseId: String): File? =
        when (val res = repo.attendanceMatrixXlsx(courseId)) {
            is ApiResult.Success -> {
                val dir = File(getApplication<Application>().cacheDir, "exports").apply { mkdirs() }
                val file = File(dir, "attendance-$courseId.xlsx")
                file.writeBytes(res.data)
                file
            }
            is ApiResult.Error -> {
                _state.value = _state.value.copy(error = res.message)
                null
            }
        }
}
