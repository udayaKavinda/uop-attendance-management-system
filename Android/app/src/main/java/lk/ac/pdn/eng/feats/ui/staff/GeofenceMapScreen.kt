package lk.ac.pdn.eng.feats.ui.staff

import android.annotation.SuppressLint
import android.content.Context
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import lk.ac.pdn.eng.feats.data.net.GeofenceDto
import lk.ac.pdn.eng.feats.ui.components.AppCard
import lk.ac.pdn.eng.feats.ui.components.EmptyState
import lk.ac.pdn.eng.feats.ui.components.ErrorBanner
import lk.ac.pdn.eng.feats.ui.components.PillButton
import lk.ac.pdn.eng.feats.ui.components.PillTone
import lk.ac.pdn.eng.feats.ui.components.PrimaryButton
import lk.ac.pdn.eng.feats.ui.theme.AppShapes
import lk.ac.pdn.eng.feats.ui.theme.Palette
import org.json.JSONArray

// University of Peradeniya, Faculty of Engineering — a sensible default map
// center when the device's last-known location isn't available.
private const val DEFAULT_LAT = 7.2544
private const val DEFAULT_LNG = 80.5975

@Composable
fun GeofencesTab(state: StaffState, vm: StaffViewModel) {
    var showEditor by remember { mutableStateOf(false) }
    var mapError by remember { mutableStateOf<String?>(null) }

    if (showEditor) {
        GeofenceMapDialog(
            onDismiss = { showEditor = false },
            onSave = { name, polygon ->
                vm.createGeofence(name, polygon)
                showEditor = false
            },
            onError = { mapError = it },
        )
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp),
    ) {
        item {
            AppCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Buildings", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text(
                        "Draw a building's outline on the map for geofence-based attendance. " +
                            "Uses OpenStreetMap — no account or API key needed.",
                        color = Palette.Muted,
                        fontSize = 12.sp,
                    )
                    mapError?.let {
                        Spacer(Modifier.height(8.dp))
                        ErrorBanner(it)
                    }
                    Spacer(Modifier.height(10.dp))
                    PrimaryButton(text = "＋ Draw a new building", onClick = { mapError = null; showEditor = true })
                }
            }
        }
        if (state.geofences.isEmpty()) {
            item { EmptyState("🏛️", "No buildings yet", "Draw one above to enable geofence-based sessions.") }
        } else {
            items(state.geofences, key = { it.id ?: it.hashCode().toString() }) { g ->
                GeofenceCard(g, onDelete = { g.id?.let(vm::deleteGeofence) })
            }
        }
    }
}

