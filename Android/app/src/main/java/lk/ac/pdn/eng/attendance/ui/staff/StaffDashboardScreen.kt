package lk.ac.pdn.eng.attendance.ui.staff

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
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
import androidx.lifecycle.viewmodel.compose.viewModel
import lk.ac.pdn.eng.attendance.ble.BlePermissions
import lk.ac.pdn.eng.attendance.data.net.CourseDto
import lk.ac.pdn.eng.attendance.data.net.LecturerDto
import lk.ac.pdn.eng.attendance.data.net.StaffSessionDto
import lk.ac.pdn.eng.attendance.ui.components.AppCard
import lk.ac.pdn.eng.attendance.ui.components.AppTextField
import lk.ac.pdn.eng.attendance.ui.components.DeviceBadge
import lk.ac.pdn.eng.attendance.ui.components.EmptyState
import lk.ac.pdn.eng.attendance.ui.components.ErrorBanner
import lk.ac.pdn.eng.attendance.ui.components.PillButton
import lk.ac.pdn.eng.attendance.ui.components.PillTone
import lk.ac.pdn.eng.attendance.ui.components.PrimaryButton
import lk.ac.pdn.eng.attendance.ui.components.StatusBadge
import lk.ac.pdn.eng.attendance.ui.theme.AppShapes
import lk.ac.pdn.eng.attendance.ui.theme.Palette

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
        if (state.isAdmin) add("Lecturers")
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
    val selectedLecturers = remember { mutableStateOf(setOf<String>()) }
    var confirmDelete by remember { mutableStateOf<CourseDto?>(null) }
    var ownersFor by remember { mutableStateOf<CourseDto?>(null) }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp),
    ) {
        item {
            AppCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Add course", style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(10.dp))
                    AppTextField(code, { code = it }, "Course code", placeholder = "CS101")
                    Spacer(Modifier.height(8.dp))
                    AppTextField(batch, { batch = it }, "Batch", placeholder = "2024")
                    Spacer(Modifier.height(8.dp))
                    AppTextField(name, { name = it }, "Course name", placeholder = "Intro to Computing")
                    if (state.isAdmin && state.lecturers.isNotEmpty()) {
                        Spacer(Modifier.height(10.dp))
                        Text("Owners (1–5)", style = MaterialTheme.typography.labelLarge)
                        state.lecturers.forEach { lect ->
                            val id = lect.id ?: return@forEach
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = selectedLecturers.value.contains(id),
                                    onCheckedChange = { on ->
                                        selectedLecturers.value =
                                            if (on) selectedLecturers.value + id else selectedLecturers.value - id
                                    },
                                )
                                Text("${lect.name ?: lect.email} ", fontSize = 14.sp)
                            }
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    PrimaryButton("Add course", onClick = {
                        vm.createCourse(
                            code, batch, name,
                            if (state.isAdmin) selectedLecturers.value.toList().takeIf { it.isNotEmpty() } else null,
                        )
                        code = ""; batch = ""; name = ""; selectedLecturers.value = emptySet()
                    })
                }
            }
        }

        if (state.courses.isEmpty()) {
            item { EmptyState("📚", "No courses yet", "Add a course above to get started.") }
        } else {
            items(state.courses, key = { it.id ?: it.hashCode().toString() }) { course ->
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
            lecturers = state.lecturers,
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
        Modifier.fillMaxWidth().clickable(onClick = onOpen),
        shape = AppShapes.Panel,
        border = if (disabled) Palette.Border else Palette.EnabledBorder,
    ) {
        Column(Modifier.padding(14.dp)) {
            Text("${course.code ?: ""}  ·  ${course.batch ?: ""}", fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
            Text(course.name ?: "", color = Palette.Muted, fontSize = 14.sp)
            val owners = course.lecturers?.mapNotNull { it.name ?: it.email }?.joinToString(", ").orEmpty()
            if (owners.isNotEmpty()) {
                Text("Owners: $owners", color = Palette.Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (isAdmin) PillButton("Owners", onClick = onOwners, tone = PillTone.Accent)
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateSessionTab(state: StaffState, vm: StaffViewModel) {
    val activeCourses = state.courses.filter { it.active != false }
    var courseId by remember { mutableStateOf<String?>(null) }
    var day by remember { mutableStateOf("MON") }
    var start by remember { mutableStateOf("") }
    var end by remember { mutableStateOf("") }
    var recurring by remember { mutableStateOf(true) }

    Column(Modifier.fillMaxSize().padding(14.dp)) {
        AppCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("Create session", style = MaterialTheme.typography.titleSmall)
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
                    AppTextField(start, { start = it }, "Start (HH:mm)", placeholder = "08:00", modifier = Modifier.weight(1f))
                    AppTextField(end, { end = it }, "End (HH:mm)", placeholder = "10:00", modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = recurring, onCheckedChange = { recurring = it })
                    Text("Recurring (weekly) session", fontSize = 14.sp)
                }
                Spacer(Modifier.height(12.dp))
                PrimaryButton("Create session", onClick = {
                    vm.createSession(courseId.orEmpty(), day, start.trim(), end.trim(), recurring)
                })
            }
        }
    }
}

// ── Sessions tab ───────────────────────────────────────────────────────────────────

@Composable
private fun SessionsTab(state: StaffState, vm: StaffViewModel) {
    var query by remember { mutableStateOf("") }
    var pendingBroadcastSession by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current

    val advertiseLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        val granted = result.values.all { it }
        val target = pendingBroadcastSession
        pendingBroadcastSession = null
        if (granted && target != null) vm.startBroadcast(target)
    }

    fun requestBroadcast(sessionId: String) {
        // On API <= 30 advertise needs no runtime permission; launch with the
        // (possibly empty) set still works and immediately starts on empty arrays.
        if (BlePermissions.hasAdvertise(context) || BlePermissions.advertisePermissions().isEmpty()) {
            vm.startBroadcast(sessionId)
        } else {
            pendingBroadcastSession = sessionId
            advertiseLauncher.launch(BlePermissions.advertisePermissions())
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
        item {
            AppTextField(query, { query = it }, "Search sessions", placeholder = "Course, time, or type…")
        }
        if (filtered.isEmpty()) {
            item { EmptyState("🗓️", "No sessions", "Create a session to see it here.") }
        } else {
            items(filtered, key = { it.id ?: it.hashCode().toString() }) { session ->
                SessionCard(
                    session = session,
                    running = state.isRunning(session.id),
                    broadcast = state.broadcast?.takeIf { it.sessionId == session.id },
                    onActivate = { session.id?.let { if (session.active == true) vm.deactivate(it) else vm.activate(it) } },
                    onToggleBt = { session.id?.let { if (session.bluetoothEnabled == true) vm.stopBluetooth(it) else vm.startBluetooth(it) } },
                    onTogglePause = {
                        session.id?.let { vm.togglePaused(it, !(session.attendancePaused == true)) }
                    },
                    onDelete = { session.id?.let(vm::deleteSession) },
                    onStartBroadcast = { session.id?.let(::requestBroadcast) },
                    onStopBroadcast = { vm.stopBroadcast() },
                )
            }
        }
    }
}

@Composable
private fun SessionCard(
    session: StaffSessionDto,
    running: Boolean,
    broadcast: BroadcastState?,
    onActivate: () -> Unit,
    onToggleBt: () -> Unit,
    onTogglePause: () -> Unit,
    onDelete: () -> Unit,
    onStartBroadcast: () -> Unit,
    onStopBroadcast: () -> Unit,
) {
    val active = session.active == true
    val btOn = session.bluetoothEnabled == true
    val paused = session.attendancePaused == true
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
                    Box(Modifier.clickable(onClick = onTogglePause)) {
                        StatusBadge(if (paused) "Paused" else "Live", if (paused) PillTone.Warning else PillTone.Success)
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            // Bluetooth controls
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                PillButton(
                    if (btOn) "BT off" else "📡 BT on",
                    onClick = onToggleBt,
                    tone = if (btOn) PillTone.Warning else PillTone.Accent,
                )
                session.bluetoothDeviceName?.let { DeviceBadge(it, Modifier.weight(1f)) }
            }

            if (btOn) {
                Spacer(Modifier.height(8.dp))
                if (broadcast == null) {
                    PillButton("Broadcast from this phone", onClick = onStartBroadcast, tone = PillTone.Accent)
                } else {
                    Column(
                        Modifier.fillMaxWidth().background(Palette.ChipBg, AppShapes.Menu).padding(12.dp),
                    ) {
                        Text("Broadcasting…", color = Palette.ChipInk, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        broadcast.deviceName?.let { Text("Device: $it", color = Palette.ChipInk, fontSize = 12.sp) }
                        broadcast.token?.let {
                            Text("Token: $it", color = Palette.ChipInk, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                        broadcast.rotatesIn?.let { Text("Rotates in ~${it}s", color = Palette.Muted, fontSize = 12.sp) }
                        broadcast.error?.let { Text(it, color = Palette.ErrorText, fontSize = 12.sp) }
                        Spacer(Modifier.height(8.dp))
                        PillButton("Stop broadcast", onClick = onStopBroadcast, tone = PillTone.Danger)
                    }
                }
            }

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
                    Text("Add lecturer", style = MaterialTheme.typography.titleSmall)
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

@Composable
private fun OwnersDialog(
    course: CourseDto,
    lecturers: List<LecturerDto>,
    onSave: (List<String>) -> Unit,
    onDismiss: () -> Unit,
) {
    val initial = course.lecturers?.mapNotNull { it.id }?.toSet() ?: emptySet()
    var selected by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Owners — ${course.code}") },
        text = {
            Column {
                Text("Select 1–5 lecturers.", color = Palette.Muted, fontSize = 13.sp)
                Spacer(Modifier.height(8.dp))
                lecturers.forEach { lect ->
                    val id = lect.id ?: return@forEach
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = selected.contains(id),
                            onCheckedChange = { on -> selected = if (on) selected + id else selected - id },
                        )
                        Text(lect.name ?: lect.email ?: id, fontSize = 14.sp)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(selected.toList()) },
                enabled = selected.size in 1..5,
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
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
