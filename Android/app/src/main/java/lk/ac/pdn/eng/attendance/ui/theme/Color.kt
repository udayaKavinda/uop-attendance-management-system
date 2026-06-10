package lk.ac.pdn.eng.attendance.ui.theme

import androidx.compose.ui.graphics.Color

/** Palette mirrored from the React app (src/index.css :root tokens). */
object Palette {
    val AppBg = Color(0xFFF7F8FA)
    val Card = Color(0xFFFFFFFF)
    val Ink = Color(0xFF111827)
    val Muted = Color(0xFF6B7280)
    val Border = Color(0xFFE8EAEF)

    val Accent = Color(0xFF7B61FF)
    val AccentDark = Color(0xFF5B4CDB)
    val AccentSoft = Color(0x1F7B61FF)   // rgba(123,97,255,0.12)
    val AccentGlow = Color(0x387B61FF)   // rgba(123,97,255,0.22)

    val UopMaroon = Color(0xFF7A1414)
    val UopGold = Color(0xFFC9A227)

    // Gradient stops for the primary button (95deg #6366f1 -> #7b61ff -> #8b5cf6)
    val GradIndigo = Color(0xFF6366F1)
    val GradViolet = Color(0xFF8B5CF6)

    // Bluetooth button gradient (#0369a1 -> #0284c7 -> #38bdf8)
    val BtDeep = Color(0xFF0369A1)
    val BtMid = Color(0xFF0284C7)
    val BtLight = Color(0xFF38BDF8)
    val BtBadgeBg = Color(0xFFE0F2FE)
    val BtBadgeBorder = Color(0xFFBAE6FD)

    // Success
    val SuccessText = Color(0xFF047857)
    val SuccessBg = Color(0xFFD1FAE5)
    val SuccessBg2 = Color(0xFFA7F3D0)
    val SuccessBorder = Color(0xFF86EFAC)

    // Warning
    val WarnText = Color(0xFF92400E)
    val WarnBg = Color(0xFFFEF3C7)
    val WarnBg2 = Color(0xFFFDE68A)

    // Danger / error
    val DangerText = Color(0xFF991B1B)
    val DangerBg = Color(0xFFFEE2E2)
    val ErrorText = Color(0xFFB42318)
    val ErrorBg = Color(0xFFFEF3F2)
    val ErrorBorder = Color(0xFFFECDCA)

    // Surfaces / states
    val EnabledBg = Color(0xFFF0FDF4)
    val EnabledBorder = Color(0xFFBBF7D0)
    val ActiveBg = Color(0xFFECFDF3)
    val InactiveBg = Color(0xFFF9FAFB)
    val RunningBorder = Color(0xFFC4B5FD)
    val PillBg = Color(0xFFE8EAEF)
    val PillInk = Color(0xFF374151)
    val InputBorder = Color(0xFFD8DCE6)
    val ChipBg = Color(0xFFF5F3FF)
    val ChipInk = Color(0xFF4C1D95)
}
