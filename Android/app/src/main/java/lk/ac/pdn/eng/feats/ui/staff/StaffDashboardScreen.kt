package lk.ac.pdn.eng.feats.ui.staff

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import androidx.lifecycle.viewmodel.compose.viewModel
import lk.ac.pdn.eng.feats.ble.BatteryGuard
import lk.ac.pdn.eng.feats.ble.BlePermissions
import lk.ac.pdn.eng.feats.ble.BroadcastService
import lk.ac.pdn.eng.feats.ble.BroadcastState
import androidx.compose.material3.Switch
import lk.ac.pdn.eng.feats.data.net.CourseDto
import lk.ac.pdn.eng.feats.data.net.LecturerDto
import lk.ac.pdn.eng.feats.data.net.ManualCodeStatusDto
import lk.ac.pdn.eng.feats.data.net.StaffSessionDto
import lk.ac.pdn.eng.feats.ui.components.AppCard
import lk.ac.pdn.eng.feats.ui.components.AppTextField
import lk.ac.pdn.eng.feats.ui.components.DeviceBadge
import lk.ac.pdn.eng.feats.ui.components.EmptyState
import lk.ac.pdn.eng.feats.ui.components.ErrorBanner
import lk.ac.pdn.eng.feats.ui.components.PillButton
import lk.ac.pdn.eng.feats.ui.components.PillTone
import lk.ac.pdn.eng.feats.ui.components.PrimaryButton
import lk.ac.pdn.eng.feats.ui.components.StatusBadge
import lk.ac.pdn.eng.feats.ui.theme.AppShapes
import lk.ac.pdn.eng.feats.ui.theme.Palette

private val DAYS = listOf("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")

@Composable
fun StaffDashboardScreen(
    email: String,
    onLogout: () -> Unit,
    onOpenMatrix: (String) -> Unit,
    vm: StaffViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()
    var tab by remember { mutableIntStateOf(0) }

    val tabs = buildList {
        add("Courses"); add("Create session"); add("Sessions")
        if (state.isAdmin) { add("Lecturers"); add("Geofences") }
    }

    LaunchedEffect(state.flash) {
        if (state.flash != null) {
            kotlinx.coroutines.delay(2500)
            vm.clearFlash()
        }
    }

    Column(Modifier.fillMaxSize()) {
        StaffTopBar(role = state.role, email = email, onLogout = onLogout)

        ScrollableTabRow(
            selectedTabIndex = tab,
            containerColor = Palette.Card.copy(alpha = 0.92f),
            contentColor = Palette.AccentDark,
            edgePadding = 12.dp,
        ) {
            tabs.forEachIndexed { i, title ->
                Tab(
                    selected = tab == i,
                    onClick = { tab = i },
                    text = { Text(title, fontWeight = if (tab == i) FontWeight.Bold else FontWeight.Medium) },
                )
            }
        }

        Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)) {
            state.flash?.let {
                Box(
                    Modifier.fillMaxWidth().clickable { vm.clearFlash() }
                        .background(Palette.SuccessBg, AppShapes.Panel)
                        .padding(12.dp),
                ) { Text(it, color = Palette.SuccessText, fontWeight = FontWeight.SemiBold, fontSize = 14.sp) }
                Spacer(Modifier.height(8.dp))
            }
            state.error?.let {
                ErrorBanner(it, Modifier.clickable { vm.clearError() })
                Spacer(Modifier.height(8.dp))
            }
        }

        when (tabs.getOrNull(tab)) {
            "Courses" -> CoursesTab(state, vm, onOpenMatrix)
            "Create session" -> CreateSessionTab(state, vm)
            "Sessions" -> SessionsTab(state, vm)
            "Lecturers" -> LecturersTab(state, vm)
            "Geofences" -> GeofencesTab(state, vm)
        }
    }
}

