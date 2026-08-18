package lk.ac.pdn.eng.feats.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/*
 * The React app uses Inter with a system fallback. Inter is not bundled here, so
 * we use the platform default sans-serif; weights and sizes follow the web scale.
 * (Drop Inter .ttf files into res/font and swap FontFamily.Default to use it.)
 */
private val Sans = FontFamily.Default

val AppTypography = Typography(
    // Card / large title (1.5rem, 800, tight)
    headlineSmall = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.ExtraBold, fontSize = 24.sp, letterSpacing = (-0.5).sp,
    ),
    // Section title (1.35rem, 800)
    titleLarge = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.ExtraBold, fontSize = 21.sp, letterSpacing = (-0.4).sp,
    ),
    // Card title in cards
    titleMedium = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 18.sp,
    ),
    // List item primary
    titleSmall = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 15.sp,
    ),
    // Subtitle / lead (1.05rem, 500)
    bodyLarge = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 24.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 21.sp,
    ),
    // Small / hint
    bodySmall = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 12.5.sp, lineHeight = 18.sp,
    ),
    // Field label (0.9rem, 600)
    labelLarge = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
    ),
    // Button text (0.95rem, 700)
    labelMedium = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 14.sp,
    ),
    // Kicker (uppercase, 800)
    labelSmall = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.ExtraBold, fontSize = 11.sp, letterSpacing = 1.2.sp,
    ),
)
