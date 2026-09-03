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
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
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
 * [GetGoogleIdOption] with filtering and auto-select both off always shows the
 * account chooser, matching the previous flow's `prompt=select_account` behaviour.
 * See signIn() for why it is this option type and not GetSignInWithGoogleOption.
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

        // GetGoogleIdOption, NOT GetSignInWithGoogleOption. The two look
        // interchangeable but run through different Play services components, and
        // the difference is what made sign-in fail intermittently on this app:
        //
        // GetSignInWithGoogleOption (the "Sign in with Google button" flow) routes
        // through GMS's *assisted sign-in* path. Captured on-device, that path
        // launched com.google.android.gms.auth.api.credentials.assistedsignin.ui
        // .GoogleSignInActivity — an interactive account re-verification screen —
        // on top of the account picker, then tore it back down 954ms later via
        // Dialog.dismissDialog with no user input, and the whole request came back
        // as "[16] Account reauth failed" wrapped in a *cancellation* exception.
        // Sign-in succeeded only when that screen happened not to appear.
        //
        // GetGoogleIdOption returns the ID token from the picker directly without
        // that re-verification step, so there is no interactive screen to race.
        // filterByAuthorizedAccounts=false + autoSelectEnabled=false keeps the
        // "always show the chooser" behaviour the assisted flow was chosen for.
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
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
            // Play Services wraps a genuine user dismissal AND real, recoverable
            // failures in this exact same exception type. Confirmed on-device: one
            // occurrence carried "[16] Account reauth failed." — a real background
            // failure, not a dismissal — and a later occurrence carried a message
            // that didn't match that specific text, so a keyword check for "reauth"
            // alone isn't reliable; Play Services doesn't use one fixed string here.
            //
            // What's actually distinguishing is presence of a message at all: a
            // genuine tap-outside-the-sheet dismissal carries no explanation (null
            // or blank message), while every wrapped failure we've observed carries
            // one. So: blank message = real dismissal, stay silent; any message =
            // something actually went wrong, and the user gets told so they can
            // reach for the browser link rather than face a button that did nothing.
            if (e.message.isNullOrBlank()) {
                GoogleSignInResult.Cancelled
            } else {
                GoogleSignInResult.Unavailable(
                    "Google sign-in couldn't complete on this device. "
                        + "Try again, or use \"Sign in with your browser\" below.",
                )
            }
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