// ── Courses tab ───────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CoursesTab(state: StaffState, vm: StaffViewModel, onOpenMatrix: (String) -> Unit) {
    var code by remember { mutableStateOf("") }
    var batch by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var filterQuery by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf<CourseDto?>(null) }
    var ownersFor by remember { mutableStateOf<CourseDto?>(null) }

    val visibleCourses = if (state.isAdmin) state.filteredCourses() else state.courses
    val canAddCourse = !state.isAdmin || state.selectedLecturerFilter != null

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp),
    ) {
        if (state.isAdmin) {
            item {
                AppCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        SectionHeader(Icons.Outlined.Person, "Lecturer")
                        Spacer(Modifier.height(8.dp))
                        if (state.selectedLecturerFilter != null) {
                            SelectedLecturerChip(
                                lecturer = state.selectedLecturerFilter!!,
                                onClear = {
                                    vm.setLecturerFilter(null)
                                    filterQuery = ""
                                },
                            )
                        } else {
                            LecturerSearchField(
                                query = filterQuery,
                                onQueryChange = {
                                    filterQuery = it
                                    vm.searchLecturers(it)
                                },
                                results = state.lecturerSearchResults,
                                loading = state.lecturerSearchLoading,
                                onSelect = { lect ->
                                    vm.setLecturerFilter(lect)
                                    filterQuery = ""
                                },
                                placeholder = "Search by name or email…",
                            )
                            Text(
                                "Select a lecturer to view their courses and create new ones.",
                                color = Palette.Muted,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(top = 6.dp),
                            )
                        }
                    }
                }
            }
        }

        item {
            AppCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    SectionHeader(Icons.Outlined.School, "Add course")
                    Spacer(Modifier.height(10.dp))
                    AppTextField(code, { code = it }, "Course code", placeholder = "CS101")
                    Spacer(Modifier.height(8.dp))
                    AppTextField(batch, { batch = it }, "Batch", placeholder = "2024")
                    Spacer(Modifier.height(8.dp))
                    AppTextField(name, { name = it }, "Course name", placeholder = "Intro to Computing")
                    if (state.isAdmin && !canAddCourse) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Select a lecturer above to create a course for them.",
                            color = Palette.WarnText,
                            fontSize = 12.sp,
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    PrimaryButton(
                        text = "Add course",
                        onClick = {
                            vm.createCourse(code, batch, name)
                            code = ""; batch = ""; name = ""
                        },
                        enabled = canAddCourse,
                    )
                }
            }
        }

        if (visibleCourses.isEmpty()) {
            item {
                val msg = if (state.isAdmin && state.selectedLecturerFilter != null) {
                    "This lecturer has no courses yet. Add one above."
                } else if (state.isAdmin) {
                    "Select a lecturer to see their courses, or add a course after selecting one."
                } else {
                    "Add a course above to get started."
                }
                EmptyState("📚", "No courses", msg)
            }
        } else {
            items(visibleCourses, key = { it.id ?: it.hashCode().toString() }) { course ->
                CourseCard(
                    course = course,
                    isAdmin = state.isAdmin,
                    onOpen = { course.id?.let(onOpenMatrix) },
                    onEnableDisable = {
                        course.id?.let { if (course.active == false) vm.enableCourse(it) else vm.disableCourse(it) }
                    },
                    onDelete = { confirmDelete = course },
                    onOwners = { ownersFor = course },
                )
            }
        }
    }

    confirmDelete?.let { course ->
        ConfirmDialog(
            title = "Delete course?",
            message = "Delete ${course.code} (${course.batch}) and all its sessions? This cannot be undone.",
            confirmLabel = "Delete",
            onConfirm = { course.id?.let(vm::deleteCourse); confirmDelete = null },
            onDismiss = { confirmDelete = null },
        )
    }

    ownersFor?.let { course ->
        OwnersDialog(
            course = course,
            vm = vm,
            onSave = { ids -> course.id?.let { vm.assignLecturers(it, ids) }; ownersFor = null },
            onDismiss = { ownersFor = null },
        )
    }
}

@Composable
private fun CourseCard(
    course: CourseDto,
    isAdmin: Boolean,
    onOpen: () -> Unit,
    onEnableDisable: () -> Unit,
    onDelete: () -> Unit,
    onOwners: () -> Unit,
) {
    val disabled = course.active == false
    AppCard(
        Modifier.fillMaxWidth(),
        shape = AppShapes.Panel,
        border = if (disabled) Palette.Border else Palette.EnabledBorder,
    ) {
        Column(Modifier.padding(14.dp)) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onOpen)
                    .padding(bottom = 10.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "${course.code ?: ""}  ·  ${course.batch ?: ""}",
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 15.sp,
                        modifier = Modifier.weight(1f),
                    )
                    if (disabled) StatusBadge("Disabled", PillTone.Warning)
                }
                Text(course.name ?: "", color = Palette.Muted, fontSize = 14.sp)
                val owners = course.lecturers?.mapNotNull { it.name ?: it.email }?.joinToString(", ").orEmpty()
                if (owners.isNotEmpty()) {
                    Text("Owners: $owners", color = Palette.Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                }
            }
            HorizontalDivider(color = Palette.Border)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (isAdmin) {
                    PillButton("Owners", onClick = onOwners, tone = PillTone.Accent)
                }
                PillButton(
                    if (disabled) "Enable" else "Disable",
                    onClick = onEnableDisable,
                    tone = if (disabled) PillTone.Success else PillTone.Warning,
                )
                PillButton("Delete", onClick = onDelete, tone = PillTone.Danger)
            }
        }
    }
}

// ── Create session tab ────────────────────────────────────────────────────────────

