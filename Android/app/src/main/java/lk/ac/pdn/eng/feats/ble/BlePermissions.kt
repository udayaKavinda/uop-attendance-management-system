package lk.ac.pdn.eng.feats.ble

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat

/** Helpers for the runtime BLE permission set, which differs across API levels. */
object BlePermissions {

    /** Permissions needed to SCAN for advertisements (student attendance). */
    fun scanPermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    /** User-facing message when scan runtime permission is denied. */
    fun scanPermissionDeniedMessage(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            "Bluetooth permission is required to scan for the classroom signal."
        } else {
            "Location permission is required to scan for the classroom signal."
        }

    /** True once the radio itself is on — ignores permissions and Location services. */
    fun isBluetoothOn(context: Context): Boolean {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        return adapter?.isEnabled == true
    }

    /**
     * On API 30 and below, BLE scan needs the system Location toggle on even when
     * [ACCESS_FINE_LOCATION] is granted. Not required on API 31+ (neverForLocation).
     */
    fun isLocationServicesEnabled(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return true
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
        return lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
            || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    /**
     * Preflight gate for student scanning: runtime permission, Location services
     * (legacy), Bluetooth on, and scanner availability. Null means scan may start.
     */
    fun scanBlocker(context: Context): String? {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
            ?: return "Bluetooth is not available on this device."
        if (!hasScan(context)) return scanPermissionDeniedMessage()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && !isLocationServicesEnabled(context)) {
            return "Location is turned off. Enable it to scan for the classroom signal."
        }
        if (!adapter.isEnabled) {
            return "Bluetooth is turned off. Enable it and try again."
        }
        if (adapter.bluetoothLeScanner == null) {
            return "Bluetooth scanning is unavailable right now."
        }
        return null
    }

    /** Permissions strictly needed to ADVERTISE (lecturer broadcast). */
    fun advertisePermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            // Legacy BLUETOOTH/BLUETOOTH_ADMIN are install-time on API <= 30.
            emptyArray()
        }

    /**
     * Superset to *request* before broadcasting: adds POST_NOTIFICATIONS (API 33+)
     * so the foreground-service notification can show. Denying notifications does
     * not block the broadcast itself — only [advertisePermissions] are required.
     */
    fun advertiseRequestPermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            advertisePermissions() + Manifest.permission.POST_NOTIFICATIONS
        } else {
            advertisePermissions()
        }

    fun hasAll(context: Context, permissions: Array<String>): Boolean =
        permissions.all {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }

    fun hasScan(context: Context): Boolean = hasAll(context, scanPermissions())

    fun hasAdvertise(context: Context): Boolean = hasAll(context, advertisePermissions())
}
