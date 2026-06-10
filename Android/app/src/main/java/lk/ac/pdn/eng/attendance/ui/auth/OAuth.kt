package lk.ac.pdn.eng.attendance.ui.auth

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

/** Launches the server's native Google OAuth flow in a Chrome Custom Tab. */
object OAuth {

    /** Must match NATIVE_OAUTH_RETURN_BASES in server/src/utils/constants.js. */
    const val RETURN_TARGET = "lk.ac.pdn.eng.attendance://oauth"

    fun authUrl(base: String): String {
        val clean = base.trim().trimEnd('/')
        return "$clean/auth/google?returnTo=" + Uri.encode(RETURN_TARGET)
    }

    fun launch(context: Context, base: String) {
        val intent = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
        intent.launchUrl(context, Uri.parse(authUrl(base)))
    }
}
