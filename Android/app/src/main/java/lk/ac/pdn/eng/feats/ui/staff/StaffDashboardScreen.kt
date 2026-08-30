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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Rule
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.PauseCircleOutline
import androidx.compose.material.icons.outlined.Password
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PhoneIphone
import androidx.compose.material.icons.outlined.PlayCircleOutline
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tune
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
import androidx.compose.material3.MenuAnchorType
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import lk.ac.pdn.eng.feats.data.net.CourseDto
import lk.ac.pdn.eng.feats.data.net.GeofenceDto
import lk.ac.pdn.eng.feats.data.net.LecturerDto
import lk.ac.pdn.eng.feats.data.net.ManualCodeStatusDto
import lk.ac.pdn.eng.feats.data.net.StaffSessionDto
import lk.ac.pdn.eng.feats.ui.components.AppCard
import lk.ac.pdn.eng.feats.ui.components.AppTextField
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
        if (state.isAdmin) { add("Lecturers"); add("Geofences"); add("Settings") }
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
            "Settings" -> SettingsTab(state, vm)
        }
    }
}

// ── Courses tab ───────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun CoursesTab(state: StaffState, vm: StaffViewModel, onOpenMatrix: (String) -> Unit) {
    var code by remember { mutableStateOf("") }
    var batchFieldValue by remember { mutableStateOf(TextFieldValue("")) }
    val batches = parseBatches(batchFieldValue.text)
    val batchInputIncomplete = hasIncompleteBatch(batchFieldValue.text)
    var name by remember { mutableStateOf("") }
    var filterQuery by remember { mutableStateOf("") }
    var ownersFor by remember { mutableStateOf<CourseDto?>(null) }

    // Server-scoped by selectedLecturerFilter for admins (see StaffViewModel.setLecturerFilter) —
    // state.courses is already the right set, just re-sorted for archived-last display.
    val visibleCourses = state.courses.sortedForDisplay()
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
                    AppTextField(
                        code,
                        { code = sanitizeCourseCode(it) },
                        "Course code",
                        placeholder = "CS101",
                    )
                    Spacer(Modifier.height(8.dp))
                    BatchInputField(
                        value = batchFieldValue,
                        onValueChange = { batchFieldValue = it },
                        placeholder = "E23 , E24",
                    )
                    if (batchInputIncomplete) {
                        Text(
                            "Finish or remove the incomplete batch — each one needs two digits.",
                            color = Palette.WarnText,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
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
                            vm.createCourse(code, batches, name)
                            code = ""; batchFieldValue = TextFieldValue(""); name = ""
                        },
                        enabled = canAddCourse && batches.isNotEmpty() && !batchInputIncomplete,
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
                    onOpen = { course.id?.let(onOpenMatrix) },
                    onArchiveToggle = {
                        course.id?.let { if (course.active == false) vm.enableCourse(it) else vm.disableCourse(it) }
                    },
                    onOwners = { ownersFor = course },
                )
            }
            if (state.coursesHasMore) {
                item { LoadMoreRow(loading = state.coursesLoadingMore, onClick = vm::loadMoreCourses) }
            }
        }
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

/** Course code: capital letters and numbers only, typed lowercase becomes capital. */
private fun sanitizeCourseCode(input: String): String =
    input.uppercase().filter { it.isLetterOrDigit() }

private val BATCH_RE = Regex("^E\\d{2}$")

/**
 * Continuous multi-batch entry, re-derived from the whole field on every keystroke.
 * A group starts on a comma/space, on a second `E` after digits (an explicit new group
 * even with no delimiter), or once the current group already has 2 digits and another
 * digit arrives (auto-chunking plain continuous digits, e.g. "2324" -> "E23 , E24"). `E`
 * is genuinely typable — a bare "E" with no digits yet still renders as "E" rather than
 * vanishing — but it's never required: a group that never got one still renders with the
 * auto-inserted prefix. Being a pure function of the current text (not an incremental
 * commit-and-clear), backspace/editing just re-derives from the shorter/changed text.
 */
private fun formatBatchStream(raw: String): String {
    val groups = mutableListOf<String>()
    var digits = StringBuilder()
    var groupStarted = false

    fun flushGroup() {
        if (groupStarted) groups.add(digits.toString())
        digits = StringBuilder()
        groupStarted = false
    }

    for (ch in raw.uppercase()) {
        when {
            ch == ',' || ch == ' ' -> flushGroup()
            ch == 'E' -> {
                if (groupStarted && digits.isNotEmpty()) flushGroup()
                groupStarted = true
            }
            ch.isDigit() -> {
                if (digits.length >= 2) flushGroup()
                groupStarted = true
                digits.append(ch)
            }
            else -> Unit
        }
    }
    flushGroup()

    return groups.joinToString(" , ") { "E$it" }
}

/** Parses the field's text into the complete + valid `EXX` batches for submission. */
private fun parseBatches(fieldText: String): List<String> =
    fieldText.split(",").map { it.trim() }.filter { BATCH_RE.matches(it) }.distinct()

