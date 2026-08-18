package lk.ac.pdn.eng.feats.ui.auth

import android.content.Context
import android.net.Uri
import android.os.Build
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import lk.ac.pdn.eng.feats.BuildConfig

/** Launches the server's native Google OAuth flow in a Chrome Custom Tab. */
object OAuth {

    /** Must match NATIVE_OAUTH_RETURN_BASES in server/src/utils/constants.js. */
    const val RETURN_TARGET = "lk.ac.pdn.eng.attendance://oauth"

    fun authUrl(): String {
        val base = BuildConfig.DEFAULT_API_BASE.trim().trimEnd('/')
        return "$base/auth/google?returnTo=" + Uri.encode(RETURN_TARGET)
    }

    fun launch(context: Context) {
        val builder = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
            .setUrlBarHidingEnabled(false)

        val customTabsIntent = builder.build()
        // Fresh tab each sign-in: avoids stale Google UI state and odd link hand-offs.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            customTabsIntent.intent.putExtra("androidx.browser.customtabs.extra.ENABLE_EPHEMERAL_BROWSING", true)
        }
        // Prefer Chrome so account-picker taps stay in the browser (not mailto handlers).
        CustomTabsClient.getPackageName(context, null)?.let { pkg ->
            customTabsIntent.intent.setPackage(pkg)
        }

        customTabsIntent.launchUrl(context, Uri.parse(authUrl()))
    }
}
