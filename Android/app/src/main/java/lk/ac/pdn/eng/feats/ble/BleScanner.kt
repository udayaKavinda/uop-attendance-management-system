package lk.ac.pdn.eng.feats.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.ParcelUuid
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import java.util.UUID

/** Thrown when scanning cannot start (adapter off, unsupported, etc.). */
class BleUnavailableException(message: String) : Exception(message)

/**
 * BLE central: scans for UOP attendance advertisements and emits the recovered
 * 16-hex token each time one is seen. The collector controls the lifetime — when
 * the flow is cancelled (timeout, success, screen left) the scan stops.
 */
class BleScanner(private val context: Context) {

    companion object {
        // Matches only the fixed 32-bit "UOPA" prefix; the remaining bytes carry
        // the rotating token and are masked out. Supplying a non-null filter is
        // also what keeps the scan delivering results when the screen is off —
        // since Android 8.1 the framework drops callbacks for *unfiltered* scans
        // once the display turns off.
        private val UOPA_SCAN_FILTER: ScanFilter = ScanFilter.Builder()
            .setServiceUuid(
                ParcelUuid(UUID.fromString("554f5041-0000-0000-0000-000000000000")),
                ParcelUuid(UUID.fromString("ffffffff-0000-0000-0000-000000000000")),
            )
            .build()
    }

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
                val message = when (errorCode) {
                    ScanCallback.SCAN_FAILED_SCANNING_TOO_FREQUENTLY ->
                        "Bluetooth is busy. Wait a few seconds, then tap scan again."
                    ScanCallback.SCAN_FAILED_FEATURE_UNSUPPORTED ->
                        "Bluetooth scanning is not supported on this device."
                    else -> "Bluetooth scan failed (code $errorCode). Try again."
                }
                close(BleUnavailableException(message))
            }
        }

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        // Filter on the fixed UOPA prefix (token bytes masked out). The service
        // UUID rotates, but the prefix is constant — so we still see every one of
        // our beacons, and the scan keeps working with the screen off.
        scanner.startScan(listOf(UOPA_SCAN_FILTER), settings, callback)

        awaitClose {
            runCatching { scanner.stopScan(callback) }
        }
    }
}
