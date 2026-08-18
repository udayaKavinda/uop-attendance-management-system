package lk.ac.pdn.eng.feats.ui

enum class AutomaticPath { Bluetooth, Gps }

/** Pure mode decisions shared by UI flows and covered without Android instrumentation. */
object VerificationPolicy {
    fun availablePaths(mode: String?, canBluetooth: Boolean, canGps: Boolean): Set<AutomaticPath> =
        when (mode) {
            "geofence" -> setOfNotNull(AutomaticPath.Gps.takeIf { canGps })
            "both" -> setOfNotNull(
                AutomaticPath.Bluetooth.takeIf { canBluetooth },
                AutomaticPath.Gps.takeIf { canGps },
            )
            else -> setOfNotNull(AutomaticPath.Bluetooth.takeIf { canBluetooth })
        }
}
