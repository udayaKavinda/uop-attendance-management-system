package lk.ac.pdn.eng.feats.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/** One GPS reading, matching the server's fix shape exactly (see gpsFix.service.js). */
data class GpsFix(val lat: Double, val lng: Double, val accuracy: Float)

/** Thrown when location streaming cannot start (no provider, disabled, etc.). */
class LocationUnavailableException(message: String) : Exception(message)

object LocationPermissions {
    fun hasFineLocation(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    fun permissions(): Array<String> = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

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
        val provider = when {
            manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> null
        }
        if (provider == null) {
            close(LocationUnavailableException("Location is turned off. Enable it to verify your position."))
            return@callbackFlow
        }

        val listener = LocationListener { location: Location ->
            trySend(GpsFix(location.latitude, location.longitude, location.accuracy))
        }

        try {
            manager.requestLocationUpdates(provider, intervalMs, 0f, listener, Looper.getMainLooper())
        } catch (e: SecurityException) {
            close(LocationUnavailableException(LocationPermissions.permissionDeniedMessage()))
            return@callbackFlow
        }

        awaitClose {
            runCatching { manager.removeUpdates(listener) }
        }
    }
}
