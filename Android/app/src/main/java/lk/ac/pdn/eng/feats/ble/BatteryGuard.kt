package lk.ac.pdn.eng.feats.ble

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings

/**
 * Keeps the lecturer broadcast alive on OEMs that aggressively kill foreground
 * services. Battery-optimization (Doze) exemption is the one OS-sanctioned lever
 * we can request directly; vendor "auto-start" allow-lists can only be toggled by
 * the user in their own system settings, so those stay as on-screen guidance.
 */
object BatteryGuard {

    /** True if the app is already exempt from Doze battery optimization. */
    fun isExempt(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return true
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * Intent that asks the user to exempt this app from battery optimization.
     * Backed by REQUEST_IGNORE_BATTERY_OPTIMIZATIONS declared in the manifest.
     */
    fun requestExemptionIntent(context: Context): Intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:${context.packageName}"))
}
