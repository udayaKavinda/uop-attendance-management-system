package lk.ac.pdn.eng.attendance.ble

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
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

    /** Permissions needed to ADVERTISE (lecturer broadcast). */
    fun advertisePermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            // Legacy BLUETOOTH/BLUETOOTH_ADMIN are install-time on API <= 30.
            emptyArray()
        }

    fun hasAll(context: Context, permissions: Array<String>): Boolean =
        permissions.all {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }

    fun hasScan(context: Context): Boolean = hasAll(context, scanPermissions())

    fun hasAdvertise(context: Context): Boolean = hasAll(context, advertisePermissions())
}
