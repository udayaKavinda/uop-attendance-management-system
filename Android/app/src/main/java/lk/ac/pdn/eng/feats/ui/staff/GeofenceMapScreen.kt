package lk.ac.pdn.eng.feats.ui.staff

import android.annotation.SuppressLint
import android.content.Context
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.LocationCity
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import lk.ac.pdn.eng.feats.data.net.GeofenceDto
import lk.ac.pdn.eng.feats.ui.components.AppCard
import lk.ac.pdn.eng.feats.ui.components.AppTextField
import lk.ac.pdn.eng.feats.ui.components.EmptyState
import lk.ac.pdn.eng.feats.ui.components.ErrorBanner
import lk.ac.pdn.eng.feats.ui.components.PillButton
import lk.ac.pdn.eng.feats.ui.components.PillTone
import lk.ac.pdn.eng.feats.ui.components.PrimaryButton
import lk.ac.pdn.eng.feats.ui.theme.AppShapes
import lk.ac.pdn.eng.feats.ui.theme.Palette
import org.json.JSONArray
import org.json.JSONObject

// University of Peradeniya, Faculty of Engineering — map centre when the device
// has no last-known fix to start from.
private const val DEFAULT_LAT = 7.2544
private const val DEFAULT_LNG = 80.5975

/**
 * Admin Geofences tab. The map is **always visible** with every saved building
 * drawn on it; "Add building" switches the same map into draw mode rather than
 * opening a separate editor.
 *
 * The map is deliberately inline (not a Compose `Dialog`): a WebView hosted in a
 * dialog window rendered blank on device, and a dialog also can't show the saved
 * geofences as context while you draw a new one.
 */
