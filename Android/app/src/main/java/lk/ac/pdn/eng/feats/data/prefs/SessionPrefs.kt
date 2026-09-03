package lk.ac.pdn.eng.feats.data.prefs

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
/**
 * Encrypted key/value store for persisted session cookies and the cached
 * signed-in user. Falls back to plain SharedPreferences if the Android Keystore
 * is unavailable on the device.
 */
class SessionPrefs(context: Context) {

    private val prefs: SharedPreferences = openEncrypted(context)
        // Retry once after dropping the encrypted file. The Android Keystore master
        // key can be invalidated out from under us (lock-screen change, biometric
        // re-enrolment, restore-to-new-device), after which EncryptedSharedPreferences
        // throws on open until the file it can no longer decrypt is deleted. Deleting
        // costs this device its saved session — the user signs in again — which is the
        // same outcome as the plaintext fallback below, except it is self-healing:
        // every later launch is encrypted again.
        ?: openEncrypted(context, dropExisting = true)
        // Genuinely no Keystore on this device. Plaintext, and it stays plaintext.
        ?: context.getSharedPreferences(PLAIN_FILE, Context.MODE_PRIVATE)

    /**
     * Deliberately NOT a silent `runCatching { encrypted } ?: plain` one-liner.
     *
     * That form reads and writes a *different file* on any transient failure, so a
     * single Keystore hiccup at launch made the app read an empty store: the session
     * cookie and cached user still sat in the encrypted file, but nothing could see
     * them, so the user was silently signed out — and signed back in on the next
     * launch when the Keystore happened to work. The store is chosen once per process
     * (see AppContainer), so a hiccup decided the whole session's fate. It also meant
     * the session cookie could start being written in plaintext with no signal at all.
     */
    private fun openEncrypted(context: Context, dropExisting: Boolean = false): SharedPreferences? =
        runCatching {
            if (dropExisting) context.deleteSharedPreferences(SECURE_FILE)
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                SECURE_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            ) as SharedPreferences
        }.getOrNull()

    // ── Cached user ────────────────────────────────────────────────────────────────

    fun saveUser(studentId: String, role: String, email: String, lecturerId: String?) {
        prefs.edit()
            .putString(KEY_USER_ID, studentId)
            .putString(KEY_ROLE, role)
            .putString(KEY_EMAIL, email)
            .putString(KEY_LECTURER_ID, lecturerId)
            .apply()
    }

    fun cachedUser(): CachedUser? {
        val id = prefs.getString(KEY_USER_ID, null) ?: return null
        return CachedUser(
            studentId = id,
            role = prefs.getString(KEY_ROLE, "student") ?: "student",
            email = prefs.getString(KEY_EMAIL, "") ?: "",
            lecturerId = prefs.getString(KEY_LECTURER_ID, null),
        )
    }

    fun clearUser() {
        prefs.edit()
            .remove(KEY_USER_ID)
            .remove(KEY_ROLE)
            .remove(KEY_EMAIL)
            .remove(KEY_LECTURER_ID)
            .apply()
    }

    // ── Cookies (used by PersistentCookieJar) ────────────────────────────────────────

    fun readCookies(): String? = prefs.getString(KEY_COOKIES, null)

    fun writeCookies(serialized: String?) {
        prefs.edit().apply {
            if (serialized.isNullOrEmpty()) remove(KEY_COOKIES) else putString(KEY_COOKIES, serialized)
        }.apply()
    }

    companion object {
        private const val SECURE_FILE = "uop_attendance_secure"
        private const val PLAIN_FILE = "uop_attendance_plain"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_ROLE = "role"
        private const val KEY_EMAIL = "email"
        private const val KEY_LECTURER_ID = "lecturer_id"
        private const val KEY_COOKIES = "cookies"
    }
}

data class CachedUser(
    val studentId: String,
    val role: String,
    val email: String,
    val lecturerId: String?,
) {
    val isStaff: Boolean get() = role == "admin" || role == "lecturer"
}
