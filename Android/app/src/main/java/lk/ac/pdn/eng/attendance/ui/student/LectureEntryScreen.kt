package lk.ac.pdn.eng.attendance.ui.student

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import lk.ac.pdn.eng.attendance.ui.components.AppCard
import lk.ac.pdn.eng.attendance.ui.components.AppFooter
import lk.ac.pdn.eng.attendance.ui.components.EmptyState
import lk.ac.pdn.eng.attendance.ui.components.ErrorBanner
import lk.ac.pdn.eng.attendance.ui.components.PrimaryButton
import lk.ac.pdn.eng.attendance.ui.components.ButtonVariant
import lk.ac.pdn.eng.attendance.ui.components.SuccessState
import lk.ac.pdn.eng.attendance.ui.theme.AppShapes
import lk.ac.pdn.eng.attendance.ui.theme.Palette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LectureEntryScreen(
    email: String,
    onLogout: () -> Unit,
    vm: LectureEntryViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()
    val context = LocalContext.current

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        vm.onPermissionResult(result.values.all { it })
    }

    fun onScanClick() {
        if (BlePermissions.hasScan(context)) {
            vm.startScan()
        } else {
            permissionLauncher.launch(BlePermissions.scanPermissions())
        }
    }

    Column(Modifier.fillMaxSize()) {
        StudentTopBar(email = email, onLogout = onLogout)
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            AppCard(Modifier.fillMaxWidth().widthIn(max = 480.dp)) {
                Column(Modifier.padding(20.dp)) {
                    if (state.recorded) {
                        SuccessState(
                            title = "Attendance recorded",
                            subtitle = "Your Bluetooth attendance was saved for this session.",
                        )
                    } else {
                        Text("Lecture attendance", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "Select your running course, then scan for the classroom Bluetooth signal to mark attendance.",
                            color = Palette.Muted,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }

                    state.error?.let {
                        Spacer(Modifier.height(12.dp))
                        ErrorBanner(it)
                    }

                    Spacer(Modifier.height(16.dp))

                    if (state.courses.isEmpty() && state.error == null) {
                        EmptyState(
                            icon = "📅",
                            title = "No lectures running right now",
                            text = "When a session is active for your course it appears here automatically. This list refreshes every 10 seconds.",
                        )
                    } else if (!state.recorded) {
                        val selected = state.courses.firstOrNull { it.id == state.selectedCourseId }
                        var expanded by remember { mutableStateOf(false) }
                        Text("Course", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(bottom = 6.dp))
                        ExposedDropdownMenuBox(
                            expanded = expanded,
                            onExpandedChange = { if (!state.busy) expanded = it },
                        ) {
                            OutlinedTextField(
                                value = selected?.let { "${it.code} – ${it.name}" } ?: "",
                                onValueChange = {},
                                readOnly = true,
                                placeholder = { Text("Choose a running course", color = Palette.Muted) },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                                shape = AppShapes.Input,
                                enabled = !state.busy,
                                modifier = Modifier.fillMaxWidth().menuAnchor(),
                                colors = TextFieldDefaults.colors(
                                    focusedContainerColor = Palette.Card,
                                    unfocusedContainerColor = Palette.Card,
                                    focusedIndicatorColor = Palette.Accent,
                                    unfocusedIndicatorColor = Palette.InputBorder,
                                ),
                            )
                            ExposedDropdownMenu(
                                expanded = expanded,
                                onDismissRequest = { expanded = false },
                            ) {
                                state.courses.forEach { course ->
                                    DropdownMenuItem(
                                        text = {
                                            Column {
                                                Text(course.code ?: "", fontWeight = FontWeight.Bold)
                                                Text(course.name ?: "", color = Palette.Muted, fontSize = 13.sp)
                                            }
                                        },
                                        onClick = {
                                            expanded = false
                                            vm.selectCourse(course.id)
                                        },
                                    )
                                }
                            }
                        }

                        Spacer(Modifier.height(16.dp))

                        if (state.scanning) {
                            ScanStatus(label = state.phase.label)
                            Spacer(Modifier.height(10.dp))
                        }

                        PrimaryButton(
                            text = if (state.scanning) state.phase.label else ScanPhase.Idle.label,
                            onClick = ::onScanClick,
                            variant = ButtonVariant.Bluetooth,
                            loading = state.scanning,
                            enabled = !state.busy && state.selectedCourseId != null,
                        )
                    }
                }
            }
            Spacer(Modifier.height(20.dp))
            AppFooter()
        }
    }
}

@Composable
private fun ScanStatus(label: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Palette.BtBadgeBg, AppShapes.Panel)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("📶", fontSize = 20.sp)
        Spacer(Modifier.size(10.dp))
        Text(label, color = Palette.BtDeep, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
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
            Text("Mark attendance", fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, color = Palette.Ink)
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
