package lk.ac.pdn.eng.attendance.ui.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import lk.ac.pdn.eng.attendance.R
import lk.ac.pdn.eng.attendance.ui.components.AppCard
import lk.ac.pdn.eng.attendance.ui.components.AppFooter
import lk.ac.pdn.eng.attendance.ui.components.AppTextField
import lk.ac.pdn.eng.attendance.ui.components.ErrorBanner
import lk.ac.pdn.eng.attendance.ui.components.PrimaryButton
import lk.ac.pdn.eng.attendance.ui.theme.Palette

@Composable
fun LoginScreen(
    baseUrl: String,
    authBusy: Boolean,
    authError: String?,
    onSaveBaseUrl: (String) -> Unit,
    onContinue: () -> Unit,
) {
    val context = LocalContext.current
    var showSettings by remember { mutableStateOf(false) }
    var urlField by remember { mutableStateOf(baseUrl) }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Spacer(Modifier.weight(1f))
            AppCard(modifier = Modifier.fillMaxWidth().widthIn(max = 460.dp)) {
                Column {
                    // Hero with brand lockup
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(140.dp)
                            .background(
                                Brush.linearGradient(
                                    listOf(Color(0xFFFFF9EB), Color(0xFFF3EFFF), Color(0xFFE8E4FF)),
                                ),
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Image(
                            painter = painterResource(R.drawable.brand_lockup),
                            contentDescription = "University of Peradeniya",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxWidth(0.7f).height(72.dp),
                        )
                    }

                    Column(Modifier.padding(horizontal = 22.dp, vertical = 22.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Image(
                                painter = painterResource(R.drawable.uop_logo),
                                contentDescription = null,
                                modifier = Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)),
                            )
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text("Sign in", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Palette.Ink)
                                Text(
                                    "Attendance Management System",
                                    color = Palette.Muted,
                                    fontSize = 13.sp,
                                )
                            }
                        }
                        Spacer(Modifier.height(18.dp))
                        Text(
                            if (authBusy) "Signing you in…" else "Continue with Google",
                            style = MaterialTheme.typography.titleMedium,
                            color = Palette.Ink,
                        )
                        Text(
                            if (authBusy) "Completing Google authentication."
                            else "Use your university Google account.",
                            color = Palette.Muted,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(top = 4.dp),
                        )

                        if (authError != null) {
                            Spacer(Modifier.height(14.dp))
                            ErrorBanner(authError)
                        }

                        Spacer(Modifier.height(16.dp))
                        PrimaryButton(
                            text = "Continue with Google",
                            onClick = {
                                onSaveBaseUrl(urlField)
                                OAuth.launch(context, urlField)
                            },
                            loading = authBusy,
                            enabled = !authBusy,
                        )

                        Spacer(Modifier.height(10.dp))
                        Text(
                            if (showSettings) "Hide server settings" else "Server settings",
                            color = Palette.AccentDark,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier
                                .clickable { showSettings = !showSettings }
                                .padding(vertical = 6.dp),
                        )
                        if (showSettings) {
                            AppTextField(
                                value = urlField,
                                onValueChange = { urlField = it },
                                label = "Server base URL",
                                placeholder = "https://attendance.eng.pdn.ac.lk",
                            )
                            Text(
                                "Must match the server's APP_BASE_URL so the Google sign-in can return to the app.",
                                color = Palette.Muted,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(top = 6.dp),
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            AppFooter(Modifier.padding(top = 16.dp))
        }
    }
}
