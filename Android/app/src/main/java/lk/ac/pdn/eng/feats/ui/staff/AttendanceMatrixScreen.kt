package lk.ac.pdn.eng.feats.ui.staff

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import lk.ac.pdn.eng.feats.ui.components.EmptyState
import lk.ac.pdn.eng.feats.ui.components.ErrorBanner
import lk.ac.pdn.eng.feats.ui.components.LoadingGate
import lk.ac.pdn.eng.feats.ui.components.PillButton
import lk.ac.pdn.eng.feats.ui.components.PillTone
import lk.ac.pdn.eng.feats.ui.theme.AppShapes
import lk.ac.pdn.eng.feats.ui.theme.Palette

@Composable
fun AttendanceMatrixScreen(
    courseId: String,
    onBack: () -> Unit,
    vm: MatrixViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    LaunchedEffect(courseId) { vm.load(courseId) }

    val course = state.data?.course
    val sessions = state.data?.sessions.orEmpty()
    val rows = state.data?.rows.orEmpty()
    val hasTable = state.error == null && sessions.isNotEmpty()

    Column(Modifier.fillMaxSize()) {
        // Toolbar
        Column(
            Modifier.fillMaxWidth().background(Palette.Card.copy(alpha = 0.92f)).padding(16.dp),
        ) {
            Text("Attendance table", style = MaterialTheme.typography.titleLarge)
            Text(
                course?.let {
                    "${it.code}${if (!it.batch.isNullOrBlank()) " · ${it.batch}" else ""} · ${it.name}"
                } ?: "Course report",
                color = Palette.Muted, fontSize = 13.sp,
            )
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillButton("← Dashboard", onClick = onBack, tone = PillTone.Neutral)
                if (hasTable) {
                    PillButton("Share CSV", tone = PillTone.Accent, onClick = {
                        val csv = vm.toCsv()
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "text/csv"
                            putExtra(Intent.EXTRA_SUBJECT, "Attendance ${course?.code ?: ""}")
                            putExtra(Intent.EXTRA_TEXT, csv)
                        }
                        context.startActivity(Intent.createChooser(send, "Share attendance CSV"))
                    })
                }
            }
        }

        when {
            state.loading -> LoadingGate("Fetching attendance data.")
            state.error != null -> ErrorBanner(state.error!!, Modifier.padding(16.dp))
            !hasTable -> EmptyState(
                "▦",
                "No attendance data yet",
                "After students mark attendance for this course, columns (date and session hours) appear here.",
                Modifier.padding(16.dp),
            )
            else -> {
                val vScroll = rememberScrollState()
                val hScroll = rememberScrollState()
                Box(Modifier.fillMaxSize().padding(12.dp)) {
                    Column(
                        Modifier
                            .fillMaxSize()
                            .background(Palette.Card, AppShapes.Panel)
                            .verticalScroll(vScroll),
                    ) {
                        Column(Modifier.horizontalScroll(hScroll)) {
                            // Header
                            Row {
                                HeaderCell("Student ID", width = 140.dp)
                                sessions.forEach { HeaderCell(it.label ?: "", width = 120.dp) }
                            }
                            rows.forEach { row ->
                                Row {
                                    BodyCell(row.displayId ?: "", width = 140.dp, bold = true)
                                    sessions.forEach { s ->
                                        val present = row.attendance?.get(s.id) == true
                                        Box(
                                            Modifier.width(120.dp).padding(vertical = 8.dp),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            if (present) {
                                                Box(
                                                    Modifier.background(Palette.SuccessBg2, RoundedCornerShape(999.dp))
                                                        .padding(horizontal = 10.dp, vertical = 3.dp),
                                                ) {
                                                    Text("P", color = Palette.SuccessText, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp)
                                                }
                                            } else {
                                                Text("—", color = Palette.Muted, fontWeight = FontWeight.SemiBold)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HeaderCell(text: String, width: androidx.compose.ui.unit.Dp) {
    Box(
        Modifier.width(width).background(Palette.InactiveBg).padding(horizontal = 8.dp, vertical = 10.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            text.uppercase(),
            color = Palette.Muted,
            fontWeight = FontWeight.Bold,
            fontSize = 11.sp,
            letterSpacing = 0.5.sp,
        )
    }
}

@Composable
private fun BodyCell(text: String, width: androidx.compose.ui.unit.Dp, bold: Boolean = false) {
    Box(
        Modifier.width(width).padding(horizontal = 8.dp, vertical = 8.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(text, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal, fontSize = 13.sp)
    }
}