private val VERIFICATION_LABELS = mapOf(
    "bluetooth" to "Bluetooth",
    "geofence" to "GPS geofence",
    "both" to "Bluetooth or GPS",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateSessionTab(state: StaffState, vm: StaffViewModel) {
    val activeCourses = state.courses.filter { it.active != false }
    var courseId by remember { mutableStateOf<String?>(null) }
    var day by remember { mutableStateOf("MON") }
    var start by remember { mutableStateOf("") }
    var end by remember { mutableStateOf("") }
    var recurring by remember { mutableStateOf(true) }
    var showTimePicker by remember { mutableStateOf(false) }
    var pickingStart by remember { mutableStateOf(true) }

    // The global policy constrains which modes may be picked at all; while it's
    // still loading, fall back to the safe default (Bluetooth only, unchanged UX).
    val allowedModes = state.settings?.allowedModes ?: "bluetooth"
    var verification by remember(allowedModes) {
        mutableStateOf(if (allowedModes == "both") "bluetooth" else allowedModes)
    }
    var selectedBuildingIds by remember { mutableStateOf(setOf<String>()) }
    val needsBuildings = verification != "bluetooth"

    val canCreate = courseId != null && start.isNotBlank() && end.isNotBlank() &&
        (!needsBuildings || selectedBuildingIds.isNotEmpty())

    if (showTimePicker) {
        val (initH, initM) = parseTime(if (pickingStart) start else end)
        val pickerState = rememberTimePickerState(
            initialHour = initH,
            initialMinute = initM,
            is24Hour = true,
        )
        AlertDialog(
            onDismissRequest = { showTimePicker = false },
            title = { Text(if (pickingStart) "Start time" else "End time") },
            text = { TimePicker(state = pickerState) },
            confirmButton = {
                TextButton(onClick = {
                    val formatted = "%02d:%02d".format(pickerState.hour, pickerState.minute)
                    if (pickingStart) start = formatted else end = formatted
                    showTimePicker = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { showTimePicker = false }) { Text("Cancel") } },
        )
    }

    Column(Modifier.fillMaxSize().padding(14.dp)) {
        AppCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                SectionHeader(Icons.Outlined.Schedule, "Create session")
                Spacer(Modifier.height(10.dp))

                LabeledDropdown(
                    label = "Course",
                    selectedText = activeCourses.firstOrNull { it.id == courseId }
                        ?.let { "${it.code} · ${it.batch} — ${it.name}" } ?: "",
                    placeholder = "Choose a course",
                    options = activeCourses.map { (it.id ?: "") to "${it.code} · ${it.batch} — ${it.name}" },
                    onSelect = { courseId = it },
                )
                Spacer(Modifier.height(8.dp))
                LabeledDropdown(
                    label = "Day",
                    selectedText = day,
                    placeholder = "Day",
                    options = DAYS.map { it to it },
                    onSelect = { day = it },
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TimePickerField(
                        label = "Start",
                        value = start,
                        placeholder = "08:00",
                        onClick = { pickingStart = true; showTimePicker = true },
                        modifier = Modifier.weight(1f),
                    )
                    TimePickerField(
                        label = "End",
                        value = end,
                        placeholder = "10:00",
                        onClick = { pickingStart = false; showTimePicker = true },
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = recurring, onCheckedChange = { recurring = it })
                    Text("Recurring (weekly) session", fontSize = 14.sp)
                }

                // Only rendered at all when the server's allowedModes policy permits a
                // choice — a "bluetooth"-only or "geofence"-only policy forces the mode
                // silently instead of showing a picker with nothing to pick.
                if (allowedModes == "both") {
                    Spacer(Modifier.height(8.dp))
                    LabeledDropdown(
                        label = "Verification",
                        selectedText = VERIFICATION_LABELS[verification].orEmpty(),
                        placeholder = "Choose verification",
                        options = VERIFICATION_LABELS.map { (k, v) -> k to v },
                        onSelect = { verification = it },
                    )
                }

                if (needsBuildings) {
                    Spacer(Modifier.height(8.dp))
                    Text("Buildings", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(bottom = 4.dp))
                    if (state.geofences.isEmpty()) {
                        Text(
                            "No buildings configured yet — an admin can draw one in the Geofences tool.",
                            color = Palette.Muted,
                            fontSize = 12.sp,
                        )
                    } else {
                        state.geofences.forEach { g ->
                            val id = g.id ?: return@forEach
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = id in selectedBuildingIds,
                                    onCheckedChange = { checked ->
                                        selectedBuildingIds = if (checked) {
                                            selectedBuildingIds + id
                                        } else {
                                            selectedBuildingIds - id
                                        }
                                    },
                                )
                                Text(g.name.orEmpty(), fontSize = 14.sp)
                            }
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))
                PrimaryButton(
                    text = "Create session",
                    onClick = {
                        vm.createSession(
                            courseId.orEmpty(), day, start, end, recurring,
                            verification, selectedBuildingIds.toList(),
                        )
                    },
                    enabled = canCreate,
                )
            }
        }
    }
}

// ── Sessions tab ───────────────────────────────────────────────────────────────────

