package lk.ac.pdn.eng.feats.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/** Radii mirror the React tokens: --radius-lg 22, --radius-md 16, inputs 14, pill 999. */
object AppShapes {
    val Card = RoundedCornerShape(22.dp)
    val Panel = RoundedCornerShape(16.dp)
    val Input = RoundedCornerShape(14.dp)
    val Menu = RoundedCornerShape(12.dp)
    val Option = RoundedCornerShape(10.dp)
    val Pill = RoundedCornerShape(999.dp)
}

val MaterialShapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp),
    extraLarge = RoundedCornerShape(28.dp),
)
