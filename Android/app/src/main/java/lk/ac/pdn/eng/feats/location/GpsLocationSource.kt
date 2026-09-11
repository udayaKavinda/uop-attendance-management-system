package lk.ac.pdn.eng.feats.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/** One GPS reading, matching the server's fix shape exactly (see gpsFix.service.js). */
data class GpsFix(val lat: Double, val lng: Double, val accuracy: Float)

/** Thrown when location streaming cannot start (no provider, disabled, etc.). */
class LocationUnavailableException(message: String) : Exception(message)

/**
 * Thrown when the platform reports that a fix came from a mock provider.
 *
 * Attendance is a claim about where the student physically is, and a mock
 * location is the OS telling us the claim is manufactured. The app shuts down
 * rather than continuing: there is no honest attendance to take from a device
 * that is faking its position, and a warning would only tell whoever set it up
 * what to hide next.
 *
 * This is a client-side signal and a modified build can suppress it, so it is a
 * deterrent for the easy case (a mock-location app from the Play Store), never a
 * security boundary. The server must not treat its absence as proof of anything.
 */
class MockLocationException : Exception("Mock location detected")

object LocationPermissions {
    fun hasFineLocation(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    // Android 12+ requires coarse and fine to be requested together. Geofence
    // verification still proceeds only when fine location is granted.
    fun permissions(): Array<String> = arrayOf(
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.ACCESS_FINE_LOCATION,
    )

    fun permissionDeniedMessage(): String =
        "Location permission is required to verify your position for this session."
}

/**
 * Streams GPS fixes via the platform [LocationManager] — deliberately not the Play
 * Services FusedLocationProviderClient, to avoid adding that dependency for a
 * feature that only needs periodic fixes over a short (90s) window, not
 * battery-optimized continuous tracking.
 */
class GpsLocationSource(private val context: Context) {

    @Suppress("MissingPermission") // caller is required to have checked hasFineLocation() first
    fun fixFlow(intervalMs: Long = 3000L): Flow<GpsFix> = callbackFlow {
        if (!LocationPermissions.hasFineLocation(context)) {
            close(LocationUnavailableException(LocationPermissions.permissionDeniedMessage()))
            return@callbackFlow
        }
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        if (manager == null) {
            close(LocationUnavailableException("Location is not available on this device."))
            return@callbackFlow
        }
        val providers = enabledProviders(manager)
        if (providers.isEmpty()) {
            close(LocationUnavailableException("Location is turned off. Enable it to verify your position."))
            return@callbackFlow
        }

        val listener = LocationListener { location: Location ->
            if (location.isMocked()) {
                close(MockLocationException())
                return@LocationListener
            }
            trySend(GpsFix(location.latitude, location.longitude, location.accuracy))
        }

        // Registering the same listener against several providers is supported and
        // simply interleaves their fixes. The server already handles a mixed stream:
        // it trims outliers by median distance and weights the centroid by 1/accuracy²,
        // so a coarse network fix informs the result without being able to dominate a
        // precise satellite one (gpsFix.service.js).
        val registered = providers.filter { provider ->
            runCatching {
                manager.requestLocationUpdates(provider, intervalMs, 0f, listener, Looper.getMainLooper())
            }.isSuccess
        }
        if (registered.isEmpty()) {
            close(LocationUnavailableException(LocationPermissions.permissionDeniedMessage()))
            return@callbackFlow
        }

        awaitClose {
            runCatching { manager.removeUpdates(listener) }
        }
    }
}

/**
 * The providers to stream from, best first.
 *
 * `FUSED_PROVIDER` (API 31+) is the platform's own blended engine — satellites,
 * Wi-Fi, cell and sensors together — and is what Google Maps shows a position
 * from. Critically it is part of `LocationManager`, so preferring it keeps the
 * deliberate choice not to depend on Play Services.
 *
 * Below API 31 there is no fused provider here, and the previous behaviour —
 * take GPS if enabled, otherwise network — was the bug: GPS is essentially
 * always *enabled*, so network was only ever reached when the student had
 * switched location off entirely, i.e. never. A phone that is enabled but has no
 * satellite lock yet (indoors, or the first minute of a cold start in the open)
 * produced no fixes at all, the server never reached its 3-fix minimum, and the
 * attempt banded `unknown` — "Could not verify location." Registering both
 * together means a usable position arrives while the satellites are still
 * settling.
 */
private fun enabledProviders(manager: LocationManager): List<String> {
    val enabled = { provider: String -> runCatching { manager.isProviderEnabled(provider) }.getOrDefault(false) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && enabled(LocationManager.FUSED_PROVIDER)) {
        return listOf(LocationManager.FUSED_PROVIDER)
    }
    return listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter(enabled)
}

/**
 * Whether the platform flagged this fix as coming from a mock provider.
 *
 * `isMock` replaced `isFromMockProvider()` in API 31; the old accessor still
 * works below that and minSdk here is 24, so both are needed.
 */
@Suppress("DEPRECATION")
private fun Location.isMocked(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) isMock else isFromMockProvider