@Composable
private fun SessionsTab(state: StaffState, vm: StaffViewModel) {
    var query by remember { mutableStateOf("") }
    var pendingBroadcastSession by remember { mutableStateOf<String?>(null) }
    var batteryPrompted by remember { mutableStateOf(false) }
    val context = LocalContext.current

    // Final step: nudge for battery-optimization exemption once so the broadcast
    // foreground service survives screen-off on aggressive OEMs. The broadcast
    // proceeds regardless of the choice — the exemption only improves reliability.
    val batteryLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { /* result intentionally ignored */ }

    fun launchBroadcast(sessionId: String) {
        if (!batteryPrompted && !BatteryGuard.isExempt(context)) {
            batteryPrompted = true
            runCatching { batteryLauncher.launch(BatteryGuard.requestExemptionIntent(context)) }
        }
        vm.startBroadcast(sessionId)
    }

    // Step 3 of the preflight: system Bluetooth (Quick Settings) enable dialog.
    val enableBtLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { _ ->
        val target = pendingBroadcastSession
        pendingBroadcastSession = null
        if (target != null) {
            val blocker = BroadcastService.broadcastBlocker(context)
            if (blocker == null) launchBroadcast(target) else vm.reportBroadcastBlocked(blocker)
        }
    }

    /** Steps 2-4: Bluetooth adapter on → peripheral support → go. */
    fun proceedAfterPermissions(sessionId: String) {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        when {
            adapter == null ->
                vm.reportBroadcastBlocked("Bluetooth is not available on this device.")
            !adapter.isEnabled -> {
                pendingBroadcastSession = sessionId
                enableBtLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
            }
            else -> {
                val blocker = BroadcastService.broadcastBlocker(context)
                if (blocker == null) launchBroadcast(sessionId) else vm.reportBroadcastBlocked(blocker)
            }
        }
    }

    // Step 1 of the preflight: runtime permissions (advertise + notification).
    val advertiseLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { _ ->
        val target = pendingBroadcastSession
        pendingBroadcastSession = null
        if (target != null) {
            // Only the BLE permissions are mandatory; notifications are best-effort.
            if (BlePermissions.hasAdvertise(context)) {
                proceedAfterPermissions(target)
            } else {
                vm.reportBroadcastBlocked("Bluetooth permission is required to broadcast.")
            }
        }
    }

    fun requestBroadcast(sessionId: String) {
        // On API <= 30 advertise needs no runtime permission.
        if (BlePermissions.hasAdvertise(context)) {
            proceedAfterPermissions(sessionId)
        } else {
            pendingBroadcastSession = sessionId
            advertiseLauncher.launch(BlePermissions.advertiseRequestPermissions())
        }
    }

    val filtered = state.sessions.filter {
        val hay = "${it.course?.code} ${it.lectureDay} ${it.startTime} ${it.endTime} ${if (it.recurring == true) "recurring" else "one-time"}"
        hay.contains(query.trim(), ignoreCase = true)
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp),
    ) {
        if (state.isAdmin) {
            item { GlobalSettingsCard(state = state, vm = vm) }
        }
        item {
            AppTextField(
                query,
                { query = it },
                "Search sessions",
                placeholder = "Course, time, or type…",
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, tint = Palette.Muted) },
            )
        }
        if (filtered.isEmpty()) {
            item { EmptyState("🗓️", "No sessions", "Create a session to see it here.") }
        } else {
            items(filtered, key = { it.id ?: it.hashCode().toString() }) { session ->
                SessionCard(
                    session = session,
                    running = state.isRunning(session.id),
                    broadcast = state.broadcast?.takeIf { it.sessionId == session.id },
                    manualCode = session.id?.let { state.manualCodes[it] },
                    onActivate = { session.id?.let { if (session.active == true) vm.deactivate(it) else vm.activate(it) } },
                    onDelete = { session.id?.let(vm::deleteSession) },
                    onStartBroadcast = { session.id?.let(::requestBroadcast) },
                    onStopBroadcast = { session.id?.let(vm::stopBroadcast) },
                    onExpandManualCode = { session.id?.let(vm::loadManualCode) },
                    onToggleManualCode = { on -> session.id?.let { vm.setManualCodeEnabled(it, on) } },
                    onToggleRotation = { on ->
                        session.id?.let { id ->
                            if (on) vm.setManualCodeRotation(id, "interval", 60) else vm.setManualCodeRotation(id, "none", 60)
                        }
                    },
                    onPauseManualCode = { session.id?.let(vm::pauseManualCode) },
                    onResumeManualCode = { session.id?.let(vm::resumeManualCode) },
                    onRegenerateManualCode = { session.id?.let(vm::regenerateManualCode) },
                )
            }
        }
    }
}

/**
 * Admin-only global policy card: manual-code kill-switch (takes effect immediately
 * for every session), verification mode policy, seeding target, and GPS buffers.
 * Collapsed by default — this is occasional config, not something an admin needs
 * open on every visit to the Sessions tab.
 */