@Composable
private fun GeofenceCard(geofence: GeofenceDto, onDelete: () -> Unit) {
    AppCard(Modifier.fillMaxWidth(), shape = AppShapes.Panel) {
        Row(Modifier.padding(14.dp)) {
            Column(Modifier.weight(1f)) {
                Text(geofence.name.orEmpty(), fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Text(
                    "${geofence.polygon?.size ?: 0} points",
                    color = Palette.Muted,
                    fontSize = 12.sp,
                )
            }
            PillButton("Delete", onClick = onDelete, tone = PillTone.Danger)
        }
    }
}

/** JS ↔ Kotlin bridge for the Leaflet/OSM polygon editor below. */
private class GeofenceBridge(
    private val onSave: (name: String, polygon: List<List<Double>>) -> Unit,
    private val onError: (String) -> Unit,
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onSave(name: String, polygonJson: String) {
        val polygon = runCatching {
            val arr = JSONArray(polygonJson)
            (0 until arr.length()).map { i ->
                val pt = arr.getJSONArray(i)
                listOf(pt.getDouble(0), pt.getDouble(1))
            }
        }.getOrNull()
        mainHandler.post {
            if (polygon == null) onError("Could not read the drawn shape.") else onSave.invoke(name, polygon)
        }
    }

    @JavascriptInterface
    fun onError(message: String) {
        mainHandler.post { onError.invoke(message) }
    }
}

/**
 * Full-screen dialog hosting a WebView-based Leaflet map with OpenStreetMap
 * tiles (no API key/billing account needed — see docs/attendance-verification-design.md
 * for why this was chosen over the Google Maps SDK originally sketched in the design).
 * Tap to add polygon vertices; the drawn shape and name are sent back via
 * [GeofenceBridge] rather than round-tripped through Compose state.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun GeofenceMapDialog(
    onDismiss: () -> Unit,
    onSave: (name: String, polygon: List<List<Double>>) -> Unit,
    onError: (String) -> Unit,
) {
    val context = LocalContext.current
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().padding(8.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                TextButton(onClick = onDismiss) { Text("Close") }
            }
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        addJavascriptInterface(
                            GeofenceBridge(onSave = onSave, onError = onError),
                            "AndroidBridge",
                        )
                        val (lat, lng) = lastKnownLocationOrDefault(ctx)
                        loadDataWithBaseURL(
                            "https://unpkg.com/",
                            geofenceEditorHtml(lat, lng),
                            "text/html",
                            "UTF-8",
                            null,
                        )
                    }
                },
            )
        }
    }
}

/** Best-effort last-known fix — no permission request here; falls back silently if unavailable. */
private fun lastKnownLocationOrDefault(context: Context): Pair<Double, Double> {
    return runCatching {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        val providers = manager?.getProviders(true).orEmpty()
        for (provider in providers) {
            val loc = manager?.getLastKnownLocation(provider)
            if (loc != null) return loc.latitude to loc.longitude
        }
        DEFAULT_LAT to DEFAULT_LNG
    }.getOrDefault(DEFAULT_LAT to DEFAULT_LNG)
}

private fun geofenceEditorHtml(lat: Double, lng: Double): String = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body { margin:0; padding:0; height:100%; font-family: sans-serif; }
  #name-bar { position:absolute; top:0; left:0; right:0; z-index:1000; background:#fff; padding:8px; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
  #name-bar input { width:100%; box-sizing:border-box; padding:10px; border:1px solid #ccc; border-radius:6px; font-size:14px; }
  #map { position:absolute; top:56px; bottom:56px; left:0; right:0; }
  #toolbar { position:absolute; bottom:0; left:0; right:0; height:56px; background:#fff; display:flex; align-items:center; padding:0 8px; box-shadow: 0 -2px 6px rgba(0,0,0,0.15); }
  #toolbar button { flex:1; margin:0 4px; padding:10px; border:none; border-radius:6px; background:#7A1414; color:#fff; font-weight:bold; }
  #toolbar button.secondary { background:#eee; color:#333; }
  #hint { position:absolute; top:64px; left:8px; right:8px; background:rgba(255,255,255,0.9); padding:6px 10px; border-radius:6px; font-size:12px; z-index:1000; pointer-events:none; }
</style>
</head>
<body>
<div id="name-bar"><input id="nameInput" type="text" placeholder="Building name, e.g. Lecture Hall 1"></div>
<div id="hint">Tap the map to add points (need 3+)</div>
<div id="map"></div>
<div id="toolbar">
  <button class="secondary" onclick="undoPoint()">Undo</button>
  <button class="secondary" onclick="clearPoints()">Clear</button>
  <button onclick="save()">Save</button>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = L.map('map').setView([$lat, $lng], 18);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  var points = [];
  var markers = [];
  var polygonLayer = null;

  function redraw() {
    if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
    if (points.length >= 2) {
      polygonLayer = L.polygon(points, {color: '#7A1414'}).addTo(map);
    }
  }

  map.on('click', function(e) {
    points.push([e.latlng.lat, e.latlng.lng]);
    var m = L.circleMarker(e.latlng, {radius:5, color:'#7A1414', fillColor:'#7A1414', fillOpacity:1}).addTo(map);
    markers.push(m);
    redraw();
  });

  function undoPoint() {
    if (points.length === 0) return;
    points.pop();
    var m = markers.pop();
    if (m) map.removeLayer(m);
    redraw();
  }

  function clearPoints() {
    points = [];
    markers.forEach(function(m){ map.removeLayer(m); });
    markers = [];
    redraw();
  }

  function save() {
    var name = document.getElementById('nameInput').value.trim();
    if (!name) { AndroidBridge.onError('Enter a building name.'); return; }
    if (points.length < 3) { AndroidBridge.onError('Add at least 3 points.'); return; }
    // Server expects [lng, lat] ordered vertices.
    var polygonLngLat = points.map(function(p){ return [p[1], p[0]]; });
    AndroidBridge.onSave(name, JSON.stringify(polygonLngLat));
  }
</script>
</body>
</html>
""".trimIndent()
