package lk.ac.pdn.eng.feats.ui.auth

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import lk.ac.pdn.eng.feats.BuildConfig

/** Outcome of the native Google sign-in sheet. */
sealed interface GoogleSignInResult {
    /** Google returned a signed ID token; POST it to `/api/auth/google-id-token`. */
    data class Success(val idToken: String) : GoogleSignInResult

    /** User dismissed the sheet — not an error, show nothing. */
    data object Cancelled : GoogleSignInResult

    /**
     * Credential Manager cannot serve this device (no Google account signed in,
     * no/outdated Play services, provider disabled). The caller should offer the
     * Custom Tab browser flow instead — never leave the user with no way in.
     */
    data class Unavailable(val message: String) : GoogleSignInResult

    data class Failure(val message: String) : GoogleSignInResult
}

/**
 * Native "Sign in with Google" via Credential Manager — the current Google-recommended
 * API used by the native sign-in flow.
 *
 * The account picker is drawn by the system as a bottom sheet; no browser is involved.
 * Google returns a short-lived **ID token** (a JWT) which the server verifies against
 * the same Web client id. The server then sets the ordinary `attendance.sid` session
 * cookie, so everything downstream of sign-in is unchanged.
 *
 * [GetSignInWithGoogleOption] always shows the account chooser, matching the previous
 * flow's `prompt=select_account` behaviour.
 */
object GoogleAuth {

    /** False when GOOGLE_WEB_CLIENT_ID was not supplied at build time. */
    val isConfigured: Boolean
        get() = BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()

    /**
     * Shows the Google account sheet and returns the ID token.
     *
     * @param activity an Activity context — Credential Manager needs it to host the sheet.
     * @param nonce single-use value from `GET /api/auth/google-nonce`; Google embeds it
     *   in the token and the server verifies it, so a captured token cannot be replayed.
     */
    suspend fun signIn(activity: Activity, nonce: String): GoogleSignInResult {
        if (!isConfigured) {
            return GoogleSignInResult.Unavailable(
                "Google sign-in is not configured in this build (missing GOOGLE_WEB_CLIENT_ID).",
            )
        }

        val option = GetSignInWithGoogleOption
            .Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setNonce(nonce)
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build()

        return try {
            val response = CredentialManager.create(activity).getCredential(activity, request)
            val credential = response.credential

            if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
                if (idToken.isBlank()) {
                    GoogleSignInResult.Failure("Google did not return a sign-in token.")
                } else {
                    GoogleSignInResult.Success(idToken)
                }
            } else {
                GoogleSignInResult.Failure("Unexpected credential type returned by Google.")
            }
        } catch (e: GetCredentialCancellationException) {
            GoogleSignInResult.Cancelled
        } catch (e: NoCredentialException) {
            GoogleSignInResult.Unavailable(
                "No Google account is available on this device. Add one in Settings, or sign in with the browser.",
            )
        } catch (e: GetCredentialException) {
            // Covers provider-configuration and Play-services problems.
            GoogleSignInResult.Unavailable(
                e.message ?: "Google sign-in is unavailable on this device.",
            )
        } catch (e: Exception) {
            GoogleSignInResult.Failure(e.message ?: "Google sign-in failed.")
        }
    }

    /**
     * Clears Credential Manager's cached selection on logout so the next sign-in
     * shows the account chooser instead of silently reusing the last account.
     * Best-effort: never fails the logout.
     */
    suspend fun clearCredentialState(context: Context) {
        runCatching {
            CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest())
        }
    }
}

/** Unwraps the Activity behind a Compose [Context] (needed to host the credential sheet). */
fun Context.findActivity(): Activity? {
    var current: Context = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}