@Composable
private fun GlobalSettingsCard(state: StaffState, vm: StaffViewModel) {
    var expanded by remember { mutableStateOf(false) }
    val settings = state.settings

    AppCard(Modifier.fillMaxWidth(), shape = AppShapes.Panel) {
        Column(Modifier.padding(14.dp)) {
            Row(
                Modifier.fillMaxWidth().clickable { expanded = !expanded },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Global settings", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text(
                        "Verification policy, peer seeding, GPS buffers, manual codes.",
                        color = Palette.Muted,
                        fontSize = 12.sp,
                    )
                }
                Text(
                    if (expanded) "Hide" else "Show",
                    color = Palette.AccentDark,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            if (!expanded || settings == null) return@Column
            Spacer(Modifier.height(12.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(
                    checked = settings.manualCodeAllowed == true,
                    onCheckedChange = vm::setManualCodeAllowedGlobally,
                )
                Spacer(Modifier.width(8.dp))
                Column {
                    Text("Manual attendance codes", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Off hides and rejects the fallback code everywhere, immediately.",
                        color = Palette.Muted,
                        fontSize = 11.sp,
                    )
                }
            }

            Spacer(Modifier.height(14.dp))
            Text("Verification policy", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "Constrains which mode a NEW session may use. Never strands a running session.",
                color = Palette.Muted,
                fontSize = 11.sp,
            )
            Spacer(Modifier.height(6.dp))
            LabeledDropdown(
                label = "",
                selectedText = VERIFICATION_LABELS[settings.allowedModes].orEmpty(),
                placeholder = "Choose",
                options = VERIFICATION_LABELS.map { (k, v) -> k to v },
                onSelect = vm::setAllowedModes,
            )

            Spacer(Modifier.height(14.dp))
            Text("Peer seeding", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "0 disables seeding. Extends Bluetooth range by having a few validated " +
                    "students re-broadcast the token; students never know if they were picked.",
                color = Palette.Muted,
                fontSize = 11.sp,
            )
            Spacer(Modifier.height(6.dp))
            SeedingFields(
                seedRate = settings.seedRate ?: 0,
                seedWindowMs = settings.seedWindowMs ?: 60000L,
                onSave = vm::setSeedingParams,
            )

            Spacer(Modifier.height(14.dp))
            Text("GPS buffers (meters)", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "Geofence-only sessions get the larger buffer (GPS is the only signal); " +
                    "\"both\" sessions' GPS fallback gets the tighter one.",
                color = Palette.Muted,
                fontSize = 11.sp,
            )
            Spacer(Modifier.height(6.dp))
            BufferFields(
                bufferGpsOnly = settings.bufferGpsOnly ?: 30.0,
                bufferGpsBle = settings.bufferGpsBle ?: 15.0,
                onSave = vm::setGpsBuffers,
            )
        }
    }
}

@Composable
private fun SeedingFields(seedRate: Int, seedWindowMs: Long, onSave: (Int, Long) -> Unit) {
    var rateText by remember(seedRate) { mutableStateOf(seedRate.toString()) }
    var windowSecText by remember(seedWindowMs) { mutableStateOf((seedWindowMs / 1000).toString()) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        AppTextField(
            rateText, { rateText = it.filter(Char::isDigit) }, "Target seeders",
            keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
            modifier = Modifier.weight(1f),
        )
        AppTextField(
            windowSecText, { windowSecText = it.filter(Char::isDigit) }, "Window (s)",
            keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
            modifier = Modifier.weight(1f),
        )
    }
    Spacer(Modifier.height(6.dp))
    PillButton(
        "Save seeding settings",
        onClick = {
            val rate = rateText.toIntOrNull() ?: return@PillButton
            val windowMs = (windowSecText.toLongOrNull() ?: return@PillButton) * 1000
            onSave(rate, windowMs)
        },
        tone = PillTone.Accent,
    )
}

@Composable
private fun BufferFields(bufferGpsOnly: Double, bufferGpsBle: Double, onSave: (Double, Double) -> Unit) {
    var onlyText by remember(bufferGpsOnly) { mutableStateOf(bufferGpsOnly.toInt().toString()) }
    var bleText by remember(bufferGpsBle) { mutableStateOf(bufferGpsBle.toInt().toString()) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        AppTextField(
            onlyText, { onlyText = it.filter(Char::isDigit) }, "Geofence-only",
            keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
            modifier = Modifier.weight(1f),
        )
        AppTextField(
            bleText, { bleText = it.filter(Char::isDigit) }, "\"Both\" GPS fallback",
            keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
            modifier = Modifier.weight(1f),
        )
    }
    Spacer(Modifier.height(6.dp))
    PillButton(
        "Save buffers",
        onClick = {
            val only = onlyText.toDoubleOrNull() ?: return@PillButton
            val ble = bleText.toDoubleOrNull() ?: return@PillButton
            onSave(only, ble)
        },
        tone = PillTone.Accent,
    )
}

@Composable
private fun SessionCard(
    session: StaffSessionDto,
    running: Boolean,
    broadcast: BroadcastState?,
    manualCode: ManualCodeStatusDto?,
    onActivate: () -> Unit,
    onDelete: () -> Unit,
    onStartBroadcast: () -> Unit,
    onStopBroadcast: () -> Unit,
    onExpandManualCode: () -> Unit,
    onToggleManualCode: (Boolean) -> Unit,
    onToggleRotation: (Boolean) -> Unit,
    onPauseManualCode: () -> Unit,
    onResumeManualCode: () -> Unit,
    onRegenerateManualCode: () -> Unit,
) {
    val active = session.active == true
    // The single switch is ON only while THIS phone is actually on the air.
    val onAir = broadcast != null
    AppCard(
        Modifier.fillMaxWidth(),
        shape = AppShapes.Panel,
        border = when {
            running -> Palette.RunningBorder
            active -> Palette.SuccessBorder
            else -> Palette.Border
        },
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "${session.course?.code ?: "—"}  ·  ${session.lectureDay} ${session.startTime}-${session.endTime}",
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                    )
                    Text(
                        if (session.recurring == true) "Recurring" else "One-time",
                        color = Palette.Muted,
                        fontSize = 13.sp,
                    )
                }
                if (running) {
                    StatusBadge(
                        if (onAir) "Live" else "Running",
                        if (onAir) PillTone.Success else PillTone.Neutral,
                    )
                }
            }

            Spacer(Modifier.height(10.dp))

            // Broadcast is only offered while the session is inside its scheduled window.
            if (!onAir && running) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    PillButton("📡 Start attendance broadcast", onClick = onStartBroadcast, tone = PillTone.Accent)
                    session.bluetoothDeviceName?.let { DeviceBadge(it, Modifier.weight(1f)) }
                }
            } else if (!onAir && active) {
                Text(
                    "Broadcast is available only while this session is in its scheduled time window.",
                    color = Palette.Muted,
                    fontSize = 12.sp,
                )
            } else if (onAir) {
                Column(
                    Modifier.fillMaxWidth().background(Palette.ChipBg, AppShapes.Menu).padding(12.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LiveDot()
                        Spacer(Modifier.width(6.dp))
                        Text("ON AIR", color = Palette.ErrorText, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                    broadcast?.deviceName?.let {
                        Spacer(Modifier.height(4.dp))
                        Text("Device: $it", color = Palette.ChipInk, fontSize = 12.sp)
                    }
                    val count = broadcast?.attendanceCount
                    val remaining = broadcast?.minutesRemaining
                    if (count != null || remaining != null) {
                        Spacer(Modifier.height(2.dp))
                        Text(
                            listOfNotNull(
                                count?.let { if (it == 1) "1 student marked" else "$it students marked" },
                                remaining?.let { "${it}m left" },
                            ).joinToString("  ·  "),
                            color = Palette.ChipInk,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.sp,
                        )
                    }
                    broadcast?.error?.let {
                        Spacer(Modifier.height(4.dp))
                        Text(it, color = Palette.ErrorText, fontSize = 12.sp)
                    }
                    Spacer(Modifier.height(8.dp))
                    PillButton("Stop broadcast", onClick = onStopBroadcast, tone = PillTone.Danger)
                }
            }

            ManualCodeSection(
                status = manualCode,
                onExpand = onExpandManualCode,
                onToggleEnabled = onToggleManualCode,
                onToggleRotation = onToggleRotation,
                onPause = onPauseManualCode,
                onResume = onResumeManualCode,
                onRegenerate = onRegenerateManualCode,
            )

            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillButton(
                    if (active) "Deactivate" else "Activate",
                    onClick = onActivate,
                    tone = if (active) PillTone.Warning else PillTone.Success,
                )
                PillButton("Delete", onClick = onDelete, tone = PillTone.Danger)
            }
        }
    }
}

