package lk.ac.pdn.eng.feats.ui.student

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import lk.ac.pdn.eng.feats.data.net.RunningCourseDto
import lk.ac.pdn.eng.feats.ui.components.AppCard
import lk.ac.pdn.eng.feats.ui.components.AppFooter
import lk.ac.pdn.eng.feats.ui.components.AppTextField
import lk.ac.pdn.eng.feats.ui.components.ErrorBanner
import lk.ac.pdn.eng.feats.ui.theme.AppShapes
import lk.ac.pdn.eng.feats.ui.theme.Palette

/**
 * Optional: picking courses ahead of time so they pin to the top of the
 * check-in search while running, without typing. Lists every unarchived
 * course campus-wide — unlike the check-in picker, session state plays no
 * part here.
 *
 * Reached from LectureEntryScreen's "Register your courses" link, not as a
 * NavHost destination — same in-composable toggle pattern that screen uses.
 */
@Composable
fun CourseRegistrationScreen(
    onBack: () -> Unit,
    vm: CourseRegistrationViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()
    var query by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(12.dp))
            AppCard(Modifier.fillMaxWidth().widthIn(max = 480.dp)) {
                Column(Modifier.padding(22.dp)) {
                    TextButton(onClick = onBack, contentPadding = PaddingValues(0.dp)) {
                        Text("← Back", color = Palette.Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Register your courses",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.ExtraBold,
                    )
                    Text(
                        "Optional. Register for your courses to easily find them.",
                        color = Palette.Muted,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(top = 4.dp),
                    )

                    state.error?.let {
                        Spacer(Modifier.height(14.dp))
                        ErrorBanner(it)
                    }

                    Spacer(Modifier.height(18.dp))
                    AppTextField(
                        query,
                        { query = it },
                        "Search all courses",
                        placeholder = "Course code or name…",
                    )
                    Spacer(Modifier.height(12.dp))

                    // At rest (no query), only registered courses show — this screen is for
                    // managing that set, not for browsing the whole catalog. Searching looks
                    // across every unarchived course, registered or not, so a course can
                    // actually be added.
                    val trimmed = query.trim()
                    val visible = if (trimmed.isBlank()) {
                        state.courses.filter { state.registeredIds.contains(it.id) }
                    } else {
                        state.courses.filter {
                            "${it.code} ${it.name} ${it.batch}".contains(trimmed, ignoreCase = true)
                        }
                    }

                    when {
                        state.loading -> CircularProgressIndicator(color = Palette.Accent)
                        visible.isEmpty() -> Text(
                            if (trimmed.isBlank()) {
                                "You haven't registered any courses yet. Search to add one."
                            } else {
                                "No course matches \"$trimmed\"."
                            },
                            color = Palette.Muted,
                            fontSize = 12.sp,
                        )
                        else -> visible.forEach { course ->
                            CourseToggleRow(
                                course = course,
                                registered = state.registeredIds.contains(course.id),
                                pending = state.pendingId == course.id,
                                onToggle = { vm.toggle(course.id) },
                            )
                            Spacer(Modifier.height(8.dp))
                        }
                    }
                }
            }
            Spacer(Modifier.weight(1f))
        }
        AppFooter()
    }
}

@Composable
private fun CourseToggleRow(
    course: RunningCourseDto,
    registered: Boolean,
    pending: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(AppShapes.Panel)
            .background(if (registered) Palette.ChipBg else Palette.InactiveBg)
            .border(
                width = if (registered) 2.dp else 1.dp,
                color = if (registered) Palette.Accent else Palette.Border,
                shape = AppShapes.Panel,
            )
            .clickable(enabled = !pending, onClick = onToggle)
            .padding(14.dp)
            .alpha(if (pending) 0.6f else 1f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(course.code, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, color = Palette.Ink)
            Text(course.name, color = Palette.Muted, fontSize = 12.sp)
            Text(course.batch, color = Palette.Muted, fontSize = 11.sp)
        }
        Box(
            Modifier
                .size(22.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(if (registered) Palette.Accent else Color.Transparent)
                .border(
                    width = if (registered) 0.dp else 2.dp,
                    color = Palette.InputBorder,
                    shape = RoundedCornerShape(11.dp),
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (pending) {
                CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 2.dp, color = Palette.Accent)
            } else if (registered) {
                Text("✓", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}
