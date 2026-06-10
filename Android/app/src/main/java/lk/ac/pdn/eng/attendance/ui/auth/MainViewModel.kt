package lk.ac.pdn.eng.attendance.ui.auth

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import lk.ac.pdn.eng.attendance.data.net.ApiResult
import lk.ac.pdn.eng.attendance.data.net.SessionEvents
import lk.ac.pdn.eng.attendance.data.prefs.CachedUser
import lk.ac.pdn.eng.attendance.ui.container
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface SessionState {
    data object Loading : SessionState
    data object LoggedOut : SessionState
    data class LoggedIn(val user: CachedUser) : SessionState
}

/**
 * Owns the app-wide auth session: hydrates from the cookie-backed server session,
 * runs the native OAuth exchange-code handshake, and reacts to 401s.
 */
class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val repo get() = container.repository
    private val prefs get() = container.prefs

    private val _session = MutableStateFlow<SessionState>(SessionState.Loading)
    val session: StateFlow<SessionState> = _session.asStateFlow()

    private val _authBusy = MutableStateFlow(false)
    val authBusy: StateFlow<Boolean> = _authBusy.asStateFlow()

    private val _authError = MutableStateFlow<String?>(null)
    val authError: StateFlow<String?> = _authError.asStateFlow()

    val baseUrl: String get() = prefs.baseUrl

    init {
        // Any 401 anywhere drops us to the login screen.
        viewModelScope.launch {
            SessionEvents.unauthorized.collect { forceLoggedOut() }
        }
        hydrate()
    }

    /** Re-checks the server session and updates [session]. */
    fun hydrate() {
        viewModelScope.launch {
            when (val res = repo.me()) {
                is ApiResult.Success -> applyMe(res.data.studentId, res.data.role, res.data.email, res.data.lecturerId)
                is ApiResult.Error -> {
                    prefs.clearUser()
                    _session.value = SessionState.LoggedOut
                }
            }
        }
    }

    fun setBaseUrl(url: String) {
        prefs.baseUrl = url
    }

    fun clearAuthError() {
        _authError.value = null
    }

    /** Handles the deep-link `code` returned by the native OAuth redirect. */
    fun onOAuthCode(code: String) {
        if (_authBusy.value) return
        viewModelScope.launch {
            _authBusy.value = true
            _authError.value = null
            when (val ex = repo.exchangeCode(code)) {
                is ApiResult.Success -> {
                    // Retry me() a few times — session propagation can lag slightly.
                    var applied = false
                    repeat(6) { attempt ->
                        if (applied) return@repeat
                        when (val me = repo.me()) {
                            is ApiResult.Success -> {
                                applyMe(me.data.studentId, me.data.role, me.data.email, me.data.lecturerId)
                                applied = true
                            }
                            is ApiResult.Error -> delay(200L * (attempt + 1))
                        }
                    }
                    if (!applied) _authError.value = "Signed in, but could not load your profile. Try again."
                }
                is ApiResult.Error -> _authError.value = ex.message
            }
            _authBusy.value = false
        }
    }

    fun logout() {
        viewModelScope.launch {
            repo.logout()
            container.cookieJar.clear()
            prefs.clearUser()
            _session.value = SessionState.LoggedOut
        }
    }

    private fun applyMe(studentId: String?, role: String?, email: String?, lecturerId: String?) {
        if (studentId.isNullOrBlank()) {
            prefs.clearUser()
            _session.value = SessionState.LoggedOut
            return
        }
        val resolvedRole = role ?: "student"
        prefs.saveUser(studentId, resolvedRole, email ?: "", lecturerId)
        _session.value = SessionState.LoggedIn(
            CachedUser(studentId, resolvedRole, email ?: "", lecturerId),
        )
    }

    private fun forceLoggedOut() {
        container.cookieJar.clear()
        prefs.clearUser()
        _session.value = SessionState.LoggedOut
    }
}
