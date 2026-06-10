package lk.ac.pdn.eng.attendance.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.ParcelUuid

/**
 * BLE peripheral: advertises the lecturer's rotating attendance token as a
 * 128-bit service UUID. The token rotates every ~15s on the server, so callers
 * call [advertise] again with each fresh token (which restarts the broadcast).
 *
 * Acts as the on-device replacement for the separate lecturer broadcaster.
 */
class BleAdvertiser(private val context: Context) {

    private val adapter: BluetoothAdapter?
        get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private var advertiser: BluetoothLeAdvertiser? = null
    private var callback: AdvertiseCallback? = null
    private var currentToken: String? = null

    val isAdvertising: Boolean get() = callback != null

    /** True if this device can advertise as a BLE peripheral. */
    fun isSupported(): Boolean {
        val bt = adapter ?: return false
        return bt.isMultipleAdvertisementSupported && bt.bluetoothLeAdvertiser != null
    }

    /**
     * Start (or refresh) the broadcast with [token]. Re-broadcasting the same
     * token is a no-op. Returns null on success or an error message on failure.
     */
    @SuppressLint("MissingPermission")
    fun advertise(token: String, onError: (String) -> Unit) {
        val bt = adapter
        if (bt == null || !bt.isEnabled) {
            onError("Bluetooth is turned off. Enable it to broadcast.")
            return
        }
        if (!bt.isMultipleAdvertisementSupported) {
            onError("This device does not support BLE advertising.")
            return
        }
        if (token == currentToken && isAdvertising) return

        stop()

        val uuid = runCatching { BleUuid.tokenToUuid(token) }.getOrElse {
            onError("Invalid broadcast token.")
            return
        }

        val adv = bt.bluetoothLeAdvertiser
        if (adv == null) {
            onError("Bluetooth advertiser unavailable.")
            return
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(uuid))
            .build()

        val cb = object : AdvertiseCallback() {
            override fun onStartFailure(errorCode: Int) {
                callback = null
                currentToken = null
                onError("Could not start broadcast (code $errorCode).")
            }
        }

        runCatching {
            adv.startAdvertising(settings, data, cb)
            advertiser = adv
            callback = cb
            currentToken = token
        }.onFailure {
            callback = null
            currentToken = null
            onError(it.message ?: "Could not start broadcast.")
        }
    }

    @SuppressLint("MissingPermission")
    fun stop() {
        val cb = callback ?: return
        runCatching { advertiser?.stopAdvertising(cb) }
        callback = null
        currentToken = null
    }
}
