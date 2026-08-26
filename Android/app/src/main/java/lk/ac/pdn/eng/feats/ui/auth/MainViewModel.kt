package lk.ac.pdn.eng.feats.ui.auth

import android.app.Activity
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import lk.ac.pdn.eng.feats.BuildConfig
import lk.ac.pdn.eng.feats.data.net.ApiResult
import lk.ac.pdn.eng.feats.data.net.SessionEvents
import lk.ac.pdn.eng.feats.data.prefs.CachedUser
import lk.ac.pdn.eng.feats.ui.container
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

    /** True once the server reports a minSupportedVersionCode above this build's. Never clears itself. */
    private val _updateRequired = MutableStateFlow(false)
    val updateRequired: StateFlow<Boolean> = _updateRequired.asStateFlow()

    init {
        // Any 401 anywhere drops us to the login screen.
        viewModelScope.launch {
            SessionEvents.unauthorized.collect { forceLoggedOut() }
        }
        checkAppVersion()
        hydrate()
    }

    /** Public endpoint, checked before login state matters — an outdated app is blocked either way. */
    private fun checkAppVersion() {
        viewModelScope.launch {
            when (val res = repo.appVersion()) {
                is ApiResult.Success -> {
                    if (BuildConfig.VERSION_CODE < res.data) _updateRequired.value = true
                }
                is ApiResult.Error -> Unit // offline/unreachable: don't block on a check we couldn't run
            }
        }
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

    fun clearAuthError() {
        _authError.value = null
    }

    // ── Native sign-in (Credential Manager) ─────────────────────────────────────

    /**
     * Primary sign-in path: show Google's native account sheet, then trade the
     * returned ID token for a server session.
     *
     * On [GoogleSignInResult.Unavailable] the caller is expected to offer the
     * browser fallback — the login screen keeps that option visible at all times.
     */
    fun signInWithGoogle(activity: Activity) {
        if (_authBusy.value) return
        viewModelScope.launch {
            _authBusy.value = true
            _authError.value = null
            try {
                val nonce = when (val res = repo.googleNonce()) {
                    is ApiResult.Success -> res.data
                    is ApiResult.Error -> {
                        _authError.value = res.message
                        return@launch
                    }
                }
                if (nonce.isBlank()) {
                    _authError.value = "Could not start sign-in. Please try again."
                    return@launch
                }

                when (val outcome = GoogleAuth.signIn(activity, nonce)) {
                    is GoogleSignInResult.Success -> submitGoogleIdToken(outcome.idToken)
                    is GoogleSignInResult.Cancelled -> Unit // user dismissed; stay silent
                    is GoogleSignInResult.Unavailable -> _authError.value = outcome.message
                    is GoogleSignInResult.Failure -> _authError.value = outcome.message
                }
            } finally {
                _authBusy.value = false
            }
        }
    }

    /** Sends the verified Google ID token; the session cookie arrives on this response. */
    private suspend fun submitGoogleIdToken(idToken: String) {
        when (val res = repo.googleIdToken(idToken)) {
            is ApiResult.Success -> loadProfileAfterSignIn()
            is ApiResult.Error -> _authError.value = res.message
        }
    }

    // ── Browser fallback (Custom Tab OAuth) ─────────────────────────────────────

    /** Handles the deep-link `code` returned by the native OAuth redirect. */
    fun onOAuthCode(code: String) {
        if (_authBusy.value) return
        viewModelScope.launch {
            _authBusy.value = true
            _authError.value = null
            when (val ex = repo.exchangeCode(code)) {
                is ApiResult.Success -> loadProfileAfterSignIn()
                is ApiResult.Error -> _authError.value = ex.message
            }
            _authBusy.value = false
        }
    }

    /**
     * Shared by both sign-in paths: load the profile once the session cookie is set.
     * Retries briefly because session propagation can lag by a few hundred ms.
     */
    private suspend fun loadProfileAfterSignIn() {
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

    fun logout() {
        viewModelScope.launch {
            repo.logout()
            container.cookieJar.clear()
            prefs.clearUser()
            // Drop Credential Manager's cached account so the next sign-in shows
            // the chooser rather than silently reusing the last Google account.
            GoogleAuth.clearCredentialState(getApplication<Application>())
            _session.value = SessionState.LoggedOut
        }
    }

    private fun applyMe(studentId: String, role: String, email: String, lecturerId: String?) {
        if (studentId.isBlank()) {
            prefs.clearUser()
            _session.value = SessionState.LoggedOut
            return
        }
        prefs.saveUser(studentId, role, email, lecturerId)
        _session.value = SessionState.LoggedIn(
            CachedUser(studentId, role, email, lecturerId),
        )
    }

    private fun forceLoggedOut() {
        container.cookieJar.clear()
        prefs.clearUser()
        _session.value = SessionState.LoggedOut
    }
}
