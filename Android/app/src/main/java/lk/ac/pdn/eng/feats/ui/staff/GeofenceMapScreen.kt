package lk.ac.pdn.eng.feats.ui.staff

import android.content.Context
import android.graphics.Color as AndroidColor
import android.graphics.drawable.GradientDrawable
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
import lk.ac.pdn.eng.feats.ui.components.PillButton
import lk.ac.pdn.eng.feats.ui.components.PillTone
import lk.ac.pdn.eng.feats.ui.components.PrimaryButton
import lk.ac.pdn.eng.feats.ui.theme.AppShapes
import lk.ac.pdn.eng.feats.ui.theme.Palette
import org.osmdroid.config.Configuration
import org.osmdroid.events.MapEventsReceiver
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.util.MapTileIndex
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.CopyrightOverlay
import org.osmdroid.views.overlay.MapEventsOverlay
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Overlay
import org.osmdroid.views.overlay.Polygon
import org.osmdroid.views.overlay.Polyline
import java.io.File

// Faculty of Engineering, University of Peradeniya. Keep the map deterministic:
// this editor manages faculty buildings, so a device's unrelated last location
// must never move its initial camera away from the campus.
private const val ENGINEERING_FACULTY_LAT = 7.25439
private const val ENGINEERING_FACULTY_LNG = 80.59169
private const val ENGINEERING_FACULTY_ZOOM = 17.5

/**
 * Satellite imagery instead of the OSM street layer: building footprints are far
 * easier to trace accurately against actual roofs than against street-map
 * outlines. Esri's World Imagery service is free and needs no API key, same as
 * the OSM tiles it replaces.
 *
 * osmdroid's stock XYTileSource builds z/x/y URLs; Esri's tile REST API expects
 * z/y/x, so this overrides getTileURLString rather than reusing it.
 */
private val SatelliteTileSource = object : OnlineTileSourceBase(
    "EsriWorldImagery",
    0,
    19,
    256,
    "",
    arrayOf("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/"),
    "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
) {
    override fun getTileURLString(pMapTileIndex: Long): String =
        baseUrl + MapTileIndex.getZoom(pMapTileIndex) + "/" +
            MapTileIndex.getY(pMapTileIndex) + "/" +
            MapTileIndex.getX(pMapTileIndex)
}

/**
 * Admin Geofences tab. The map is **always visible** with every saved building
 * drawn on it; "Add building" switches the same map into draw mode rather than
 * opening a separate editor.
 *
 * The map is deliberately inline (not a Compose `Dialog`) so saved geofences stay
 * visible as context while a new building is drawn.
 */
