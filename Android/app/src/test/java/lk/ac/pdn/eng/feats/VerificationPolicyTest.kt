package lk.ac.pdn.eng.feats

import lk.ac.pdn.eng.feats.ui.AutomaticPath
import lk.ac.pdn.eng.feats.ui.VerificationPolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class VerificationPolicyTest {
    @Test fun bothUsesEveryAvailablePath() {
        assertEquals(
            setOf(AutomaticPath.Bluetooth, AutomaticPath.Gps),
            VerificationPolicy.availablePaths("both", canBluetooth = true, canGps = true),
        )
    }

    @Test fun bothStillUsesGpsWithoutBluetooth() {
        assertEquals(
            setOf(AutomaticPath.Gps),
            VerificationPolicy.availablePaths("both", canBluetooth = false, canGps = true),
        )
    }

    @Test fun geofenceNeverSelectsBluetooth() {
        assertEquals(
            emptySet<AutomaticPath>(),
            VerificationPolicy.availablePaths("geofence", canBluetooth = true, canGps = false),
        )
    }
}