/**
 * True if any comma-separated group is non-empty but not a complete `EXX` batch (e.g. a
 * trailing "E2" with only one digit) — [parseBatches] silently drops exactly these, which
 * would otherwise let a course get created missing a batch the user thought they'd typed.
 */
private fun hasIncompleteBatch(fieldText: String): Boolean =
    fieldText.split(",").map { it.trim() }.any { it.isNotEmpty() && !BATCH_RE.matches(it) }

@Composable
private fun BatchInputField(
    value: TextFieldValue,
    onValueChange: (TextFieldValue) -> Unit,
    placeholder: String,
) {
    Column {
        Text("Batch", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(bottom = 6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = { new ->
                val formatted = formatBatchStream(new.text)
                onValueChange(TextFieldValue(formatted, selection = TextRange(formatted.length)))
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            placeholder = { Text(placeholder, color = Palette.Muted) },
            shape = AppShapes.Input,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Palette.Card,
                unfocusedContainerColor = Palette.Card,
                focusedIndicatorColor = Palette.Accent,
                unfocusedIndicatorColor = Palette.InputBorder,
            ),
        )
    }
}

// Sorted so archived (disabled) courses fall to the bottom, active ones stay code/batch ordered.
private fun List<CourseDto>.sortedForDisplay(): List<CourseDto> =
    sortedWith(compareBy({ it.active == false }, { it.code.orEmpty() }, { it.batch.orEmpty() }))

@Composable
private fun CourseCard(
    course: CourseDto,
    onOpen: () -> Unit,
    onArchiveToggle: () -> Unit,
    onOwners: () -> Unit,
) {
    val archived = course.active == false
    AppCard(
        Modifier.fillMaxWidth(),
        shape = AppShapes.Panel,
        border = if (archived) Palette.Border else Palette.EnabledBorder,
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
                    if (archived) StatusBadge("Archived", PillTone.Warning)
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
                // A course only ever appears here for an owning lecturer or an admin —
                // both may add and remove owners, same as the admin Owners dialog.
                PillButton("Owners", onClick = onOwners, tone = PillTone.Accent)
                PillButton(
                    if (archived) "Unarchive" else "Archive",
                    onClick = onArchiveToggle,
                    tone = if (archived) PillTone.Success else PillTone.Warning,
                )
            }
        }
    }
}