@Composable
fun GeofencesTab(state: StaffState, vm: StaffViewModel) {
    var drawing by remember { mutableStateOf(false) }
    var pointCount by remember { mutableStateOf(0) }
    var name by remember { mutableStateOf("") }
    var mapError by remember { mutableStateOf<String?>(null) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    fun runJs(js: String) = webView?.evaluateJavascript(js, null)

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 8.dp, bottom = 24.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(44.dp).clip(RoundedCornerShape(14.dp))
                        .background(Brush.linearGradient(listOf(Palette.GradIndigo, Palette.Accent))),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Outlined.LocationCity,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(22.dp),
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Geofences", fontWeight = FontWeight.ExtraBold, fontSize = 19.sp, color = Palette.Ink)
                    Text(
                        "${state.geofences.size} building${if (state.geofences.size == 1) "" else "s"} mapped",
                        color = Palette.Muted,
                        fontSize = 13.sp,
                    )
                }
            }
        }

        item {
            AppCard(Modifier.fillMaxWidth(), shape = AppShapes.Panel) {
                Column {
                    // Fixed height: a WebView has no intrinsic content height, so
                    // inside a scrolling parent it must be told exactly how tall.
                    GeofenceMapView(
                        geofences = state.geofences,
                        drawing = drawing,
                        onReady = { webView = it },
                        onPointCountChanged = { pointCount = it },
                        onError = { mapError = it },
                        modifier = Modifier.fillMaxWidth().height(380.dp),
                    )

                    Column(Modifier.padding(14.dp)) {
                        mapError?.let {
                            ErrorBanner(it)
                            Spacer(Modifier.height(10.dp))
                        }

                        if (!drawing) {
                            Text(
                                if (state.geofences.isEmpty()) {
                                    "No buildings yet. Add one to enable GPS geofence sessions."
                                } else {
                                    "Saved buildings are outlined on the map."
                                },
                                color = Palette.Muted,
                                fontSize = 12.5.sp,
                            )
                            Spacer(Modifier.height(10.dp))
                            PrimaryButton(
                                text = "＋ Add building",
                                onClick = {
                                    mapError = null
                                    name = ""
                                    pointCount = 0
                                    drawing = true
                                    runJs("setDrawing(true)")
                                },
                            )
                        } else {
                            Text(
                                "Tap the map to trace the building outline — at least 3 points.",
                                color = Palette.Muted,
                                fontSize = 12.5.sp,
                            )
                            Spacer(Modifier.height(10.dp))
                            AppTextField(
                                value = name,
                                onValueChange = { name = it },
                                label = "Building name",
                                placeholder = "e.g. Lecture Hall 1",
                                keyboardType = KeyboardType.Text,
                            )
                            Spacer(Modifier.height(10.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    "$pointCount point${if (pointCount == 1) "" else "s"}",
                                    color = if (pointCount >= 3) Palette.SuccessText else Palette.Muted,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 12.5.sp,
                                    modifier = Modifier.weight(1f),
                                )
                                PillButton("Undo", onClick = { runJs("undoPoint()") }, tone = PillTone.Neutral)
                                Spacer(Modifier.width(6.dp))
                                PillButton("Clear", onClick = { runJs("clearPoints()") }, tone = PillTone.Neutral)
                            }
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                PillButton(
                                    "Cancel",
                                    onClick = {
                                        drawing = false
                                        pointCount = 0
                                        runJs("setDrawing(false)")
                                    },
                                    tone = PillTone.Neutral,
                                )
                                PillButton(
                                    "Save building",
                                    tone = PillTone.Success,
                                    enabled = name.isNotBlank() && pointCount >= 3,
                                    onClick = {
                                        webView?.evaluateJavascript("getPoints()") { raw ->
                                            val polygon = parsePolygon(raw)
                                            if (polygon == null || polygon.size < 3) {
                                                mapError = "Could not read the drawn shape. Try again."
                                            } else {
                                                vm.createGeofence(name.trim(), polygon)
                                                drawing = false
                                                pointCount = 0
                                                name = ""
                                                runJs("setDrawing(false)")
                                            }
                                        }
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }

        if (state.geofences.isEmpty()) {
            item { EmptyState("🏛️", "No buildings yet", "Add one above to enable geofence-based sessions.") }
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
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(Palette.ChipBg),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.LocationCity,
                    contentDescription = null,
                    tint = Palette.AccentDark,
                    modifier = Modifier.size(18.dp),
                )
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(geofence.name.orEmpty(), fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Text("${geofence.polygon?.size ?: 0} points", color = Palette.Muted, fontSize = 12.sp)
            }
            PillButton("Delete", onClick = onDelete, tone = PillTone.Danger)
        }
    }
}

/** `evaluateJavascript` hands back a JSON *string literal*, so unwrap then parse. */
private fun parsePolygon(raw: String?): List<List<Double>>? = runCatching {
    if (raw == null || raw == "null") return null
    // The result arrives double-encoded: "\"[[lng,lat],...]\"" — decode once via
    // JSONObject so escaping is handled properly, then parse the real array.
    val unwrapped = if (raw.startsWith("\"")) {
        JSONObject("""{"v":$raw}""").getString("v")
    } else {
        raw
    }
    val arr = JSONArray(unwrapped)
    (0 until arr.length()).map { i ->
        val pt = arr.getJSONArray(i)
        listOf(pt.getDouble(0), pt.getDouble(1))
    }
}.getOrNull()

/** Bridge for events the map pushes up (point count, load failures). */
private class MapBridge(
    private val onPointCountChanged: (Int) -> Unit,
    private val onError: (String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onPoints(count: Int) {
        main.post { onPointCountChanged(count) }
    }

    @JavascriptInterface
    fun onError(message: String) {
        main.post { onError.invoke(message) }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun GeofenceMapView(
    geofences: List<GeofenceDto>,
    drawing: Boolean,
    onReady: (WebView) -> Unit,
    onPointCountChanged: (Int) -> Unit,
    onError: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var loaded by remember { mutableStateOf(false) }
    var view by remember { mutableStateOf<WebView?>(null) }

    // Re-draw saved buildings whenever the list or the load state changes.
    DisposableEffect(geofences, loaded) {
        if (loaded) {
            view?.evaluateJavascript("renderGeofences(${geofencesToJson(geofences)})", null)
        }
        onDispose { }
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                // Leaflet pans/zooms itself; the WebView must not also try to.
                settings.builtInZoomControls = false
                settings.setSupportZoom(false)
                isHorizontalScrollBarEnabled = false
                isVerticalScrollBarEnabled = false
                addJavascriptInterface(
                    MapBridge(onPointCountChanged = onPointCountChanged, onError = onError),
                    "AndroidBridge",
                )
                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(v: WebView?, url: String?) {
                        loaded = true
                    }

                    override fun onReceivedError(
                        v: WebView?,
                        request: WebResourceRequest?,
                        error: WebResourceError?,
                    ) {
                        Log.e("GeofenceMap", "load failed: ${request?.url} — ${error?.description}")
                    }
                }
                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(m: ConsoleMessage?): Boolean {
                        Log.d("GeofenceMap", "console: ${m?.message()} @${m?.sourceId()}:${m?.lineNumber()}")
                        return true
                    }
                }
                val (lat, lng) = lastKnownLocationOrDefault(ctx)
                loadDataWithBaseURL(
                    "https://unpkg.com/",
                    mapHtml(lat, lng),
                    "text/html",
                    "UTF-8",
                    null,
                )
                view = this
                onReady(this)
            }
        },
        update = { wv ->
            if (loaded) wv.evaluateJavascript("setDrawing($drawing)", null)
        },
    )
}

private fun geofencesToJson(geofences: List<GeofenceDto>): String {
    val arr = JSONArray()
    geofences.forEach { g ->
        val poly = g.polygon ?: return@forEach
        val pts = JSONArray()
        poly.forEach { pt ->
            if (pt.size >= 2) pts.put(JSONArray().put(pt[0]).put(pt[1]))
        }
        arr.put(JSONObject().put("name", g.name.orEmpty()).put("polygon", pts))
    }
    return arr.toString()
}

/** Best-effort last-known fix — no permission request here; falls back silently. */
private fun lastKnownLocationOrDefault(context: Context): Pair<Double, Double> = runCatching {
    val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    for (provider in manager?.getProviders(true).orEmpty()) {
        val loc = manager?.getLastKnownLocation(provider)
        if (loc != null) return loc.latitude to loc.longitude
    }
    DEFAULT_LAT to DEFAULT_LNG
}.getOrDefault(DEFAULT_LAT to DEFAULT_LNG)

/**
 * Leaflet + OpenStreetMap, loaded from a CDN (free, no API key). Sized with
 * `100%`/`100vh` on a flex column rather than `position:absolute` + `height:100%`,
 * which needs the whole ancestor chain to resolve a definite height and silently
 * collapsed to zero inside the WebView.
 */
private fun mapHtml(lat: Double, lng: Double): String = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body { margin:0; padding:0; height:100%; width:100%; overflow:hidden; font-family:sans-serif; background:#eee; }
  #map { height:100%; width:100%; }
  #fallback { display:none; padding:16px; color:#b42318; font-size:13px; line-height:1.5; }
  #hint { position:absolute; top:8px; left:8px; right:8px; background:rgba(255,255,255,0.92);
          padding:6px 10px; border-radius:6px; font-size:12px; z-index:1000; pointer-events:none; display:none; }
</style>
</head>
<body>
<div id="hint">Tap to add points</div>
<div id="map"></div>
<div id="fallback">
  Map could not load. Check the device's internet connection, then reopen this tab.
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = null, drawing = false, points = [], markers = [], draft = null, saved = [];

  function boot() {
    if (typeof L === 'undefined') {
      document.getElementById('map').style.display = 'none';
      document.getElementById('fallback').style.display = 'block';
      if (window.AndroidBridge) AndroidBridge.onError('Map library could not be downloaded. Check the internet connection.');
      return;
    }
    map = L.map('map').setView([$lat, $lng], 17);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    map.on('click', function(e) {
      if (!drawing) return;
      points.push([e.latlng.lat, e.latlng.lng]);
      markers.push(L.circleMarker(e.latlng, {radius:5, color:'#7A1414', fillColor:'#7A1414', fillOpacity:1}).addTo(map));
      redrawDraft();
      if (window.AndroidBridge) AndroidBridge.onPoints(points.length);
    });
  }

  function redrawDraft() {
    if (draft) { map.removeLayer(draft); draft = null; }
    if (points.length >= 2) draft = L.polygon(points, {color:'#7A1414', weight:2}).addTo(map);
  }

  function setDrawing(on) {
    drawing = !!on;
    document.getElementById('hint').style.display = drawing ? 'block' : 'none';
    if (!drawing) clearPoints();
  }

  function undoPoint() {
    if (!points.length) return;
    points.pop();
    var m = markers.pop();
    if (m) map.removeLayer(m);
    redrawDraft();
    if (window.AndroidBridge) AndroidBridge.onPoints(points.length);
  }

  function clearPoints() {
    points = [];
    markers.forEach(function(m){ map.removeLayer(m); });
    markers = [];
    redrawDraft();
    if (window.AndroidBridge) AndroidBridge.onPoints(0);
  }

  /** Returns the drawn shape as [lng, lat] pairs — the order the server stores. */
  function getPoints() {
    return JSON.stringify(points.map(function(p){ return [p[1], p[0]]; }));
  }

  /** Draws every saved building and fits the view around them. */
  function renderGeofences(list) {
    if (!map) return;
    saved.forEach(function(l){ map.removeLayer(l); });
    saved = [];
    if (!list || !list.length) return;
    var bounds = [];
    list.forEach(function(g) {
      // Stored as [lng, lat]; Leaflet wants [lat, lng].
      var latlngs = g.polygon.map(function(p){ return [p[1], p[0]]; });
      if (latlngs.length < 3) return;
      var layer = L.polygon(latlngs, {color:'#5B4CDB', weight:2, fillOpacity:0.18}).addTo(map);
      layer.bindTooltip(g.name, {permanent:true, direction:'center', className:'gf-label'});
      saved.push(layer);
      bounds = bounds.concat(latlngs);
    });
    if (bounds.length && !drawing) map.fitBounds(bounds, {padding:[24,24], maxZoom:18});
  }

  boot();
</script>
</body>
</html>
""".trimIndent()
