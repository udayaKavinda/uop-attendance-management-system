package lk.ac.pdn.eng.attendance.data.net

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/**
 * Global bus for session-invalidation (HTTP 401). Mirrors the web app's
 * notifySessionInvalid(): any 401 pushes the user back to the login screen.
 */
object SessionEvents {
    private val _unauthorized = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val unauthorized: SharedFlow<Unit> = _unauthorized

    fun notifyUnauthorized() {
        _unauthorized.tryEmit(Unit)
    }
}