// ── Create session tab ────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
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

    // No verification picker any more: every session uses Bluetooth and GPS
    // together. Buildings are what the lecturer chooses instead, and they are
    // mandatory — GPS has nothing to measure against without a polygon.
    var selectedBuildingIds by remember { mutableStateOf(setOf<String>()) }
    var showAdvanced by remember { mutableStateOf(false) }

    // The lecturer's code exists for every session; the only choice is rotation.
    var codeRotates by remember { mutableStateOf(false) }
    var codeSeconds by remember { mutableStateOf("60") }

    val canCreate = courseId != null && start.isNotBlank() && end.isNotBlank() &&
        selectedBuildingIds.isNotEmpty()

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

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 14.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 6.dp, bottom = 24.dp),
    ) {
        item {
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

                Spacer(Modifier.height(14.dp))
                androidx.compose.material3.HorizontalDivider(color = Palette.Border)
                Spacer(Modifier.height(14.dp))

                Text("Where is this lecture?", style = MaterialTheme.typography.labelLarge)
                Text(
                    "Students are checked against these building outlines. At least one is required.",
                    color = Palette.Muted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
                )
                if (state.geofences.isEmpty()) {
                    ErrorBanner(
                        "No buildings have been drawn yet. An administrator needs to add one in the Geofences tool before sessions can be created.",
                    )
                } else {
                    BuildingMultiSelectDropdown(
                        buildings = state.geofences,
                        selectedIds = selectedBuildingIds,
                        onToggle = { id ->
                            selectedBuildingIds = if (id in selectedBuildingIds) {
                                selectedBuildingIds - id
                            } else {
                                selectedBuildingIds + id
                            }
                        },
                    )
                }

                Spacer(Modifier.height(14.dp))
                androidx.compose.material3.HorizontalDivider(color = Palette.Border)
                Spacer(Modifier.height(14.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().clickable { showAdvanced = !showAdvanced },
                ) {
                    Text("Advanced settings", style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                    Icon(
                        if (showAdvanced) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                        contentDescription = if (showAdvanced) "Collapse" else "Expand",
                        tint = Palette.Muted,
                    )
                }
                if (showAdvanced) {
                    Spacer(Modifier.height(10.dp))
                    Text("Attendance code", style = MaterialTheme.typography.labelLarge)
                    Text(
                        "Every session gets an 8-digit code you can read out when a student's phone can't verify itself. Rotating it limits how far a shared code travels.",
                        color = Palette.Muted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = codeRotates, onCheckedChange = { codeRotates = it })
                        Text("Rotate automatically", fontSize = 13.sp, modifier = Modifier.weight(1f))
                        if (codeRotates) {
                            AppTextField(
                                codeSeconds,
                                { codeSeconds = it.filter(Char::isDigit) },
                                "",
                                placeholder = "60",
                                keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                                modifier = Modifier.width(90.dp),
                            )
                            Spacer(Modifier.width(4.dp))
                            Text("sec", color = Palette.Muted, fontSize = 12.sp)
                        }
                    }
                }

                Spacer(Modifier.height(14.dp))
                PrimaryButton(
                    text = "Create session",
                    onClick = {
                        vm.createSession(
                            courseId.orEmpty(), day, start, end, recurring,
                            buildings = selectedBuildingIds.toList(),
                            manualCodeRotationMode = if (codeRotates) "interval" else "none",
                            manualCodeRotationSeconds = codeSeconds.toIntOrNull()?.coerceIn(10, 3600) ?: 60,
                        )
                    },
                    enabled = canCreate,
                )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun BuildingMultiSelectDropdown(
    buildings: List<GeofenceDto>,
    selectedIds: Set<String>,
    onToggle: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val available = buildings.filter { it.active != false && it.id != null }
    val filtered = available.filter {
        it.name.orEmpty().contains(query.trim(), ignoreCase = true)
    }
    val selected = available.filter { it.id in selectedIds }

    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Buildings", style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            if (selected.isNotEmpty()) {
                Text(
                    "${selected.size} selected",
                    color = Palette.AccentDark,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { expanded = it },
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = {
                    query = it
                    expanded = true
                },
                placeholder = { Text("Search and select buildings") },
                leadingIcon = {
                    Icon(Icons.Outlined.Search, contentDescription = null, tint = Palette.Muted)
                },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                singleLine = true,
                shape = AppShapes.Input,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Palette.Card,
                    unfocusedContainerColor = Palette.Card,
                    focusedIndicatorColor = Palette.Accent,
                    unfocusedIndicatorColor = Palette.InputBorder,
                ),
                modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryEditable),
            )
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = {
                    expanded = false
                    query = ""
                },
            ) {
                if (filtered.isEmpty()) {
                    Text(
                        if (available.isEmpty()) "No active buildings" else "No buildings match your search",
                        color = Palette.Muted,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                    )
                } else {
                    filtered.forEach { building ->
                        val id = building.id ?: return@forEach
                        val isSelected = id in selectedIds
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(
                                        building.name?.takeIf { it.isNotBlank() } ?: "Unnamed building",
                                        color = if (isSelected) Palette.AccentDark else Palette.Ink,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                    )
                                    if (isSelected) {
                                        Text("Selected", color = Palette.AccentDark, fontSize = 11.sp)
                                    }
                                }
                            },
                            leadingIcon = {
                                Icon(
                                    if (isSelected) Icons.Outlined.CheckCircle else Icons.Outlined.AddCircleOutline,
                                    contentDescription = null,
                                    tint = if (isSelected) Palette.AccentDark else Palette.Muted,
                                )
                            },
                            onClick = {
                                onToggle(id)
                                query = ""
                            },
                            modifier = Modifier.background(if (isSelected) Palette.AccentSoft else Color.Transparent),
                        )
                    }
                }
            }
        }

        if (selected.isEmpty()) {
            Text(
                "Select one or more buildings for GPS verification.",
                color = Palette.Muted,
                fontSize = 11.5.sp,
                modifier = Modifier.padding(top = 6.dp),
            )
        } else {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(top = 8.dp),
            ) {
                selected.forEach { building ->
                    val id = building.id ?: return@forEach
                    Surface(
                        onClick = { onToggle(id) },
                        shape = RoundedCornerShape(10.dp),
                        color = Palette.Accent,
                        contentColor = Color.White,
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(start = 10.dp, end = 6.dp, top = 7.dp, bottom = 7.dp),
                        ) {
                            Text(
                                building.name.orEmpty(),
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                            )
                            Spacer(Modifier.width(4.dp))
                            Icon(
                                Icons.Outlined.Close,
                                contentDescription = "Remove ${building.name.orEmpty()}",
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    }
                }
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
    var confirmDelete by remember { mutableStateOf<StaffSessionDto?>(null) }
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

    // "Collect"/"Join" double as "start broadcast": once vm.collect() confirms the
    // session is collecting, it emits here and this runs the same permission
    // preflight a dedicated broadcast button used to trigger directly.
    LaunchedEffect(Unit) {
        vm.broadcastReady.collect { sessionId -> requestBroadcast(sessionId) }
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
                    stage = state.stageOf(session),
                    broadcast = state.broadcast?.takeIf { it.sessionId == session.id },
                    liveOnServer = state.isBroadcastingOnServer(session),
                    manualCode = session.id?.let { state.manualCodes[it] },
                    buildingNames = state.geofences
                        .filter { it.id in session.buildings.orEmpty() }
                        .mapNotNull { it.name?.takeIf(String::isNotBlank) },
                    bleEnabled = state.bleEnabled,
                    onCollect = { session.id?.let(vm::collect) },
                    onDeactivate = { session.id?.let(vm::deactivate) },
                    onDelete = { confirmDelete = session },
                    onLoadManualCode = { session.id?.let(vm::loadManualCode) },
                    onPauseManualCode = { session.id?.let(vm::pauseManualCode) },
                    onResumeManualCode = { session.id?.let(vm::resumeManualCode) },
                    onRegenerateManualCode = { session.id?.let(vm::regenerateManualCode) },
                )
            }
            if (state.sessionsHasMore && query.isBlank()) {
                item { LoadMoreRow(loading = state.sessionsLoadingMore, onClick = vm::loadMoreSessions) }
            }
        }
    }

    confirmDelete?.let { session ->
        ConfirmDialog(
            title = "Delete session?",
            message = "Delete ${session.course?.code ?: "this session"} on ${session.lectureDay ?: "its scheduled day"} at ${session.startTime ?: "the scheduled time"}?",
            confirmLabel = "Delete",
            onConfirm = {
                session.id?.let(vm::deleteSession)
                confirmDelete = null
            },
            onDismiss = { confirmDelete = null },
        )
    }
}

