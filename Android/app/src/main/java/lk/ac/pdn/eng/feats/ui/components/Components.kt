package lk.ac.pdn.eng.feats.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import lk.ac.pdn.eng.feats.R
import lk.ac.pdn.eng.feats.ui.theme.AppShapes
import lk.ac.pdn.eng.feats.ui.theme.Palette

/** Full-screen photographic background with the soft wash overlay from the web app. */
@Composable
fun AppBackground(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        Image(
            painter = painterResource(R.drawable.app_background),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            Modifier
                .fillMaxSize()
                .background(Color(0xFFF7F8FA).copy(alpha = 0.58f)),
        )
        content()
    }
}

/** White rounded card matching .auth-card / .student-panel. */
@Composable
fun AppCard(
    modifier: Modifier = Modifier,
    shape: RoundedCornerShape = AppShapes.Card,
    border: Color = Palette.Border,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = shape,
        color = Palette.Card,
        contentColor = Palette.Ink,
        shadowElevation = 8.dp,
        border = BorderStroke(1.dp, border),
    ) { content() }
}

enum class ButtonVariant { Accent, Bluetooth }

/** Full-width gradient primary button (.primary-btn / .primary-btn--bt). */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    variant: ButtonVariant = ButtonVariant.Accent,
) {
    val gradient = when (variant) {
        ButtonVariant.Accent -> Brush.horizontalGradient(
            listOf(Palette.GradIndigo, Palette.Accent, Palette.GradViolet),
        )
        ButtonVariant.Bluetooth -> Brush.horizontalGradient(
            listOf(Palette.BtDeep, Palette.BtMid, Palette.BtLight),
        )
    }
    val clickable = enabled && !loading
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(AppShapes.Pill)
            .background(if (clickable) gradient else Brush.horizontalGradient(listOf(Palette.Muted, Palette.Muted)))
            .clickable(enabled = clickable, onClick = onClick)
            .padding(vertical = 14.dp, horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    color = Color.White,
                    strokeWidth = 2.dp,
                )
                Spacer(Modifier.width(10.dp))
            }
            Text(
                text = text,
                color = Color.White,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
            )
        }
    }
}

enum class PillTone { Neutral, Success, Warning, Danger, Accent }

/** Small pill button (.pill-btn and tonal variants). */
@Composable
fun PillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: PillTone = PillTone.Neutral,
    enabled: Boolean = true,
) {
    val (bg, fg) = when (tone) {
        PillTone.Neutral -> Palette.PillBg to Palette.PillInk
        PillTone.Success -> Color(0xFFDCFCE7) to Color(0xFF166534)
        PillTone.Warning -> Palette.WarnBg to Palette.WarnText
        PillTone.Danger -> Palette.DangerBg to Palette.DangerText
        PillTone.Accent -> Palette.ChipBg to Palette.AccentDark
    }
    Box(
        modifier = modifier
            .clip(AppShapes.Pill)
            .background(if (enabled) bg else Palette.PillBg.copy(alpha = 0.5f))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (enabled) fg else Palette.Muted, fontWeight = FontWeight.Bold, fontSize = 13.sp)
    }
}

/** Labelled outlined text field (.field-label + .input). */
@Composable
fun AppTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    keyboardType: KeyboardType = KeyboardType.Text,
    leadingIcon: (@Composable () -> Unit)? = null,
) {
    Column(modifier) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = Palette.Ink,
            modifier = Modifier.padding(bottom = 6.dp),
        )
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            enabled = enabled,
            singleLine = singleLine,
            placeholder = placeholder?.let { { Text(it, color = Palette.Muted) } },
            leadingIcon = leadingIcon,
            shape = AppShapes.Input,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Palette.Card,
                unfocusedContainerColor = Palette.Card,
                disabledContainerColor = Palette.InactiveBg,
                focusedIndicatorColor = Palette.Accent,
                unfocusedIndicatorColor = Palette.InputBorder,
                cursorColor = Palette.Accent,
            ),
        )
    }
}