/**
 * Collapsible manual-code control, mirroring the broadcast section's information
 * density. Status is fetched on first expand (see [onExpand]) rather than polled
 * continuously — this is staff-controlled config, not a live student-facing signal.
 */
@Composable
private fun ManualCodeSection(
    status: ManualCodeStatusDto?,
    onExpand: () -> Unit,
    onToggleEnabled: (Boolean) -> Unit,
    onToggleRotation: (Boolean) -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onRegenerate: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.padding(top = 10.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable {
                    expanded = !expanded
                    if (expanded) onExpand()
                }
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "🔢  Manual attendance code",
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (expanded) "Hide" else "Show",
                color = Palette.AccentDark,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }

        if (!expanded) return@Column
        Spacer(Modifier.height(6.dp))

        if (status == null) {
            Text("Loading…", color = Palette.Muted, fontSize = 12.sp)
            return@Column
        }
        if (status.allowed == false) {
            Text("Disabled by the administrator.", color = Palette.Muted, fontSize = 12.sp)
            return@Column
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Switch(checked = status.enabled == true, onCheckedChange = onToggleEnabled)
            Spacer(Modifier.width(8.dp))
            Text("Enabled", fontSize = 13.sp)
        }
        if (status.enabled != true) return@Column

        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Switch(checked = status.rotationMode == "interval", onCheckedChange = onToggleRotation)
            Spacer(Modifier.width(8.dp))
            Text("Rotate every 60 s", fontSize = 13.sp)
        }

        if (status.running != true) {
            Spacer(Modifier.height(6.dp))
            Text(
                "The code appears once this session is inside its scheduled time window.",
                color = Palette.Muted,
                fontSize = 12.sp,
            )
            return@Column
        }
        val code = status.code ?: return@Column

        Spacer(Modifier.height(8.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .background(Palette.ChipBg, AppShapes.Menu)
                .padding(12.dp),
        ) {
            Text(
                code.chunked(4).joinToString("  "),
                fontWeight = FontWeight.ExtraBold,
                fontSize = 22.sp,
                letterSpacing = 2.sp,
                color = Palette.AccentDark,
            )
            if (status.paused == true) {
                Text("Rotation paused", color = Palette.WarnText, fontSize = 12.sp)
            } else if (status.rotationMode == "interval" && status.rotatesIn != null) {
                Text("Next rotation: ${status.rotatesIn}s", color = Palette.ChipInk, fontSize = 12.sp)
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (status.rotationMode == "interval") {
                if (status.paused == true) {
                    PillButton("Resume rotation", onClick = onResume, tone = PillTone.Accent)
                } else {
                    PillButton("Pause rotation", onClick = onPause, tone = PillTone.Neutral)
                }
            }
            PillButton("Generate new code", onClick = onRegenerate, tone = PillTone.Neutral)
        }
    }
}

