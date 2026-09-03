package lk.ac.pdn.eng.feats.location

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.location.Criteria
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * On-device verification that [GpsLocationSource] refuses a manufactured fix.
 *
 * This cannot be a JVM test: the guard rests on a flag the Android framework
 * sets on [Location] as it is delivered, and a plain unit test would only prove
 * that a stub we wrote ourselves returns what we told it to. Note that the flag
 * is *not* present on a Location we construct here — only on one the platform
 * has routed through a test provider — so the sanity check below asserts on a
 * delivered fix, never on [newFix] itself.
 *
 * Requires the mock-location app-op:
 *
 *     adb shell appops set lk.ac.pdn.eng.feats android:mock_location allow
 *
 * Without it [LocationManager.addTestProvider] throws SecurityException in
 * [installTestProvider], so these tests fail loudly rather than pass vacuously.
 */
@RunWith(AndroidJUnit4::class)
class MockLocationDetectionTest {

    @get:Rule
    val permissions: GrantPermissionRule = GrantPermissionRule.grant(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
    )

    private lateinit var context: Context
    private lateinit var manager: LocationManager
    private lateinit var pumpThread: HandlerThread
    private lateinit var pump: Handler

    /** Any pump failure, surfaced instead of swallowed — a silent pump fails as a timeout. */
    private val pumpError = AtomicReference<Throwable?>(null)

    @Before
    fun installTestProvider() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        bringAppToForeground()
        manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        runCatching { manager.removeTestProvider(PROVIDER) }
        manager.addTestProvider(
            PROVIDER,
            false, false, false, false,
            true, true, true,
            Criteria.POWER_LOW,
            Criteria.ACCURACY_FINE,
        )
        manager.setTestProviderEnabled(PROVIDER, true)
        pumpThread = HandlerThread("mock-fix-pump").apply { start() }
        pump = Handler(pumpThread.looper)
    }

    @After
    fun removeTestProvider() {
        // Tolerant of a failed setUp: an exception here would otherwise replace the
        // real @Before failure in the report and hide why the run went wrong.
        if (::pump.isInitialized) pump.removeCallbacksAndMessages(null)
        if (::pumpThread.isInitialized) pumpThread.quitSafely()
        if (::manager.isInitialized) {
            runCatching { manager.setTestProviderEnabled(PROVIDER, false) }
            runCatching { manager.removeTestProvider(PROVIDER) }
        }
    }

    /**
     * Guards the guard. If the platform ever stopped flagging test-provider fixes,
     * [mockedFixAbortsTheStream] would pass for the wrong reason, so prove the flag
     * arrives on a *delivered* fix before relying on it.
     */
    @Test
    fun platformFlagsDeliveredTestProviderFixAsMocked() {
        val received = AtomicReference<Location?>(null)
        val latch = CountDownLatch(1)
        val listener = LocationListener { loc ->
            received.set(loc)
            latch.countDown()
        }
        manager.requestLocationUpdates(PROVIDER, 0L, 0f, listener, pumpThread.looper)
        startPump()
        val arrived = latch.await(DELIVERY_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        manager.removeUpdates(listener)

        pumpError.get()?.let { fail("Mock pump failed: $it") }
        assertTrue("No fix was delivered from the test provider within ${DELIVERY_TIMEOUT_MS}ms", arrived)
        val fix = received.get()
        assertNotNull(fix)
        assertTrue(
            "Platform did not flag a delivered test-provider Location as mocked; " +
                "the detection under test would be unreachable on this device.",
            fix!!.isMock,
        )
    }

    /** The actual contract: a mocked fix ends the stream and is never emitted. */
    @Test
    fun mockedFixAbortsTheStream() = runBlocking {
        startPump()
        var thrown: Throwable? = null
        try {
            withTimeout(COLLECT_TIMEOUT_MS) {
                val leaked = GpsLocationSource(context).fixFlow(intervalMs = 0L).first()
                fail("fixFlow emitted $leaked from a mocked provider; expected MockLocationException")
            }
        } catch (e: Throwable) {
            thrown = e
        }
        pumpError.get()?.let { fail("Mock pump failed: $it") }
        assertTrue(
            "Expected MockLocationException, got ${thrown?.let { it::class.java.name }}: $thrown",
            thrown is MockLocationException,
        )
    }

    /**
     * Starts the launcher activity and waits for it to resume.
     *
     * Not optional. The location app-op for this app is granted at "while using
     * the app" (uid mode `foreground`), and `am instrument` restarts the target
     * process — so with no resumed activity the framework accepts the listener
     * registration, receives every mocked fix, and then delivers *nothing*, with
     * no exception and no log. That failure is indistinguishable from a broken
     * guard, which is exactly the way to record a false pass.
     */
    private fun bringAppToForeground() {
        val launch = context.packageManager
            .getLaunchIntentForPackage(context.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ?: error("No launcher activity for ${context.packageName}")
        context.startActivity(launch)
        // Resume is asynchronous; poll rather than sleep a fixed guess.
        val deadline = SystemClock.uptimeMillis() + FOREGROUND_TIMEOUT_MS
        while (SystemClock.uptimeMillis() < deadline) {
            if (isForeground()) return
            Thread.sleep(100)
        }
        error("App did not reach the foreground within ${FOREGROUND_TIMEOUT_MS}ms")
    }

    private fun isForeground(): Boolean {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mine = am.runningAppProcesses?.firstOrNull { it.pid == Process.myPid() }
        return mine?.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }

    /** Pushes a fresh fix every tick; a stale one is dropped by the framework. */
    private fun startPump() {
        val tick = object : Runnable {
            override fun run() {
                try {
                    manager.setTestProviderLocation(PROVIDER, newFix())
                } catch (e: Throwable) {
                    pumpError.compareAndSet(null, e)
                    return
                }
                pump.postDelayed(this, PUMP_INTERVAL_MS)
            }
        }
        pump.post(tick)
    }

    private fun newFix() = Location(PROVIDER).apply {
        latitude = 7.2545
        longitude = 80.5925
        accuracy = 5f
        altitude = 500.0
        bearing = 0f
        speed = 0f
        time = System.currentTimeMillis()
        elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
    }

    private companion object {
        /** The real GPS provider name: the app asks for this one by name. */
        const val PROVIDER = LocationManager.GPS_PROVIDER
        const val PUMP_INTERVAL_MS = 200L
        const val DELIVERY_TIMEOUT_MS = 8_000L
        const val COLLECT_TIMEOUT_MS = 8_000L
        const val FOREGROUND_TIMEOUT_MS = 10_000L
    }
}
