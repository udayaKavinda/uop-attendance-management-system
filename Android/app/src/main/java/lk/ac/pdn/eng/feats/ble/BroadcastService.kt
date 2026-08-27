package lk.ac.pdn.eng.feats.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import lk.ac.pdn.eng.feats.AttendanceApp
import lk.ac.pdn.eng.feats.R
import lk.ac.pdn.eng.feats.data.net.ApiResult

/** Live state of the on-device broadcast; null when this phone is not broadcasting. */
data class BroadcastState(
    val sessionId: String,
    val label: String? = null,
    val token: String? = null,
    val rotatesIn: Long? = null,
    val attendanceCount: Int? = null,
    val minutesRemaining: Int? = null,
    val error: String? = null,
)

/**
 * Foreground service that owns the poll-and-advertise loop, so the broadcast
 * survives leaving the dashboard and app backgrounding. It re-fetches the
 * rotating token every 5s (which is also the server heartbeat) and re-advertises.
 *
 * Self-initiated stops (Bluetooth turned off in Quick Settings, hard advertise
 * failure) also flip the broadcast off on the server, keeping the single
 * "ON ⇔ actually on the air" invariant. UI-initiated stops handle the server
 * call themselves and only ask the service to drop the radio.
 */
class BroadcastService : Service() {