/** Small pulsing red dot — the at-a-glance "this phone is actually on the air" cue. */
@Composable
private fun LiveDot() {
    val transition = rememberInfiniteTransition(label = "liveDot")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.25f,
        animationSpec = infiniteRepeatable(
            animation = tween(700, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "liveDotAlpha",
    )
    Box(
        Modifier
            .size(8.dp)
            .background(Palette.ErrorText.copy(alpha = alpha), CircleShape),
    )
}

// ── Lecturers tab ─────────────────────────────────────────────────────────────────

@Composable
private fun LecturersTab(state: StaffState, vm: StaffViewModel) {
    var name by remember { mutableStateOf("") }
    var lemail by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf<LecturerDto?>(null) }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp),
    ) {
        item {
            AppCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    SectionHeader(Icons.Outlined.PersonAdd, "Add lecturer")
                    Spacer(Modifier.height(10.dp))
                    AppTextField(name, { name = it }, "Full name")
                    Spacer(Modifier.height(8.dp))
                    AppTextField(lemail, { lemail = it }, "Email", placeholder = "name@uop.lk")
                    Spacer(Modifier.height(8.dp))
                    AppTextField(phone, { phone = it }, "Telephone (optional)")
                    Spacer(Modifier.height(12.dp))
                    PrimaryButton("Add lecturer", onClick = {
                        vm.createLecturer(name, lemail, phone)
                        name = ""; lemail = ""; phone = ""
                    })
                }
            }
        }
        if (state.lecturers.isEmpty()) {
            item { EmptyState("👤", "No lecturers", "Add a lecturer above.") }
        } else {
            items(state.lecturers, key = { it.id ?: it.hashCode().toString() }) { lect ->
                AppCard(Modifier.fillMaxWidth(), shape = AppShapes.Panel) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(lect.name ?: "—", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            Text(lect.email ?: "", color = Palette.Muted, fontSize = 13.sp)
                            Text(
                                lect.phone?.takeIf { it.isNotBlank() } ?: "No telephone on file",
                                color = Palette.Muted, fontSize = 12.sp,
                            )
                        }
                        PillButton("Remove", onClick = { confirmDelete = lect }, tone = PillTone.Danger)
                    }
                }
            }
        }
    }

    confirmDelete?.let { lect ->
        ConfirmDialog(
            title = "Remove lecturer?",
            message = "Remove ${lect.name ?: lect.email}? Their courses will be reassigned where possible.",
            confirmLabel = "Remove",
            onConfirm = { lect.id?.let(vm::deleteLecturer); confirmDelete = null },
            onDismiss = { confirmDelete = null },
        )
    }
}

// ── Shared widgets ─────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LabeledDropdown(
    label: String,
    selectedText: String,
    placeholder: String,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(bottom = 6.dp))
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = selectedText,
            onValueChange = {},
            readOnly = true,
            placeholder = { Text(placeholder, color = Palette.Muted) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            shape = AppShapes.Input,
            modifier = Modifier.fillMaxWidth().menuAnchor(),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Palette.Card,
                unfocusedContainerColor = Palette.Card,
                focusedIndicatorColor = Palette.Accent,
                unfocusedIndicatorColor = Palette.InputBorder,
            ),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (value, text) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { onSelect(value); expanded = false })
            }
        }
    }
}