@Composable
fun GeofencesTab(state: StaffState, vm: StaffViewModel) {
    var drawing by remember { mutableStateOf(false) }
    var pointCount by remember { mutableStateOf(0) }
    var name by remember { mutableStateOf("") }
    var mapController by remember { mutableStateOf<GeofenceMapController?>(null) }

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
                    // A native MapView still needs a bounded height inside LazyColumn.
                    GeofenceMapView(
                        geofences = state.geofences,
                        drawing = drawing,
                        onReady = { mapController = it },
                        onPointCountChanged = { pointCount = it },
                        modifier = Modifier.fillMaxWidth().height(380.dp),
                    )

                    Column(Modifier.padding(14.dp)) {
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
                                    name = ""
                                    pointCount = 0
                                    drawing = true
                                    mapController?.setDrawing(true)
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
                                PillButton("Undo", onClick = { mapController?.undoPoint() }, tone = PillTone.Neutral)
                                Spacer(Modifier.width(6.dp))
                                PillButton("Clear", onClick = { mapController?.clearPoints() }, tone = PillTone.Neutral)
                            }
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                PillButton(
                                    "Cancel",
                                    onClick = {
                                        drawing = false
                                        pointCount = 0
                                        mapController?.setDrawing(false)
                                    },
                                    tone = PillTone.Neutral,
                                )
                                PillButton(
                                    "Save building",
                                    tone = PillTone.Success,
                                    enabled = name.isNotBlank() && pointCount >= 3,
                                    onClick = {
                                        val polygon = mapController?.polygon().orEmpty()
                                        if (polygon.size >= 3) {
                                            vm.createGeofence(name.trim(), polygon)
                                            drawing = false
                                            pointCount = 0
                                            name = ""
                                            mapController?.setDrawing(false)
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

/**
 * Owns the native map overlays and the draft polygon. Keeping this state beside
 * [MapView] avoids a JavaScript bridge and lets the Compose controls call the map
 * directly.
 */
private class GeofenceMapController(
    private val context: Context,
    private val map: MapView,
    private val onPointCountChanged: (Int) -> Unit,
) {
    private val points = mutableListOf<GeoPoint>()
    private val savedOverlays = mutableListOf<Overlay>()
    private val draftOverlays = mutableListOf<Overlay>()
    private var drawing = false
    private var savedSignature: Int? = null

    private val eventOverlay = MapEventsOverlay(object : MapEventsReceiver {
        override fun singleTapConfirmedHelper(point: GeoPoint?): Boolean {
            if (!drawing || point == null) return false
            points += GeoPoint(point.latitude, point.longitude)
            redrawDraft()
            onPointCountChanged(points.size)
            return true
        }

        override fun longPressHelper(point: GeoPoint?): Boolean = false
    })

    init {
        map.overlays += eventOverlay
    }

    fun setDrawing(enabled: Boolean) {
        if (drawing == enabled) return
        drawing = enabled
        clearPoints()
    }

    fun undoPoint() {
        if (points.isEmpty()) return
        points.removeAt(points.lastIndex)
        redrawDraft()
        onPointCountChanged(points.size)
    }

    fun clearPoints() {
        points.clear()
        redrawDraft()
        onPointCountChanged(0)
    }

    /** Server polygon order is [longitude, latitude]. */
    fun polygon(): List<List<Double>> = points.map { listOf(it.longitude, it.latitude) }

    fun renderSaved(geofences: List<GeofenceDto>) {
        val signature = geofences.hashCode()
        if (signature == savedSignature) return
        savedSignature = signature

        map.overlays.removeAll(savedOverlays.toSet())
        savedOverlays.clear()

        val allPoints = mutableListOf<GeoPoint>()
        geofences.forEach { geofence ->
            val polygonPoints = geofence.polygon.orEmpty().mapNotNull { pair ->
                if (pair.size < 2) null else GeoPoint(pair[1], pair[0])
            }
            if (polygonPoints.size < 3) return@forEach
            allPoints += polygonPoints
            val polygon = Polygon(map).apply {
                setPoints(polygonPoints)
                title = geofence.name.orEmpty()
                outlinePaint.color = AndroidColor.rgb(91, 76, 219)
                outlinePaint.strokeWidth = context.dp(2f)
                fillPaint.color = AndroidColor.argb(48, 123, 97, 255)
            }
            savedOverlays += polygon
            map.overlays += polygon
        }

        keepEventOverlayOnTop()
        map.invalidate()
        if (allPoints.isNotEmpty() && !drawing) fitTo(allPoints)
    }

    fun detach() {
        map.onPause()
        map.onDetach()
    }

    private fun redrawDraft() {
        map.overlays.removeAll(draftOverlays.toSet())
        draftOverlays.clear()

        if (points.size >= 2) {
            val line = Polyline(map).apply {
                setPoints(this@GeofenceMapController.points)
                outlinePaint.color = AndroidColor.rgb(122, 20, 20)
                outlinePaint.strokeWidth = context.dp(2.5f)
            }
            draftOverlays += line
            map.overlays += line
        }
        if (points.size >= 3) {
            val area = Polygon(map).apply {
                setPoints(this@GeofenceMapController.points)
                outlinePaint.color = AndroidColor.rgb(122, 20, 20)
                outlinePaint.strokeWidth = context.dp(2.5f)
                fillPaint.color = AndroidColor.argb(38, 122, 20, 20)
            }
            draftOverlays += area
            map.overlays += area
        }
        points.forEach { point ->
            val marker = Marker(map).apply {
                position = point
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                icon = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(AndroidColor.rgb(122, 20, 20))
                    setStroke(context.dp(1f).toInt(), AndroidColor.WHITE)
                    val diameter = context.dp(12f).toInt()
                    setSize(diameter, diameter)
                }
            }
            draftOverlays += marker
            map.overlays += marker
        }
        keepEventOverlayOnTop()
        map.invalidate()
    }

    private fun keepEventOverlayOnTop() {
        map.overlays.remove(eventOverlay)
        map.overlays += eventOverlay
    }

    private fun fitTo(points: List<GeoPoint>) {
        val bounds = BoundingBox(
            points.maxOf { it.latitude },
            points.maxOf { it.longitude },
            points.minOf { it.latitude },
            points.minOf { it.longitude },
        )
        map.post { map.zoomToBoundingBox(bounds, true, context.dp(28f).toInt()) }
    }
}

@Composable
private fun GeofenceMapView(
    geofences: List<GeofenceDto>,
    drawing: Boolean,
    onReady: (GeofenceMapController) -> Unit,
    onPointCountChanged: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    var mapState by remember { mutableStateOf<GeofenceMapController?>(null) }

    // The effect must not be keyed by mapState: assigning the newly-created
    // controller would dispose the previous effect and detach that same MapView
    // immediately, shutting down its tile writer/executors.
    DisposableEffect(Unit) {
        onDispose { mapState?.detach() }
    }

    AndroidView(
        modifier = modifier,
        factory = { context ->
            // Use app-private cache paths so no storage permission is needed.
            val cacheRoot = File(context.cacheDir, "osmdroid").apply { mkdirs() }
            Configuration.getInstance().apply {
                userAgentValue = context.packageName
                osmdroidBasePath = cacheRoot
                osmdroidTileCache = File(cacheRoot, "tiles").apply { mkdirs() }
            }

            MapView(context).apply {
                setTileSource(SatelliteTileSource)
                setMultiTouchControls(true)
                minZoomLevel = 3.0
                maxZoomLevel = 20.0
                controller.setZoom(ENGINEERING_FACULTY_ZOOM)
                controller.setCenter(GeoPoint(ENGINEERING_FACULTY_LAT, ENGINEERING_FACULTY_LNG))
                overlays += CopyrightOverlay(context)
                onResume()

                val mapController = GeofenceMapController(context, this, onPointCountChanged)
                mapState = mapController
                mapController.renderSaved(geofences)
                mapController.setDrawing(drawing)
                onReady(mapController)
            }
        },
        update = {
            mapState?.renderSaved(geofences)
            mapState?.setDrawing(drawing)
        },
    )
}

private fun Context.dp(value: Float): Float = value * resources.displayMetrics.density
