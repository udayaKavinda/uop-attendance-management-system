package lk.ac.pdn.eng.feats

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.ui.Modifier
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import lk.ac.pdn.eng.feats.ui.AppRoot
import lk.ac.pdn.eng.feats.ui.auth.OAuth
import lk.ac.pdn.eng.feats.ui.components.AppBackground
import lk.ac.pdn.eng.feats.ui.theme.AttendanceTheme

class MainActivity : ComponentActivity() {

    private var oauthCode by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        oauthCode = extractCode(intent)

        setContent {
            AttendanceTheme {
                AppBackground {
                    Box(Modifier.fillMaxSize().systemBarsPadding()) {
                        AppRoot(
                            oauthCode = oauthCode,
                            onCodeConsumed = { oauthCode = null },
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        extractCode(intent)?.let { oauthCode = it }
    }

    /** Pulls the OAuth exchange `code` out of the deep link lk.ac.pdn.eng.attendance://oauth?code=... */
    private fun extractCode(intent: Intent?): String? {
        val data: Uri = intent?.data ?: return null
        val expected = Uri.parse(OAuth.RETURN_TARGET)
        if (data.scheme == expected.scheme && data.host == expected.host) {
            return data.getQueryParameter("code")
        }
        return null
    }
}
