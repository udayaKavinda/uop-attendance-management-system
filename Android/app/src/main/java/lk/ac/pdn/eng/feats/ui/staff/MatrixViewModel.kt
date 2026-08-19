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

    /** Builds a CSV string from the loaded matrix for sharing/export. */
    fun toCsv(): String {
        val data = _state.value.data ?: return ""
        val sessions = data.sessions.orEmpty()
        val header = listOf("Student ID") + sessions.map { it.label ?: it.id.orEmpty() }
        val sb = StringBuilder()
        sb.append(header.joinToString(",") { csvCell(it) }).append('\n')
        data.rows.orEmpty().forEach { row ->
            val cells = mutableListOf(csvCell(row.displayId ?: ""))
            sessions.forEach { s ->
                // Presence only — verification provenance stays server-side.
                // "?" marks a submission still waiting on the lecturer's decision.
                cells.add(
                    when (row.attendance?.get(s.id)) {
                        "present" -> "P"
                        "under_review" -> "?"
                        else -> ""
                    },
                )
            }
            sb.append(cells.joinToString(",")).append('\n')
        }
        return sb.toString()
    }

    private fun csvCell(value: String): String =
        if (value.contains(',') || value.contains('"')) "\"" + value.replace("\"", "\"\"") + "\"" else value
}
