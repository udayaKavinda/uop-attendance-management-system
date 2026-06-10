package lk.ac.pdn.eng.attendance.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/** Thrown when scanning cannot start (adapter off, unsupported, etc.). */
class BleUnavailableException(message: String) : Exception(message)

/**
 * BLE central: scans for UOP attendance advertisements and emits the recovered
 * 16-hex token each time one is seen. The collector controls the lifetime — when
 * the flow is cancelled (timeout, success, screen left) the scan stops.
 */
class BleScanner(private val context: Context) {

    private val adapter: BluetoothAdapter?
        get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    @SuppressLint("MissingPermission")
    fun tokenFlow(): Flow<String> = callbackFlow {
        val bt = adapter ?: throw BleUnavailableException("Bluetooth is not available on this device.")
        if (!bt.isEnabled) throw BleUnavailableException("Bluetooth is turned off. Enable it and try again.")
        val scanner = bt.bluetoothLeScanner
            ?: throw BleUnavailableException("Bluetooth scanning is unavailable right now.")

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val uuids = result.scanRecord?.serviceUuids?.map { it.uuid }
                BleUuid.extractToken(uuids)?.let { trySend(it) }
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                for (result in results) {
                    val uuids = result.scanRecord?.serviceUuids?.map { it.uuid }
                    BleUuid.extractToken(uuids)?.let { trySend(it) }
                }
            }

            override fun onScanFailed(errorCode: Int) {
                close(BleUnavailableException("Bluetooth scan failed (code $errorCode)."))
            }
        }

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        // No filters: the token rotates so the service UUID changes constantly;
        // we inspect every advertisement and match the UOPA prefix in code.
        scanner.startScan(null, settings, callback)

        awaitClose {
            runCatching { scanner.stopScan(callback) }
        }
    }
}
