package lk.ac.pdn.eng.feats.ui.student

import android.bluetooth.BluetoothAdapter
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import lk.ac.pdn.eng.feats.ble.BlePermissions
import lk.ac.pdn.eng.feats.data.net.RunningCourseDto
import lk.ac.pdn.eng.feats.ui.components.AppCard
import lk.ac.pdn.eng.feats.ui.components.AppFooter
import lk.ac.pdn.eng.feats.ui.components.AppTextField
import lk.ac.pdn.eng.feats.ui.components.ButtonVariant
import lk.ac.pdn.eng.feats.ui.components.EmptyState
import lk.ac.pdn.eng.feats.ui.components.ErrorBanner
import lk.ac.pdn.eng.feats.ui.components.PrimaryButton
import lk.ac.pdn.eng.feats.ui.theme.AppShapes
import lk.ac.pdn.eng.feats.ui.theme.Palette

/**
 * One screen, one job: get this student marked present.
 *
 * The layout follows the attempt rather than the menu — pick a course, press one
 * button, watch a single progress ring, and land on exactly one of three
 * outcomes. The lecturer's code is deliberately not on the first screen: it only
 * appears once the automatic attempt has actually failed.
 */
@Composable
fun LectureEntryScreen(
    email: String,
    onLogout: () -> Unit,
    // Keyed on email: this screen is composed directly from AppRoot's login branch,
    // not as a NavHost destination, so without a key a device that signs out and a
    // different account signs back in (same process) would keep the PREVIOUS
    // student's ViewModel — stale outcome and all — and the new student could land
    // straight on "You're marked present" without having done anything.
    vm: LectureEntryViewModel = viewModel(key = email),
) {
    // Reached via the "Register for courses" link, not as a NavHost destination —
    // this screen is itself composed directly from AppRoot's login branch.
    var showRegistration by remember { mutableStateOf(false) }
    if (showRegistration) {
        CourseRegistrationScreen(onBack = { showRegistration = false; vm.refreshRegistered() })
        return
    }

    val state by vm.state.collectAsState()
    val context = LocalContext.current

    // A screen timeout would silently stop BLE scan callbacks and surface as a
    // false "no signal", so hold the display on for the duration of the window.
    val view = LocalView.current
    DisposableEffect(state.running) {
        view.keepScreenOn = state.running
        onDispose { view.keepScreenOn = false }
    }

    val coroutineScope = rememberCoroutineScope()

    // `begin` and the two launchers below refer to each other (a launcher result
    // re-runs `begin`, which may launch either one), so the initial reference is
    // a lateinit var, assigned once every dependency exists.
    lateinit var begin: () -> Unit

    // Turning the radio on is asynchronous — this callback can fire slightly
    // before `adapter.isEnabled` actually flips, which would otherwise waste the
    // whole attempt on GPS alone even though the student just said yes. Give it
    // up to 1.5s to catch up before starting the window either way.
    val enableBtLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) {
        coroutineScope.launch {
            var waited = 0
            while (waited < 15 && !BlePermissions.isBluetoothOn(context)) {
                delay(100)
                waited++
            }
            vm.startCheckIn()
        }
    }

    // Asked once, up front. Any subset can be denied: the window runs with
    // whatever is left, and falls through to the lecturer's code if nothing is.
    // Re-runs begin() rather than starting directly, so a Bluetooth-off prompt
    // still fires if that's the very next thing blocking the attempt.
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { begin() }

    begin = {
        val needed = LectureEntryViewModel.requiredPermissions()
        if (!BlePermissions.hasAll(context, needed)) {
            permissionLauncher.launch(needed)
        } else {
            // Bluetooth being off is worth one tap to fix; everything else just
            // degrades to GPS rather than blocking the attempt.
            val blocker = BlePermissions.scanBlocker(context)
            if (blocker != null && blocker.contains("turned off", ignoreCase = true)) {
                enableBtLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
            } else {
                vm.startCheckIn()
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        StudentTopBar(email = email, onLogout = onLogout)
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f))
            AppCard(Modifier.fillMaxWidth().widthIn(max = 480.dp)) {
                Column(Modifier.padding(22.dp)) {
                    when {
                        state.outcome == Outcome.Present -> OutcomePresent(vm)
                        state.outcome == Outcome.Flagged -> OutcomeFlagged(vm)
                        state.courses.isEmpty() -> {
                            NoLecturesRunning(state.error)
                            Spacer(Modifier.height(4.dp))
                            RegisterCoursesLink(onClick = { showRegistration = true })
                        }
                        else -> {
                            CheckInBody(state, vm, begin)
                            Spacer(Modifier.height(4.dp))
                            RegisterCoursesLink(onClick = { showRegistration = true })
                        }
                    }
                }
            }
            Spacer(Modifier.weight(1f))
        }
        AppFooter()
    }

    if (state.helpDialogOpen) {
        HelpCodeDialog(
            submitting = state.helpSubmitting,
            error = state.helpError,
            onDismiss = vm::dismissHelp,
            onSubmit = vm::submitHelpCode,
        )
    }
}