// ── Settings tab (admin only) ───────────────────────────────────────────────────────

@Composable
private fun SettingsTab(state: StaffState, vm: StaffViewModel) {
    val settings = state.settings
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 8.dp, bottom = 24.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(44.dp).clip(RoundedCornerShape(14.dp))
                        .background(Brush.linearGradient(listOf(Palette.GradIndigo, Palette.Accent))),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.Tune, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp)) }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Global settings", fontWeight = FontWeight.ExtraBold, fontSize = 19.sp, color = Palette.Ink)
                    Text("Applies instantly across every session", color = Palette.Muted, fontSize = 13.sp)
                }
            }
        }

        if (settings == null) {
            item { LoadingRow() }
            return@LazyColumn
        }

        item {
            SettingsSection(
                icon = Icons.AutoMirrored.Outlined.Rule,
                title = "How attendance is verified",
                subtitle = "Every session checks Bluetooth and GPS together for 90 seconds. " +
                    "Hearing the classroom beacon passes a student outright; so does standing " +
                    "within the pass distance of the building.",
            ) {
                PolicySwitch(
                    label = "Bluetooth",
                    detail = "Off stops lecturer broadcasts, student scanning and peer seeding. " +
                        "GPS keeps working — it has no off switch.",
                    checked = settings.bleEnabled != false,
                    onCheckedChange = vm::setBleEnabled,
                )
                if (settings.bleEnabled == false) {
                    Spacer(Modifier.height(10.dp))
                    SessionNotice(
                        "Bluetooth is off system-wide. Students can only be verified by GPS, " +
                            "so more of them will need the attendance code.",
                    )
                }
            }
        }

        item {
            SettingsSection(
                icon = Icons.Outlined.MyLocation,
                title = "Distance thresholds",
                subtitle = "Measured from the edge of the session's building outline.",
            ) {
                BufferFields(
                    nearBufferM = settings.nearBufferM ?: 50,
                    farBufferM = settings.farBufferM ?: 100,
                    onSave = vm::setDistanceBuffers,
                )
            }
        }

        item {
            SettingsSection(
                icon = Icons.Outlined.Password,
                title = "What the attendance code grants",
                subtitle = "A student who can't be verified automatically may enter the code you read out. " +
                    "Within the far buffer it passes them outright; beyond it, the attempt is flagged in " +
                    "the attendance export instead — there's no review queue to act on it.",
            ) {
                val options = settings.geofenceLogicOptions.orEmpty()
                val optionPairs = options.map { (it.id ?: "") to (it.label ?: it.id.orEmpty()) }
                val nearSelected = options.firstOrNull { it.id == settings.nearBufferLogic }
                val farSelected = options.firstOrNull { it.id == settings.farBufferLogic }
                // Fall back to the saved id, never to a hardcoded strategy name: if the
                // option list ever fails to arrive, an unresolvable id must look wrong
                // rather than silently claim the default strategy is selected.
                LabeledDropdown(
                    label = "Near-buffer logic",
                    selectedText = nearSelected?.label ?: settings.nearBufferLogic.orEmpty(),
                    placeholder = "Select…",
                    options = optionPairs,
                    onSelect = vm::setNearBufferLogic,
                )
                nearSelected?.description?.let {
                    Text(it, color = Palette.Muted, fontSize = 11.5.sp, modifier = Modifier.padding(top = 4.dp))
                }
                Spacer(Modifier.height(12.dp))
                LabeledDropdown(
                    label = "Far-buffer logic",
                    selectedText = farSelected?.label ?: settings.farBufferLogic.orEmpty(),
                    placeholder = "Select…",
                    options = optionPairs,
                    onSelect = vm::setFarBufferLogic,
                )
                farSelected?.description?.let {
                    Text(it, color = Palette.Muted, fontSize = 11.5.sp, modifier = Modifier.padding(top = 4.dp))
                }
            }
        }

        item {
            SettingsSection(
                icon = Icons.Outlined.Groups,
                title = "Peer seeding",
                subtitle = "0 disables seeding. Extends Bluetooth range by having a few students who " +
                    "heard the lecturer directly re-broadcast the token; they never know if they were picked.",
            ) {
                SeedingFields(
                    seedRate = settings.seedRate ?: 0,
                    seedWindowMs = settings.seedWindowMs ?: 60000L,
                    onSave = vm::setSeedingParams,
                )
                if (settings.bleEnabled == false) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Inactive while Bluetooth is switched off above.",
                        color = Palette.Muted,
                        fontSize = 12.sp,
                    )
                }
            }
        }

        item {
            SettingsSection(
                icon = Icons.Outlined.Person,
                title = "Student sign-in",
                subtitle = "When on, new self-registering students must sign in with a $DEFAULT_STUDENT_EMAIL_DOMAIN " +
                    "address. Existing accounts and staff you've added directly are never affected.",
            ) {
                PolicySwitch(
                    label = "Restrict to $DEFAULT_STUDENT_EMAIL_DOMAIN",
                    detail = "Off: any Google account can self-register as a student.",
                    checked = settings.studentEmailDomain?.isNotBlank() == true,
                    onCheckedChange = { on ->
                        vm.setStudentEmailDomain(if (on) DEFAULT_STUDENT_EMAIL_DOMAIN else "")
                    },
                )
            }
        }

        item {
            SettingsSection(
                icon = Icons.Outlined.PhoneIphone,
                title = "Web client",
                subtitle = "iPhone and iPad students check in at /app in a browser. No iOS browser can " +
                    "read a Bluetooth beacon, so that page verifies by GPS only, with the attendance " +
                    "code as the way out.",
            ) {
                PolicySwitch(
                    label = "Allow non-iPhone devices",
                    detail = "Off: Android and desktop are turned away and told to use this app, which " +
                        "also verifies over Bluetooth. Turn on only if this app is unavailable.",
                    checked = settings.webAllowNonIos == true,
                    onCheckedChange = vm::setWebAllowNonIos,
                )
                if (settings.webAllowNonIos == true) {
                    Spacer(Modifier.height(10.dp))
                    SessionNotice(
                        "Anyone can use the web page right now. They will be verified by GPS alone, " +
                            "so more of them will need the attendance code.",
                    )
                }
            }
        }

        item {
            SettingsSection(
                icon = Icons.Outlined.AddCircleOutline,
                title = "App version",
                subtitle = "Devices below this Android versionCode are blocked with a mandatory update screen. 0 disables the check.",
            ) {
                MinVersionStepper(
                    versionCode = settings.minSupportedVersionCode ?: 0,
                    onChange = vm::setMinSupportedVersionCode,
                )
            }
        }
    }
}