@Composable
private fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel, color = Palette.DangerText) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun OwnersDialog(
    course: CourseDto,
    vm: StaffViewModel,
    onSave: (List<String>) -> Unit,
    onDismiss: () -> Unit,
) {
    val state by vm.state.collectAsState()
    val initial = course.lecturers?.mapNotNull { it.id }?.toSet() ?: emptySet()
    var selectedIds by remember { mutableStateOf(initial) }
    var selectedLecturers by remember {
        mutableStateOf(course.lecturers?.filter { it.id != null }.orEmpty())
    }
    var searchQuery by remember { mutableStateOf("") }

    fun removeOwner(id: String) {
        selectedIds = selectedIds - id
        selectedLecturers = selectedLecturers.filter { it.id != id }
    }

    fun addOwner(lect: LecturerDto) {
        val id = lect.id ?: return
        if (id in selectedIds || selectedIds.size >= 5) return
        selectedIds = selectedIds + id
        selectedLecturers = selectedLecturers + lect
        searchQuery = ""
        vm.searchLecturers("")
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Owners — ${course.code}") },
        text = {
            Column(Modifier.fillMaxWidth()) {
                Text(
                    "Assign 1–5 lecturers (${selectedIds.size}/5)",
                    color = Palette.Muted,
                    fontSize = 13.sp,
                )
                Spacer(Modifier.height(8.dp))
                if (selectedLecturers.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        selectedLecturers.forEach { lect ->
                            val id = lect.id ?: return@forEach
                            OwnerChip(
                                label = lect.name ?: lect.email ?: id,
                                onRemove = { removeOwner(id) },
                            )
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                }
                LecturerSearchField(
                    query = searchQuery,
                    onQueryChange = {
                        searchQuery = it
                        vm.searchLecturers(it)
                    },
                    results = state.lecturerSearchResults,
                    loading = state.lecturerSearchLoading,
                    onSelect = ::addOwner,
                    placeholder = "Search lecturer to add…",
                    excludeIds = selectedIds,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(selectedIds.toList()) },
                enabled = selectedIds.size in 1..5,
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun SectionHeader(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = Palette.AccentDark, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LecturerSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    results: List<LecturerDto>,
    loading: Boolean,
    onSelect: (LecturerDto) -> Unit,
    placeholder: String,
    excludeIds: Set<String> = emptySet(),
) {
    Column {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            placeholder = { Text(placeholder, color = Palette.Muted) },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null, tint = Palette.Muted) },
            trailingIcon = {
                if (loading) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Palette.Accent)
                } else if (query.isNotEmpty()) {
                    IconButton(onClick = { onQueryChange("") }) {
                        Icon(Icons.Outlined.Close, contentDescription = "Clear", tint = Palette.Muted)
                    }
                }
            },
            shape = AppShapes.Input,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Palette.Card,
                unfocusedContainerColor = Palette.Card,
                focusedIndicatorColor = Palette.Accent,
                unfocusedIndicatorColor = Palette.InputBorder,
            ),
        )
        if (results.isNotEmpty() && query.length >= 2) {
            AppCard(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                shape = AppShapes.Menu,
                border = Palette.Border,
            ) {
                Column(Modifier.padding(vertical = 4.dp)) {
                    results.filter { it.id !in excludeIds }.forEach { lect ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { onSelect(lect) }
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .size(32.dp)
                                    .background(Palette.ChipBg, CircleShape),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    (lect.name?.firstOrNull() ?: lect.email?.firstOrNull() ?: '?').uppercaseChar().toString(),
                                    fontWeight = FontWeight.Bold,
                                    color = Palette.AccentDark,
                                    fontSize = 13.sp,
                                )
                            }
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(lect.name ?: "—", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                                Text(lect.email ?: "", color = Palette.Muted, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SelectedLecturerChip(lecturer: LecturerDto, onClear: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Palette.ChipBg, AppShapes.Menu)
            .border(1.dp, Palette.Accent.copy(alpha = 0.3f), AppShapes.Menu)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(36.dp).background(Palette.Card, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Person, contentDescription = null, tint = Palette.AccentDark)
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(lecturer.name ?: "—", fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text(lecturer.email ?: "", color = Palette.Muted, fontSize = 12.sp)
        }
        IconButton(onClick = onClear) {
            Icon(Icons.Outlined.Close, contentDescription = "Clear lecturer", tint = Palette.Muted)
        }
    }
}

@Composable
private fun OwnerChip(label: String, onRemove: () -> Unit) {
    Row(
        Modifier
            .background(Palette.ChipBg, AppShapes.Pill)
            .padding(start = 10.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.ChipInk)
        IconButton(onClick = onRemove, modifier = Modifier.size(24.dp)) {
            Icon(Icons.Outlined.Close, contentDescription = "Remove", modifier = Modifier.size(14.dp), tint = Palette.Muted)
        }
    }
}

@Composable
private fun TimePickerField(
    label: String,
    value: String,
    placeholder: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(bottom = 6.dp))
        Surface(
            onClick = onClick,
            modifier = Modifier.fillMaxWidth(),
            shape = AppShapes.Input,
            color = Palette.Card,
            border = BorderStroke(1.dp, Palette.InputBorder),
        ) {
            Row(
                Modifier.padding(horizontal = 16.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.AccessTime, contentDescription = null, tint = Palette.Accent)
                Spacer(Modifier.width(12.dp))
                Text(
                    if (value.isNotBlank()) value else placeholder,
                    color = if (value.isNotBlank()) Palette.Ink else Palette.Muted,
                    fontSize = 16.sp,
                )
            }
        }
    }
}

private fun parseTime(value: String): Pair<Int, Int> {
    val parts = value.split(":")
    if (parts.size != 2) return 8 to 0
    val h = parts[0].toIntOrNull()?.coerceIn(0, 23) ?: 8
    val m = parts[1].toIntOrNull()?.coerceIn(0, 59) ?: 0
    return h to m
}

@Composable
private fun StaffTopBar(role: String, email: String, onLogout: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Palette.Card.copy(alpha = 0.92f))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(42.dp).background(Palette.ChipBg, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) { Text("🛡️", fontSize = 18.sp) }
        Spacer(Modifier.size(10.dp))
        Column(Modifier.weight(1f)) {
            Text("Attendance administration", fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, color = Palette.Ink)
            Text(
                "University of Peradeniya · ${if (role == "admin") "Administrator" else "Lecturer"}",
                color = Palette.Muted, fontSize = 12.sp,
            )
        }
        Text(
            "Sign out",
            color = Palette.Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clickable(onClick = onLogout).padding(8.dp),
        )
    }
}