/** Inline error block (.error). */
@Composable
fun ErrorBanner(message: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = AppShapes.Option,
        color = Palette.ErrorBg,
        border = BorderStroke(1.dp, Palette.ErrorBorder),
    ) {
        Text(
            message,
            color = Palette.ErrorText,
            fontSize = 14.sp,
            modifier = Modifier.padding(horizontal = 13.dp, vertical = 10.dp),
        )
    }
}

/** Uppercase kicker (.section-kicker). */
@Composable
fun SectionKicker(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = Palette.AccentDark,
        modifier = modifier,
    )
}

/** Centered loading state (LoadingGate). */
@Composable
fun LoadingGate(message: String = "Please wait.") {
    Column(
        Modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CircularProgressIndicator(color = Palette.Accent)
        Text("Checking session…", style = MaterialTheme.typography.titleMedium)
        Text(message, color = Palette.Muted, fontSize = 14.sp)
    }
}

/** Full-screen, non-dismissible block shown when the server reports this build is too old. */
@Composable
fun UpdateRequiredScreen(onUpdate: () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("⬆️", fontSize = 40.sp)
            Text("Update required", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(
                "A newer version of this app is required to continue. Please update to keep using it.",
                color = Palette.Muted,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(4.dp))
            PrimaryButton(text = "Update now", onClick = onUpdate)
        }
    }
}

/** Success confirmation block (.success-icon + .status-wrap). */
@Composable
fun SuccessState(title: String, subtitle: String) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            Modifier
                .size(64.dp)
                .clip(CircleShape)
                .background(Brush.linearGradient(listOf(Palette.SuccessBg, Palette.SuccessBg2))),
            contentAlignment = Alignment.Center,
        ) {
            Text("✓", color = Palette.SuccessText, fontWeight = FontWeight.ExtraBold, fontSize = 26.sp)
        }
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(subtitle, color = Palette.Muted, fontSize = 14.sp)
    }
}

/** Empty-state block (.student-empty). */
@Composable
fun EmptyState(icon: String, title: String, text: String, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(vertical = 28.dp, horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .size(56.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Brush.linearGradient(listOf(Color(0xFFEEF2FF), Color(0xFFE0E7FF)))),
            contentAlignment = Alignment.Center,
        ) { Text(icon, fontSize = 22.sp) }
        Text(title, style = MaterialTheme.typography.titleMedium, color = Palette.Ink)
        Text(
            text,
            color = Palette.Muted,
            fontSize = 14.sp,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** "Live" / "Paused" badge on session cards (.session-live-badge). */
@Composable
fun StatusBadge(text: String, tone: PillTone) {
    val (bg, fg) = when (tone) {
        PillTone.Warning -> Palette.WarnBg to Palette.WarnText
        PillTone.Success -> Palette.SuccessBg to Palette.SuccessText
        else -> Palette.ChipBg to Palette.AccentDark
    }
    Box(
        Modifier.clip(RoundedCornerShape(6.dp)).background(bg).padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(text.uppercase(), color = fg, fontWeight = FontWeight.ExtraBold, fontSize = 10.sp, letterSpacing = 0.5.sp)
    }
}

/** Monospace device-name badge (.bt-device-badge). */
@Composable
fun DeviceBadge(name: String, modifier: Modifier = Modifier) {
    Box(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Palette.BtBadgeBg)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        Text(
            name,
            color = Palette.BtDeep,
            fontWeight = FontWeight.Bold,
            fontSize = 12.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Footer line (SiteFooter). */
@Composable
fun AppFooter(modifier: Modifier = Modifier) {
    Text(
        "Copyright © 2026 Computing Centre - Faculty of Engineering - University of Peradeniya. All Rights Reserved.",
        color = Palette.Muted,
        fontSize = 11.5.sp,
        fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
        lineHeight = 16.sp,
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
    )
}
