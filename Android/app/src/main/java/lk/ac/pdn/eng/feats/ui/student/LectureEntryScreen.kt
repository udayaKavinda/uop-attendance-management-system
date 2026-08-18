package lk.ac.pdn.eng.feats.ui.student

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import lk.ac.pdn.eng.feats.ble.BlePermissions
import lk.ac.pdn.eng.feats.location.LocationPermissions
import lk.ac.pdn.eng.feats.ui.components.AppCard
import lk.ac.pdn.eng.feats.ui.components.AppFooter
import lk.ac.pdn.eng.feats.ui.components.AppTextField
import lk.ac.pdn.eng.feats.ui.components.EmptyState
import lk.ac.pdn.eng.feats.ui.components.ErrorBanner
import lk.ac.pdn.eng.feats.ui.components.PrimaryButton
import lk.ac.pdn.eng.feats.ui.components.ButtonVariant
import lk.ac.pdn.eng.feats.ui.components.SuccessState
import lk.ac.pdn.eng.feats.ui.theme.AppShapes
import lk.ac.pdn.eng.feats.ui.theme.Palette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LectureEntryScreen(
    email: String,
    onLogout: () -> Unit,
    vm: LectureEntryViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()
    val context = LocalContext.current

    // Keep the display awake while scanning: a screen timeout would otherwise
    // silently stop BLE scan callbacks and surface as a false "no signal" error.
    val view = LocalView.current
    DisposableEffect(state.scanning) {
        view.keepScreenOn = state.scanning
        onDispose { view.keepScreenOn = false }
    }

    // Bluetooth-side preflight — unchanged from the original Bluetooth-only flow;
    // used as-is for "bluetooth" mode and as the first half of "both".
    fun proceedAfterBlePermissions(enableBt: () -> Unit) {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        when {
            adapter == null ->
                vm.reportScanBlocked("Bluetooth is not available on this device.")
            !adapter.isEnabled -> enableBt()
            !BlePermissions.isLocationServicesEnabled(context) -> {
                vm.reportScanBlocked(
                    "Location is turned off. Enable it to scan for the classroom signal.",
                )
                context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            }
            else -> {
                val blocker = BlePermissions.scanBlocker(context)
                if (blocker == null) vm.startScan() else vm.reportScanBlocked(blocker)
            }
        }
    }

    val enableBtLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { _ ->
        val blocker = BlePermissions.scanBlocker(context)
        if (blocker == null) vm.startScan() else vm.reportScanBlocked(blocker)
    }

    // Permission request covers Bluetooth alone ("bluetooth" mode) or Bluetooth +
    // location together ("both" mode, so the GPS fallback never needs a second
    // mid-flow prompt). "geofence" mode uses its own launcher below instead.
    val blePermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        if (result.values.all { it }) {
            proceedAfterBlePermissions {
                enableBtLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
            }
        } else if (result[android.Manifest.permission.ACCESS_FINE_LOCATION] == false && BlePermissions.hasScan(context)) {
            vm.onLocationPermissionDenied()
        } else {
            vm.onPermissionDenied()
        }
    }

    val locationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        if (LocationPermissions.hasFineLocation(context)) vm.startScan() else vm.onLocationPermissionDenied()
    }

    fun onScanClick() {
        when (state.verification) {
            "geofence" -> {
                if (LocationPermissions.hasFineLocation(context)) {
                    vm.startScan()
                } else {
                    locationPermissionLauncher.launch(LocationPermissions.permissions())
                }
            }
            "both" -> {
                val needed = BlePermissions.scanPermissions() + LocationPermissions.permissions()
                if (BlePermissions.hasAll(context, needed)) {
                    proceedAfterBlePermissions {
                        enableBtLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
                    }
                } else {
                    blePermissionLauncher.launch(needed)
                }
            }
            else -> {
                if (BlePermissions.hasScan(context)) {
                    proceedAfterBlePermissions {
                        enableBtLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
                    }
                } else {
                    blePermissionLauncher.launch(BlePermissions.scanPermissions())
                }
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        StudentTopBar(email = email, onLogout = onLogout)
        // Weighted scroll region: card stays vertically centred on tall screens;
        // scrolls when content overflows on small phones. Footer stays pinned below.
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f))
            AppCard(Modifier.fillMaxWidth().widthIn(max = 480.dp)) {
                Column(Modifier.padding(20.dp)) {
                    if (state.recorded) {
                        SuccessState(
                            title = "Attendance recorded",
                            subtitle = "Your attendance was saved for this session.",
                        )
                        Spacer(Modifier.height(16.dp))
                        PrimaryButton(
                            text = "Mark another course",
                            onClick = vm::resetForAnotherCourse,
                        )
                    } else {
                        Text("Lecture attendance", style = MaterialTheme.typography.titleMedium)
                        Text(
                            when (state.verification) {
                                "geofence" -> "Select your running course, then verify your location to mark attendance."
                                "both" -> "Select your running course, then verify via Bluetooth or your location."
                                else -> "Select your running course, then scan for the classroom Bluetooth signal to mark attendance."
                            },
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

                        val idleLabel = when (state.verification) {
                            "geofence" -> "📍  Verify My Location"
                            "both" -> "📡  Verify Attendance"
                            else -> ScanPhase.Idle.label
                        }
                        PrimaryButton(
                            text = if (state.scanning) state.phase.label else idleLabel,
                            onClick = ::onScanClick,
                            variant = ButtonVariant.Bluetooth,
                            loading = state.scanning,
                            enabled = !state.busy && state.selectedCourseId != null,
                        )

                        // Lecturer-controlled fallback — only offered when the running
                        // session has it enabled; automatic Bluetooth scanning above is
                        // unaffected either way.
                        if (selected?.manualCodeEnabled == true) {
                            Spacer(Modifier.height(18.dp))
                            ManualCodeEntry(busy = state.busy, onSubmit = vm::submitManualCode)
                        }
                    }
                }
            }
            Spacer(Modifier.weight(1f))
        }
        AppFooter()
    }
}

/** Fallback for a student whose device can't complete the automatic BLE scan. */
@Composable
private fun ManualCodeEntry(busy: Boolean, onSubmit: (String) -> Unit) {
    var code by remember { mutableStateOf("") }
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f).height(1.dp).background(Palette.Border))
            Text(
                "  OR  ",
                color = Palette.Muted,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Box(Modifier.weight(1f).height(1.dp).background(Palette.Border))
        }
        Spacer(Modifier.height(14.dp))
        AppTextField(
            value = code,
            onValueChange = { new -> if (new.length <= 8 && new.all(Char::isDigit)) code = new },
            label = "Attendance code",
            placeholder = "8-digit code from your lecturer",
            enabled = !busy,
            keyboardType = KeyboardType.Number,
        )
        Spacer(Modifier.height(10.dp))
        PrimaryButton(
            text = "Submit code",
            onClick = { onSubmit(code) },
            enabled = !busy && code.length == 8,
            loading = busy && code.length == 8,
        )
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
