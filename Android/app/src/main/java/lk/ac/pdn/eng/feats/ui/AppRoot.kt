package lk.ac.pdn.eng.feats.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import lk.ac.pdn.eng.feats.BuildConfig
import lk.ac.pdn.eng.feats.ui.auth.LoginScreen
import lk.ac.pdn.eng.feats.ui.auth.MainViewModel
import lk.ac.pdn.eng.feats.ui.auth.SessionState
import lk.ac.pdn.eng.feats.ui.components.LoadingGate
import lk.ac.pdn.eng.feats.ui.components.UpdateRequiredScreen
import lk.ac.pdn.eng.feats.ui.staff.AttendanceMatrixScreen
import lk.ac.pdn.eng.feats.ui.staff.StaffDashboardScreen
import lk.ac.pdn.eng.feats.ui.student.LectureEntryScreen

@Composable
fun AppRoot(
    oauthCode: String?,
    onCodeConsumed: () -> Unit,
    mainVm: MainViewModel = viewModel(),
) {
    val session by mainVm.session.collectAsState()
    val authBusy by mainVm.authBusy.collectAsState()
    val authError by mainVm.authError.collectAsState()
    val updateRequired by mainVm.updateRequired.collectAsState()

    LaunchedEffect(oauthCode) {
        if (oauthCode != null) {
            mainVm.onOAuthCode(oauthCode)
            onCodeConsumed()
        }
    }

    if (updateRequired) {
        val context = LocalContext.current
        UpdateRequiredScreen(
            onUpdate = {
                val marketUri = Uri.parse("market://details?id=${BuildConfig.APPLICATION_ID}")
                try {
                    context.startActivity(Intent(Intent.ACTION_VIEW, marketUri))
                } catch (e: ActivityNotFoundException) {
                    val webUri = Uri.parse("https://play.google.com/store/apps/details?id=${BuildConfig.APPLICATION_ID}")
                    context.startActivity(Intent(Intent.ACTION_VIEW, webUri))
                }
            },
        )
        return
    }

    when (val s = session) {
        is SessionState.Loading -> {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingGate() }
        }

        is SessionState.LoggedOut -> {
            LoginScreen(
                authBusy = authBusy,
                authError = authError,
                onGoogleSignIn = mainVm::signInWithGoogle,
            )
        }

        is SessionState.LoggedIn -> {
            if (s.user.isStaff) {
                StaffNav(email = s.user.email, onLogout = mainVm::logout)
            } else {
                LectureEntryScreen(email = s.user.email, onLogout = mainVm::logout)
            }
        }
    }
}

@Composable
private fun StaffNav(email: String, onLogout: () -> Unit) {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = "dashboard") {
        composable("dashboard") {
            StaffDashboardScreen(
                email = email,
                onLogout = onLogout,
                onOpenMatrix = { courseId -> nav.navigate("matrix/$courseId") },
            )
        }
        composable("matrix/{courseId}") { entry ->
            val courseId = entry.arguments?.getString("courseId").orEmpty()
            AttendanceMatrixScreen(courseId = courseId, onBack = { nav.popBackStack() })
        }
    }
}