    companion object {
        private const val ACTION_START = "lk.ac.pdn.eng.feats.broadcast.START"
        private const val ACTION_STOP = "lk.ac.pdn.eng.feats.broadcast.STOP"
        /** Stop tapped directly on the notification — unlike [ACTION_STOP] (radio-only,
         *  used by the ViewModel which separately flips the server flag), this bypasses
         *  the UI layer entirely, so it must close the server side itself too. */
        private const val ACTION_STOP_FROM_NOTIFICATION = "lk.ac.pdn.eng.feats.broadcast.STOP_FROM_NOTIFICATION"
        private const val EXTRA_SESSION_ID = "sessionId"
        private const val EXTRA_LABEL = "label"
        private const val CHANNEL_ID = "attendance_broadcast"
        private const val NOTIFICATION_ID = 41

        private val _state = MutableStateFlow<BroadcastState?>(null)
        val state: StateFlow<BroadcastState?> = _state.asStateFlow()

        private val _stopReason = MutableStateFlow<String?>(null)
        val stopReason: StateFlow<String?> = _stopReason.asStateFlow()
        fun consumeStopReason() { _stopReason.value = null }

        /**
         * Preflight gate: returns a user-facing reason this phone cannot broadcast
         * right now, or null when everything (permission, system Bluetooth toggle,
         * peripheral support) is in place. Advertising never needs location services.
         */
        fun broadcastBlocker(context: Context): String? {
            val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
                ?: return "Bluetooth is not available on this device."
            if (!BlePermissions.hasAdvertise(context)) {
                return "Bluetooth permission is required to broadcast."
            }
            if (!adapter.isEnabled) {
                return "Bluetooth is turned off. Enable it to broadcast."
            }
            if (adapter.bluetoothLeAdvertiser == null) {
                return "This device cannot broadcast over BLE."
            }
            return null
        }

        fun start(context: Context, sessionId: String, label: String?) {
            val intent = Intent(context, BroadcastService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_SESSION_ID, sessionId)
                .putExtra(EXTRA_LABEL, label)
            ContextCompat.startForegroundService(context, intent)
        }

        /** Stops the radio only — the caller is responsible for the server switch. */
        fun stop(context: Context) {
            context.startService(
                Intent(context, BroadcastService::class.java).setAction(ACTION_STOP),
            )
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var advertiser: BleAdvertiser
    private var pollJob: Job? = null

    private val repo get() = (application as AttendanceApp).container.repository

    private val btStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
            val st = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
            if (st == BluetoothAdapter.STATE_TURNING_OFF || st == BluetoothAdapter.STATE_OFF) {
                if (_state.value != null) {
                    shutdown(turnOffServer = true, reason = "Broadcast stopped: Bluetooth was turned off.")
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        advertiser = BleAdvertiser(this)
        // ACTION_STATE_CHANGED is a protected system broadcast, so a non-exported
        // receiver still receives it — no need to expose this to other apps.
        ContextCompat.registerReceiver(
            this,
            btStateReceiver,
            IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
                val label = intent.getStringExtra(EXTRA_LABEL)
                if (sessionId != null) {
                    startInForeground(label)
                    beginLoop(sessionId, label)
                } else {
                    stopSelf()
                }
            }
            ACTION_STOP -> shutdown(turnOffServer = false, reason = null)
            ACTION_STOP_FROM_NOTIFICATION -> shutdown(turnOffServer = true, reason = null)
            else -> stopSelf()
        }
        // Re-deliver the last start intent if the OS kills us under memory pressure,
        // so an aggressively-managed device can resume the broadcast loop. A genuinely
        // closed channel resolves to a 4xx on the first poll and shuts down cleanly.
        return START_REDELIVER_INTENT
    }

    private fun beginLoop(sessionId: String, label: String?) {
        pollJob?.cancel()
        advertiser.stop()
        _state.value = BroadcastState(sessionId = sessionId, label = label)
        pollJob = scope.launch {
            while (isActive) {
                when (val res = repo.broadcast(sessionId)) {
                    is ApiResult.Success -> {
                        val token = res.data.token
                        if (token != null) {
                            advertiser.advertise(token) { err ->
                                // Hard radio failure: stop THIS device only. Never flip the
                                // server's shared broadcasting flag off from a local failure —
                                // another device may still be broadcasting fine (Join), and the
                                // session keeps collecting via GPS either way. A staleness sweep
                                // (or an explicit Deactivate) is what ends it for everyone.
                                shutdown(turnOffServer = false, reason = "Broadcast stopped: $err")
                            }
                        }
                        if (_state.value?.sessionId == sessionId) {
                            _state.value = BroadcastState(
                                sessionId = sessionId,
                                label = label,
                                token = token,
                                rotatesIn = res.data.rotatesIn,
                                attendanceCount = res.data.attendanceCount,
                                minutesRemaining = res.data.minutesRemaining,
                            )
                            updateNotification(label, _state.value)
                        }
                    }
                    is ApiResult.Error -> {
                        if (res.code != null && res.code in 400..499) {
                            // Server says the channel is closed (turned off elsewhere,
                            // session deactivated, or heartbeat-swept). Just stop.
                            shutdown(turnOffServer = false, reason = "Broadcast was turned off on the server.")
                            return@launch
                        }
                        // Transient (network) error: keep advertising the last token and retry.
                        _state.value = _state.value?.copy(error = res.message)
                    }
                }
                // Re-fetch ahead of the 15s rotation; doubles as the server heartbeat.
                delay(5_000)
            }
        }
    }

    private fun shutdown(turnOffServer: Boolean, reason: String?) {
        pollJob?.cancel()
        pollJob = null
        advertiser.stop()
        val sessionId = _state.value?.sessionId
        _state.value = null
        if (reason != null) _stopReason.value = reason
        if (turnOffServer && sessionId != null) {
            scope.launch {
                withContext(NonCancellable) {
                    repo.setBroadcasting(sessionId, false)
                }
                stopSelf()
            }
        } else {
            stopSelf()
        }
    }

    /**
     * Builds the ongoing notification content. Named for the real lecture ("CS101 MON
     * 08:00-10:00") with a live "students marked" count and time-remaining once the
     * first poll lands — a user-perceptible, continuously-updating task, per Play's
     * foreground-service policy. Deliberately omits the token/rotation countdown:
     * that's an internal implementation detail, not something a lecturer needs to see.
     */
    private fun buildNotification(label: String?, state: BroadcastState?): Notification {
        val title = label ?: "Broadcasting attendance"
        val count = state?.attendanceCount
        val remaining = state?.minutesRemaining
        val text = when {
            count != null && remaining != null ->
                "${studentsMarked(count)} · ${formatRemaining(remaining)} left"
            count != null -> studentsMarked(count)
            else -> "Students can record attendance nearby."
        }
        val stopIntent = Intent(this, BroadcastService::class.java).setAction(ACTION_STOP_FROM_NOTIFICATION)
        val stopPendingIntent = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_broadcast)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true) // re-posted every ~5s with fresh counts; alert once, not each time
            .addAction(R.drawable.ic_stop, "Stop broadcast", stopPendingIntent)
            .build()
    }

    private fun studentsMarked(count: Int): String = if (count == 1) "1 student marked" else "$count students marked"

    private fun formatRemaining(minutes: Int): String =
        if (minutes >= 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes}m"

    /** Re-posts the notification with the latest live counts (same id → updates in place). */
    private fun updateNotification(label: String?, state: BroadcastState?) {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(label, state))
    }

    private fun startInForeground(label: String?) {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Attendance broadcast", NotificationManager.IMPORTANCE_LOW),
            )
        }
        val notification = buildNotification(label, null)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(btStateReceiver) }
        pollJob?.cancel()
        advertiser.stop()
        _state.value = null
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
