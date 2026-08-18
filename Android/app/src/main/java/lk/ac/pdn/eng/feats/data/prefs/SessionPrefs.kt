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

    private val prefs: SharedPreferences = runCatching {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "uop_attendance_secure",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        ) as SharedPreferences
    }.getOrElse {
        context.getSharedPreferences("uop_attendance_plain", Context.MODE_PRIVATE)
    }

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