// ── Main flow ────────────────────────────────────────────────────────────────

@Composable
private fun CheckInBody(
    state: CheckInState,
    vm: LectureEntryViewModel,
    onBegin: () -> Unit,
) {
    Text("Mark your attendance", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
    Text(
        "Choose your lecture and hold still for a moment while we confirm you're in the lecture room.",
        color = Palette.Muted,
        fontSize = 13.sp,
        modifier = Modifier.padding(top = 4.dp),
    )

    state.error?.let {
        Spacer(Modifier.height(14.dp))
        ErrorBanner(it)
    }

    Spacer(Modifier.height(18.dp))

    CourseSearchDropdown(
        courses = state.courses,
        selectedId = state.selectedCourseId,
        enabled = !state.busy,
        registeredIds = state.registeredIds,
        onSelect = vm::selectCourse,
    )

    Spacer(Modifier.height(10.dp))

    when {
        state.running -> RunningPanel(state, vm)
        state.needsHelp -> NeedsHelpPanel(vm, onBegin)
        else -> PrimaryButton(
            text = "Check me in",
            onClick = onBegin,
            variant = ButtonVariant.Bluetooth,
            enabled = state.selectedCourseId != null && !state.busy,
        )
    }
}

/** The single progress surface for the whole 90-second window. */
@Composable
private fun RunningPanel(state: CheckInState, vm: LectureEntryViewModel) {
    val elapsed = LectureEntryViewModel.WINDOW_SECONDS - state.secondsLeft
    val progress = elapsed.coerceIn(0, LectureEntryViewModel.WINDOW_SECONDS).toFloat() /
        LectureEntryViewModel.WINDOW_SECONDS

    Column(
        Modifier
            .fillMaxWidth()
            .clip(AppShapes.Panel)
            .background(Palette.BtBadgeBg)
            .border(1.dp, Palette.BtBadgeBorder, AppShapes.Panel)
            .padding(18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        PulsingDot()
        Spacer(Modifier.height(12.dp))
        Text(
            if (state.phase == CheckInPhase.Preparing) "Getting ready…" else "Confirming you're in the lecture room",
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = Palette.BtDeep,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            "Stay where you are. This takes up to ${LectureEntryViewModel.WINDOW_SECONDS} seconds.",
            color = Palette.BtDeep.copy(alpha = 0.75f),
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(14.dp))
        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier.fillMaxWidth().height(6.dp).clip(AppShapes.Pill),
            color = Palette.BtMid,
            trackColor = Color.White,
        )
        Spacer(Modifier.height(8.dp))
        Text("${state.secondsLeft}s remaining", color = Palette.BtDeep, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = vm::cancelCheckIn) {
            Text("Cancel", color = Palette.Muted, fontSize = 13.sp)
        }
    }
}

/**
 * Shown only after a full window failed. Two ways forward and no explanation of
 * *why* it failed — the app genuinely does not know, and guessing out loud would
 * tell a cheat how far off they are.
 */
@Composable
private fun NeedsHelpPanel(vm: LectureEntryViewModel, onBegin: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(AppShapes.Panel)
            .background(Palette.WarnBg)
            .padding(18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("🤔", fontSize = 28.sp)
        Spacer(Modifier.height(8.dp))
        Text(
            "We couldn't confirm you're in the lecture",
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = Palette.WarnText,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Try once more, or ask your lecturer for the attendance code.",
            color = Palette.WarnText.copy(alpha = 0.85f),
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        PrimaryButton(
            text = "Try again",
            onClick = { vm.tryAgain(); onBegin() },
            variant = ButtonVariant.Bluetooth,
        )
        Spacer(Modifier.height(10.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .clip(AppShapes.Pill)
                .background(Color.White)
                .clickable(onClick = vm::openHelp)
                .padding(vertical = 13.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text("Get help", color = Palette.WarnText, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        }
    }
}

/** The lecturer's code — the only place it is ever asked for. */
@Composable
private fun HelpCodeDialog(
    submitting: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit,
) {
    var code by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        title = { Text("Attendance code", fontWeight = FontWeight.ExtraBold) },
        text = {
            Column {
                Text(
                    "Ask your lecturer to read out the 8-digit code for this lecture, then enter it below.",
                    color = Palette.Muted,
                    fontSize = 13.sp,
                )
                Spacer(Modifier.height(14.dp))
                AppTextField(
                    value = code,
                    onValueChange = { new -> if (new.length <= 8 && new.all(Char::isDigit)) code = new },
                    label = "Code",
                    placeholder = "8 digits",
                    keyboardType = KeyboardType.Number,
                )
                error?.let {
                    Spacer(Modifier.height(10.dp))
                    ErrorBanner(it)
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSubmit(code) },
                enabled = code.length == 8 && !submitting,
            ) {
                if (submitting) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Palette.Accent)
                    Spacer(Modifier.width(8.dp))
                }
                Text("Submit", fontWeight = FontWeight.Bold, color = Palette.AccentDark)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !submitting) {
                Text("Cancel", color = Palette.Muted)
            }
        },
        containerColor = Palette.Card,
    )
}

// ── Terminal states ──────────────────────────────────────────────────────────

@Composable
private fun OutcomePresent(vm: LectureEntryViewModel) {
    OutcomeCard(
        emoji = "✅",
        title = "You're marked present",
        body = "Your attendance for this lecture is recorded.",
        bg = Palette.SuccessBg,
        ink = Palette.SuccessText,
        vm = vm,
    )
}

@Composable
private fun OutcomeFlagged(vm: LectureEntryViewModel) {
    OutcomeCard(
        emoji = "🕓",
        title = "Under review",
        body = "We couldn't verify that you were present in the lecture room. Your attendance is now pending review by the lecturer.",
        bg = Palette.WarnBg,
        ink = Palette.WarnText,
        vm = vm,
    )
}

@Composable
private fun OutcomeCard(
    emoji: String,
    title: String,
    body: String,
    bg: Color,
    ink: Color,
    vm: LectureEntryViewModel,
) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(72.dp).clip(RoundedCornerShape(24.dp)).background(bg),
            contentAlignment = Alignment.Center,
        ) { Text(emoji, fontSize = 32.sp) }
        Spacer(Modifier.height(16.dp))
        Text(title, fontWeight = FontWeight.ExtraBold, fontSize = 19.sp, color = Palette.Ink, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(body, color = ink, fontSize = 13.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(22.dp))
        PrimaryButton(text = "Mark another lecture", onClick = vm::markAnotherCourse)
    }
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/**
 * Search-as-you-type picker over currently-running sessions only — the campus-wide
 * list has no enrolment filter, so this keeps it usable when many courses are live
 * at once instead of scrolling a plain list.
 */
@Composable
private fun CourseSearchDropdown(
    courses: List<RunningCourseDto>,
    selectedId: String?,
    enabled: Boolean,
    registeredIds: Set<String>,
    onSelect: (String?) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val selected = courses.firstOrNull { it.id == selectedId }

    if (selected != null) {
        CourseRow(
            course = selected,
            selected = true,
            enabled = enabled,
            onClick = { onSelect(null); query = "" },
        )
        return
    }

    AppTextField(
        query,
        { query = it },
        "Search your course",
        placeholder = "Course code or name…",
        enabled = enabled,
    )

    // At rest (no query), pin courses the student registered ahead of time so
    // they never have to type to find their own lecture. The moment they type
    // anything this drops back to a true dropdown: nothing shows until the
    // student actually searches, rather than dumping the whole running-courses
    // list under the field.
    if (query.isBlank()) {
        val pinned = courses.filter { registeredIds.contains(it.id) }
        if (pinned.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            pinned.forEach { course ->
                CourseRow(
                    course = course,
                    selected = false,
                    enabled = enabled,
                    registered = true,
                    onClick = { onSelect(course.id); query = "" },
                )
                Spacer(Modifier.height(8.dp))
            }
        }
    } else {
        val matches = courses.filter { "${it.code} ${it.name} ${it.batch}".contains(query, ignoreCase = true) }
        Spacer(Modifier.height(8.dp))
        if (matches.isEmpty()) {
            Text(
                "No running lecture matches \"$query\".",
                color = Palette.Muted,
                fontSize = 12.sp,
            )
        } else {
            matches.take(20).forEach { course ->
                CourseRow(
                    course = course,
                    selected = false,
                    enabled = enabled,
                    onClick = { onSelect(course.id); query = "" },
                )
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun RegisterCoursesLink(onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Text(
            "Register for courses",
            color = Palette.BtMid,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            textDecoration = TextDecoration.Underline,
            modifier = Modifier.clickable(onClick = onClick).padding(4.dp),
        )
    }
}

@Composable
private fun CourseRow(
    course: RunningCourseDto,
    selected: Boolean,
    enabled: Boolean,
    registered: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(AppShapes.Panel)
            .background(if (selected) Palette.ChipBg else Palette.InactiveBg)
            .border(
                width = if (selected) 2.dp else 1.dp,
                color = if (selected) Palette.Accent else Palette.Border,
                shape = AppShapes.Panel,
            )
            .clickable(enabled = enabled, onClick = onClick)
            .padding(14.dp)
            .alpha(if (enabled) 1f else 0.6f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(course.code, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, color = Palette.Ink)
                if (registered) {
                    Spacer(Modifier.width(6.dp))
                    Box(
                        Modifier
                            .clip(AppShapes.Pill)
                            .background(Palette.ChipBg)
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                    ) {
                        Text("Registered", color = Palette.AccentDark, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Text(course.name, color = Palette.Muted, fontSize = 12.sp)
            Text(course.batch, color = Palette.Muted, fontSize = 11.sp)
        }
        Box(
            Modifier
                .size(22.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(if (selected) Palette.Accent else Color.Transparent)
                .border(
                    width = if (selected) 0.dp else 2.dp,
                    color = Palette.InputBorder,
                    shape = RoundedCornerShape(11.dp),
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) Text("✓", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun NoLecturesRunning(error: String?) {
    Column {
        error?.let {
            ErrorBanner(it)
            Spacer(Modifier.height(12.dp))
        }
        EmptyState(
            icon = "📅",
            title = "No lectures running right now",
            text = "When one of your sessions starts it appears here automatically. This list refreshes every 10 seconds.",
        )
    }
}

/** Signals "we're listening" without implying which radio is doing the work. */
@Composable
private fun PulsingDot() {
    val transition = rememberInfiniteTransition(label = "pulse")
    val scale by transition.animateFloat(
        initialValue = 0.55f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(900, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulseAlpha",
    )
    Box(
        Modifier.size(54.dp).clip(RoundedCornerShape(27.dp)).background(Color.White.copy(alpha = 0.7f)),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(34.dp)
                .alpha(scale)
                .clip(RoundedCornerShape(17.dp))
                .background(
                    Brush.horizontalGradient(listOf(Palette.BtDeep, Palette.BtLight)),
                ),
        )
    }
}

@Composable
private fun StudentTopBar(email: String, onLogout: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Palette.Card.copy(alpha = 0.92f))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(40.dp)
                .background(Palette.ChipBg, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) { Text("🎓", fontSize = 18.sp) }
        Spacer(Modifier.size(10.dp))
        Column(Modifier.weight(1f)) {
            Text("Attendance", fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, color = Palette.Ink)
            Text(
                email.substringBefore('@').ifEmpty { "University of Peradeniya" },
                color = Palette.AccentDark,
                fontSize = 12.sp,
            )
        }
        Text(
            "Sign out",
            color = Palette.Muted,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clickable(onClick = onLogout).padding(8.dp),
        )
    }
}