private const val DEFAULT_STUDENT_EMAIL_DOMAIN = "eng.pdn.ac.lk"

@Composable
private fun MinVersionStepper(versionCode: Int, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        StepperButton(symbol = "−", contentDescription = "Decrease", enabled = versionCode > 0) {
            onChange((versionCode - 1).coerceAtLeast(0))
        }
        Text(
            versionCode.toString(),
            fontWeight = FontWeight.ExtraBold,
            fontSize = 20.sp,
            color = Palette.Ink,
            modifier = Modifier.width(48.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        StepperButton(symbol = "+", contentDescription = "Increase", enabled = true) {
            onChange(versionCode + 1)
        }
    }
}

@Composable
private fun StepperButton(
    symbol: String,
    contentDescription: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(if (enabled) Palette.ChipBg else Palette.InactiveBg)
            .clickable(enabled = enabled, onClick = onClick)
            .semantics { this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            symbol,
            color = if (enabled) Palette.AccentDark else Palette.Muted,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 18.sp,
        )
    }
}

/** One global policy row: switch + label + one line of plain-language detail. */
@Composable
private fun PolicySwitch(
    label: String,
    detail: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(label, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, color = Palette.Ink)
            Text(detail, color = Palette.Muted, fontSize = 11.5.sp)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun SettingsSection(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String? = null,
    content: @Composable () -> Unit,
) {
    AppCard(Modifier.fillMaxWidth(), shape = AppShapes.Panel) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(Palette.ChipBg),
                    contentAlignment = Alignment.Center,
                ) { Icon(icon, contentDescription = null, tint = Palette.AccentDark, modifier = Modifier.size(16.dp)) }
                Spacer(Modifier.width(10.dp))
                Text(title, fontWeight = FontWeight.Bold, fontSize = 14.5.sp, color = Palette.Ink)
            }
            subtitle?.let {
                Text(it, color = Palette.Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp, bottom = 10.dp))
            } ?: Spacer(Modifier.height(10.dp))
            content()
        }
    }
}

