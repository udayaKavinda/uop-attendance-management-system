package lk.ac.pdn.eng.feats.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColors = lightColorScheme(
    primary = Palette.Accent,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    primaryContainer = Palette.AccentSoft,
    onPrimaryContainer = Palette.AccentDark,
    secondary = Palette.UopGold,
    onSecondary = androidx.compose.ui.graphics.Color.White,
    background = Palette.AppBg,
    onBackground = Palette.Ink,
    surface = Palette.Card,
    onSurface = Palette.Ink,
    surfaceVariant = Palette.InactiveBg,
    onSurfaceVariant = Palette.Muted,
    outline = Palette.Border,
    outlineVariant = Palette.InputBorder,
    error = Palette.ErrorText,
    onError = androidx.compose.ui.graphics.Color.White,
    errorContainer = Palette.ErrorBg,
    onErrorContainer = Palette.ErrorText,
)

/** App-wide Material 3 theme. Light only, to match the web app. */
@Composable
fun AttendanceTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        typography = AppTypography,
        shapes = MaterialShapes,
        content = content,
    )
}
