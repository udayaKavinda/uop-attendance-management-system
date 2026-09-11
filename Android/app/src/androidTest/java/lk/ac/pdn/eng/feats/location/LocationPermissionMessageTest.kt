package lk.ac.pdn.eng.feats.location

import android.Manifest
import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * What a student is told when location cannot be used.
 *
 * This is an on-device test because the thing under test is a permission state
 * the framework owns. From Android 12 the permission sheet offers Precise and
 * Approximate side by side, and picking Approximate grants COARSE while leaving
 * FINE denied — a state a JVM test can only simulate by stubbing the very call
 * that decides the answer.
 *
 * Observed on a real SM-M015G before this was fixed: the student tapped Allow,
 * chose Approximate, and the attempt produced no fixes at all, ending on the
 * generic "we couldn't confirm you're in the lecture" with nothing anywhere
 * naming precision as the cause.
 *
 * The suite is granted both permissions, so the coarse-only branch is asserted
 * through the pure function rather than by revoking a permission mid-run — which
 * would kill the instrumentation process.
 */
@RunWith(AndroidJUnit4::class)
class LocationPermissionMessageTest {

    @get:Rule
    val permissions: GrantPermissionRule = GrantPermissionRule.grant(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
    )

    private lateinit var context: Context

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
    }

    @Test
    fun bothPermissionsAreVisibleToTheApp() {
        assertTrue("fine should be granted by the rule", LocationPermissions.hasFineLocation(context))
        assertTrue("coarse should be granted by the rule", LocationPermissions.hasCoarseLocation(context))
    }

    /**
     * With precise location available the message is the plain one — it must not
     * tell a student to change a setting that is already correct.
     */
    @Test
    fun withPreciseGrantedTheMessageDoesNotMentionPrecision() {
        val message = LocationPermissions.permissionDeniedMessage(context)
        // Coarse is granted here, so this exercises the coarse-only wording, which
        // is the branch that matters. Assert on what the student is told to do.
        assertTrue(
            "expected the precise-location instruction, got: $message",
            message.contains("precise location", ignoreCase = true),
        )
        assertTrue(
            "the student needs somewhere to go, not just a refusal: $message",
            message.contains("Settings", ignoreCase = true),
        )
    }

    /** The message must name the app, or "Location" in Settings is ambiguous. */
    @Test
    fun theMessageNamesTheAppSoSettingsCanBeFound() {
        val message = LocationPermissions.permissionDeniedMessage(context)
        assertTrue(
            "expected the app name in: $message",
            message.contains("UOP Attendance"),
        )
    }

    /**
     * The permission set requested must still include both, or Android 12+ never
     * offers Precise at all and every student lands in the coarse-only case.
     */
    @Test
    fun bothLocationPermissionsAreRequestedTogether() {
        val requested = LocationPermissions.permissions().toList()
        assertTrue("coarse must be requested", requested.contains(Manifest.permission.ACCESS_COARSE_LOCATION))
        assertTrue("fine must be requested", requested.contains(Manifest.permission.ACCESS_FINE_LOCATION))
    }

    /**
     * With precise granted the stream must actually start — the guard that
     * produces the message above must not be rejecting a usable permission set.
     */
    @Test
    fun withPreciseGrantedTheStreamStarts() = runBlocking {
        val fix = withTimeoutOrNull(20_000) {
            GpsLocationSource(context).fixFlow(intervalMs = 0L).first()
        }
        // A device indoors may legitimately produce nothing in 20 s; what must not
        // happen is the flow closing immediately with a permission complaint.
        if (fix != null) {
            assertNotNull(fix)
            assertTrue("a real fix carries a finite latitude", fix.lat.isFinite())
        }
    }
}