@Composable
private fun LoadingRow() {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 24.dp),
        horizontalArrangement = Arrangement.Center,
    ) {
        androidx.compose.material3.CircularProgressIndicator(color = Palette.Accent)
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
private fun BufferFields(nearBufferM: Int, farBufferM: Int, onSave: (Int, Int) -> Unit) {
    var nearText by remember(nearBufferM) { mutableStateOf(nearBufferM.toString()) }
    var farText by remember(farBufferM) { mutableStateOf(farBufferM.toString()) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        AppTextField(
            nearText, { nearText = it.filter(Char::isDigit) }, "Pass within (m)",
            keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
            modifier = Modifier.weight(1f),
        )
        AppTextField(
            farText, { farText = it.filter(Char::isDigit) }, "Outer limit (m)",
            keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
            modifier = Modifier.weight(1f),
        )
    }
    Spacer(Modifier.height(4.dp))
    Text(
        "GPS is routinely accurate to only 20–50m indoors, so a tight pass distance sends more genuinely-present students to the code.",
        color = Palette.Muted,
        fontSize = 11.5.sp,
    )
    Spacer(Modifier.height(6.dp))
    PillButton(
        "Save distances",
        onClick = {
            val near = nearText.toIntOrNull() ?: return@PillButton
            val far = farText.toIntOrNull() ?: return@PillButton
            onSave(near, far)
        },
        tone = PillTone.Accent,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SessionCard(
    session: StaffSessionDto,
    stage: SessionStage,
    broadcast: BroadcastState?,
    manualCode: ManualCodeStatusDto?,
    buildingNames: List<String>,
    bleEnabled: Boolean,
    /** Server's `broadcasting` flag, freshest available — see call site (10s running-poll,
     *  falling back to the less-fresh full session list only if that poll hasn't hit yet). */
    liveOnServer: Boolean,
    /** Backs both "Collect" (Within-session) and "Join" (Collecting, not yet broadcasting here). */
    onCollect: () -> Unit,
    onDeactivate: () -> Unit,
    onDelete: () -> Unit,
    onLoadManualCode: () -> Unit,
    onPauseManualCode: () -> Unit,
    onResumeManualCode: () -> Unit,
    onRegenerateManualCode: () -> Unit,
) {
    val collecting = stage == SessionStage.Collecting
    // `broadcast` mirrors BroadcastService.state — non-null only on the phone that is
    // actually transmitting BLE. This is independent of `stage`: Collecting means GPS is
    // verifying every student regardless of whether anyone happens to be broadcasting.
    val liveHere = broadcast != null
    val liveAnywhere = collecting && (liveOnServer || liveHere)
    val buildingLabel = when {
        buildingNames.isNotEmpty() -> buildingNames.joinToString(", ")
        session.buildings.orEmpty().isNotEmpty() -> "${session.buildings.orEmpty().size} buildings"
        else -> null
    }

    AppCard(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        border = when (stage) {
            SessionStage.Collecting -> Palette.SuccessBorder
            SessionStage.WithinSession -> Palette.RunningBorder
            SessionStage.Inactive -> Palette.Border
        },
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .background(if (collecting) Palette.SuccessBg else Palette.AccentSoft, RoundedCornerShape(13.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Outlined.Schedule,
                        contentDescription = null,
                        tint = if (collecting) Palette.SuccessText else Palette.AccentDark,
                        modifier = Modifier.size(22.dp),
                    )
                }
                Spacer(Modifier.width(11.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        session.course?.code ?: "Untitled course",
                        color = Palette.Ink,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 18.sp,
                    )
                    Text(
                        listOfNotNull(session.course?.name, session.course?.batch).joinToString(" · ")
                            .ifBlank { "Course session" },
                        color = Palette.Muted,
                        fontSize = 12.sp,
                        maxLines = 1,
                    )
                }
                SessionStatePill(stage = stage)
            }

            Spacer(Modifier.height(14.dp))
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(Palette.InactiveBg, RoundedCornerShape(14.dp))
                    .border(1.dp, Palette.Border, RoundedCornerShape(14.dp))
                    .padding(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CalendarMonth, contentDescription = null, tint = Palette.AccentDark, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(session.lectureDay ?: "—", color = Palette.Ink, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    Spacer(Modifier.width(16.dp))
                    Icon(Icons.Outlined.AccessTime, contentDescription = null, tint = Palette.AccentDark, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "${session.startTime ?: "—"} – ${session.endTime ?: "—"}",
                        color = Palette.Ink,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                    )
                }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.padding(top = 10.dp),
                ) {
                    SessionMetaChip(
                        icon = if (session.recurring == true) Icons.Outlined.Repeat else Icons.Outlined.CalendarMonth,
                        text = if (session.recurring == true) "Weekly" else "One-time",
                    )
                    buildingLabel?.let { SessionMetaChip(Icons.Outlined.LocationOn, it) }
                }
            }

            Spacer(Modifier.height(12.dp))
            when {
                collecting -> {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .background(Palette.SuccessBg, RoundedCornerShape(14.dp))
                            .border(1.dp, Palette.SuccessBorder, RoundedCornerShape(14.dp))
                            .padding(13.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            LiveDot()
                            Spacer(Modifier.width(7.dp))
                            Text("COLLECTING ATTENDANCE", color = Palette.SuccessText, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp)
                        }
                        when {
                            liveHere -> {
                                val details = listOfNotNull(
                                    broadcast?.attendanceCount?.let { if (it == 1) "1 student marked" else "$it students marked" },
                                    broadcast?.minutesRemaining?.let { "${it}m remaining" },
                                ).joinToString(" · ")
                                if (details.isNotBlank()) {
                                    Text(details, color = Palette.SuccessText, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                                }
                                // A radio failure only ever stops THIS device's own broadcast — it
                                // never turns off collecting. GPS keeps verifying either way, and
                                // any other device that's joined is unaffected.
                                broadcast?.error?.let {
                                    Text(
                                        "$it GPS is still verifying students for this session.",
                                        color = Palette.ErrorText,
                                        fontSize = 12.sp,
                                        modifier = Modifier.padding(top = 4.dp),
                                    )
                                }
                            }
                            liveAnywhere -> {
                                // Broadcasting from a different device — no local BroadcastState to read
                                // counts from, and we deliberately don't poll GET .../broadcast here since
                                // that poll doubles as the broadcaster's own heartbeat; polling it from a
                                // viewing device would falsely keep a dead broadcast looking alive.
                                Text(
                                    "Broadcasting from another device.",
                                    color = Palette.SuccessText,
                                    fontSize = 12.sp,
                                    modifier = Modifier.padding(top = 4.dp),
                                )
                            }
                            else -> Text(
                                "Verifying by GPS. No one is broadcasting Bluetooth yet.",
                                color = Palette.SuccessText,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(
                            when {
                                liveHere -> "Deactivate below to stop collecting for everyone."
                                bleEnabled -> "Tap Join below to also broadcast from this device."
                                else -> "Bluetooth is off system-wide — GPS keeps collecting regardless."
                            },
                            color = Palette.SuccessText.copy(alpha = 0.8f),
                            fontSize = 11.sp,
                        )
                    }
                }
                stage == SessionStage.WithinSession -> SessionNotice(
                    if (bleEnabled) {
                        "This session is within its scheduled window. Tap Collect below to start collecting attendance."
                    } else {
                        "This session is within its scheduled window. Bluetooth is off system-wide — Collect will verify by GPS only."
                    },
                )
                else -> SessionNotice("This session is outside its scheduled window. Collect becomes available once it opens.")
            }

            // Every session has a code, so this is unconditional now — but the live
            // value only exists inside the scheduled window.
            ManualCodeSection(
                status = manualCode,
                collecting = collecting,
                onLoad = onLoadManualCode,
                onPause = onPauseManualCode,
                onResume = onResumeManualCode,
                onRegenerate = onRegenerateManualCode,
            )

            HorizontalDivider(color = Palette.Border, modifier = Modifier.padding(vertical = 14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // "Collect" starts collecting (Within-session → Collecting); once someone is
                // already collecting, the identical action is offered as "Join" to any other
                // device that hasn't started broadcasting yet — see StaffViewModel.collect().
                // Disabled outside the scheduled window: there's nothing to collect yet.
                val (leftText, leftIcon, leftEnabled) = when {
                    stage == SessionStage.Inactive -> Triple("Collect", Icons.Outlined.PlayCircleOutline, false)
                    stage == SessionStage.WithinSession -> Triple("Collect", Icons.Outlined.PlayCircleOutline, true)
                    liveHere -> Triple("Broadcasting", Icons.Outlined.PlayCircleOutline, false)
                    else -> Triple("Join", Icons.Outlined.PersonAdd, true)
                }
                SessionActionButton(
                    text = leftText,
                    icon = leftIcon,
                    tone = SessionActionTone.Success,
                    enabled = leftEnabled,
                    onClick = onCollect,
                    modifier = Modifier.weight(1f),
                )
                if (collecting) {
                    SessionActionButton(
                        text = "Deactivate",
                        icon = Icons.Outlined.PauseCircleOutline,
                        tone = SessionActionTone.Neutral,
                        onClick = onDeactivate,
                        modifier = Modifier.weight(1f),
                    )
                } else {
                    SessionActionButton(
                        text = "Delete",
                        icon = Icons.Outlined.DeleteOutline,
                        tone = SessionActionTone.Danger,
                        onClick = onDelete,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun SessionStatePill(stage: SessionStage) {
    val label = when (stage) {
        SessionStage.Collecting -> "Collecting"
        SessionStage.WithinSession -> "Within session"
        SessionStage.Inactive -> "Inactive"
    }
    val foreground = when (stage) {
        SessionStage.Collecting -> Palette.SuccessText
        SessionStage.WithinSession -> Palette.AccentDark
        SessionStage.Inactive -> Palette.Muted
    }
    val background = when (stage) {
        SessionStage.Collecting -> Palette.SuccessBg
        SessionStage.WithinSession -> Palette.AccentSoft
        SessionStage.Inactive -> Palette.InactiveBg
    }
    Surface(shape = RoundedCornerShape(999.dp), color = background) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp),
        ) {
            Box(Modifier.size(6.dp).background(foreground, CircleShape))
            Spacer(Modifier.width(5.dp))
            Text(label, color = foreground, fontWeight = FontWeight.Bold, fontSize = 11.sp)
        }
    }
}

@Composable
private fun SessionMetaChip(icon: ImageVector, text: String) {
    Surface(shape = RoundedCornerShape(8.dp), color = Palette.Card, border = BorderStroke(1.dp, Palette.Border)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp)) {
            Icon(icon, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(13.dp))
            Spacer(Modifier.width(4.dp))
            Text(text, color = Palette.PillInk, fontWeight = FontWeight.Medium, fontSize = 10.5.sp, maxLines = 1)
        }
    }
}

@Composable
private fun SessionNotice(text: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .background(Palette.InactiveBg, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Icon(Icons.Outlined.AccessTime, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(7.dp))
        Text(text, color = Palette.Muted, fontSize = 11.5.sp, modifier = Modifier.weight(1f))
    }
}

private enum class SessionActionTone { Primary, Neutral, Success, Danger }

@Composable
private fun SessionActionButton(
    text: String,
    icon: ImageVector,
    tone: SessionActionTone,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val container = when (tone) {
        SessionActionTone.Primary -> Palette.Accent
        SessionActionTone.Neutral -> Palette.Card
        SessionActionTone.Success -> Palette.SuccessBg
        SessionActionTone.Danger -> Palette.ErrorBg
    }
    val content = when (tone) {
        SessionActionTone.Primary -> Color.White
        SessionActionTone.Neutral -> Palette.PillInk
        SessionActionTone.Success -> Palette.SuccessText
        SessionActionTone.Danger -> Palette.DangerText
    }
    val border = when (tone) {
        SessionActionTone.Primary -> Palette.Accent
        SessionActionTone.Neutral -> Palette.InputBorder
        SessionActionTone.Success -> Palette.SuccessBorder
        SessionActionTone.Danger -> Palette.ErrorBorder
    }
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = if (enabled) container else Palette.InactiveBg,
        contentColor = if (enabled) content else Palette.Muted,
        border = BorderStroke(1.dp, if (enabled) border else Palette.Border),
    ) {
        Row(
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 11.dp),
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(17.dp))
            Spacer(Modifier.width(6.dp))
            Text(text, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        }
    }
}

@Composable
private fun ManualCodeSection(
    status: ManualCodeStatusDto?,
    /** Reloads the moment a session enters Collecting, instead of waiting for whatever
     *  unrelated recomposition happens to come next — see the call site for why this
     *  couldn't just key on Unit. */
    collecting: Boolean,
    onLoad: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onRegenerate: () -> Unit,
) {
    LaunchedEffect(collecting) { onLoad() }

    Column(
        Modifier
            .padding(top = 12.dp)
            .fillMaxWidth()
            .background(Color(0xFFF8F7FF), RoundedCornerShape(14.dp))
            .border(1.dp, Palette.AccentSoft, RoundedCornerShape(14.dp))
            .padding(13.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Password, contentDescription = null, tint = Palette.AccentDark, modifier = Modifier.size(17.dp))
            Spacer(Modifier.width(7.dp))
            Text("Attendance code", fontWeight = FontWeight.Bold, fontSize = 12.5.sp, color = Palette.Ink)
        }
        Text(
            "Read this out when a student can't be verified automatically.",
            color = Palette.Muted,
            fontSize = 11.sp,
            modifier = Modifier.padding(top = 2.dp),
        )
        Spacer(Modifier.height(9.dp))

        if (status == null) {
            Text("Loading code…", color = Palette.Muted, fontSize = 12.sp)
            return@Column
        }
        if (status.running != true) {
            Text("The code appears during the scheduled session window.", color = Palette.Muted, fontSize = 12.sp)
            return@Column
        }
        val code = status.code ?: return@Column

        Row(
            Modifier
                .fillMaxWidth()
                .background(Palette.Card, RoundedCornerShape(11.dp))
                .border(1.dp, Palette.Border, RoundedCornerShape(11.dp))
                .padding(horizontal = 13.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    code.chunked(4).joinToString("  "),
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 24.sp,
                    letterSpacing = 3.sp,
                    color = Palette.AccentDark,
                )
                val statusText = when {
                    status.paused == true -> "Rotation paused"
                    status.rotationMode == "interval" && status.rotatesIn != null -> "Next rotation in ${status.rotatesIn}s"
                    else -> "Current attendance code"
                }
                Text(
                    statusText,
                    color = if (status.paused == true) Palette.WarnText else Palette.Muted,
                    fontSize = 11.sp,
                )
            }
            IconButton(onClick = onRegenerate) {
                Icon(Icons.Outlined.Repeat, contentDescription = "New code", tint = Palette.AccentDark)
            }
        }
        if (status.rotationMode == "interval") {
            Spacer(Modifier.height(9.dp))
            SessionActionButton(
                text = if (status.paused == true) "Resume rotation" else "Pause rotation",
                icon = if (status.paused == true) Icons.Outlined.PlayCircleOutline else Icons.Outlined.PauseCircleOutline,
                tone = if (status.paused == true) SessionActionTone.Success else SessionActionTone.Neutral,
                onClick = if (status.paused == true) onResume else onPause,
            )
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
            if (state.lecturersHasMore) {
                item { LoadMoreRow(loading = state.lecturersLoadingMore, onClick = vm::loadMoreLecturers) }
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
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
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
        if (id in selectedIds) return
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
                    "Assign at least 1 lecturer (${selectedIds.size} selected)",
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
                enabled = selectedIds.isNotEmpty(),
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Manual pagination trigger shown at the bottom of a long admin list. */
@Composable
private fun LoadMoreRow(loading: Boolean, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = Palette.Accent)
        } else {
            PillButton("Load more", onClick = onClick, tone = PillTone.Accent)
        }
    }
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
                if (role == "admin") "Administrator" else "Lecturer",
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
