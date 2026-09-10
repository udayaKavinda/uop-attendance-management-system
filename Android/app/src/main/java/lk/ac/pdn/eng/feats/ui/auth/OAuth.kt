package lk.ac.pdn.eng.feats.ui.auth

import android.content.Context
import android.net.Uri
import android.os.Build
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import lk.ac.pdn.eng.feats.BuildConfig

/**
 * What the `lk.ac.pdn.eng.attendance://oauth` deep link carried back.
 *
 * There used to be no [Failure] arm: MainActivity read only `code`, so a
 * rejected browser sign-in came back as a link with `?error=...`, produced a
 * null code, and the app did nothing at all — no error, no explanation, just a
 * sign-in button that appeared not to work.
 */
sealed interface OAuthReturn {
    data class Code(val value: String) : OAuthReturn
    data class Failure(val message: String) : OAuthReturn
}

/**
 * Maps the deep link's query onto a result. Kept free of `android.net.Uri` so it
 * is unit-testable, and kept in step with signInFailureMessage() in the web
 * client's useSession.ts — same reason codes, same copy.
 */
fun oauthReturnFrom(code: String?, error: String?, domain: String?): OAuthReturn? {
    if (!code.isNullOrBlank()) return OAuthReturn.Code(code)
    if (error.isNullOrBlank()) return null
    val message = when (error) {
        "domain" ->
            if (domain.isNullOrBlank()) {
                "That email address is not eligible to sign in. Use your university account, " +
                    "or ask an administrator to add you."
            } else {
                "Only @$domain email addresses can sign in. Use your university account, " +
                    "or ask an administrator to add you."
            }
        "no_email" ->
            "Your Google account did not share an email address, which this app needs to " +
                "identify you. Grant the email permission and try again."
        "session" ->
            "Signed in with Google, but the session could not be created. Please try again."
        else -> "Sign-in failed. Please try again."
    }
    return OAuthReturn.Failure(message)
}

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
