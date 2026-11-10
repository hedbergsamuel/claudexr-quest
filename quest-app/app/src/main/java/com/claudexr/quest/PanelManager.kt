package com.claudexr.quest

import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import com.claudexr.quest.ui.AskCard
import com.claudexr.quest.ui.ComparePanel
import com.claudexr.quest.ui.HtmlPanel
import com.claudexr.quest.ui.ListenPanel
import com.claudexr.quest.ui.PermissionCard
import com.claudexr.quest.ui.PreviewPanel
import com.claudexr.quest.ui.StreamBadge
import com.claudexr.quest.ui.TestCard
import com.claudexr.quest.ui.TextPanel
import com.meta.spatial.compose.composePanel
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Vector3
import com.meta.spatial.runtime.LayerConfig
import com.meta.spatial.toolkit.AppSystemActivity
import com.meta.spatial.toolkit.Grabbable
import com.meta.spatial.toolkit.GrabbableType
import com.meta.spatial.toolkit.MediaPanelSettings
import com.meta.spatial.toolkit.PanelRegistration
import com.meta.spatial.toolkit.PixelDisplayOptions
import com.meta.spatial.toolkit.QuadShapeOptions
import com.meta.spatial.toolkit.Scale
import com.meta.spatial.toolkit.Transform
import com.meta.spatial.toolkit.VideoSurfacePanelRegistration
import com.meta.spatial.toolkit.Visible
import com.meta.spatial.toolkit.createPanelEntity
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

/**
 * One Spatial SDK panel entity per bridge panel id. Panels are registered at runtime with a fresh
 * integer id (pattern from Meta's "Focus" showcase). Content updates go through Compose state;
 * size changes re-create the panel. Must be called on the main thread (except [onVideo]).
 */
class PanelManager(
    private val activity: AppSystemActivity,
    private val layout: RoleLayout,
    private val overlay: () -> OverlayStore.Overlay?,
    private val onRecenter: () -> Unit,
    private val video: VideoLink,
    /** push-to-talk aimed at a panel (null = global): down = true while held */
    private val talk: (panelId: String?, down: Boolean) -> Unit,
    private val send: (String) -> Boolean,
    /** visible system panels (activity panel ...) that planned panels must not cover: centre, width, height */
    private val systemPanels: () -> List<Triple<Vector3, Float, Float>> = { emptyList() },
) {
  /** Video acks / IDR requests go back on the video socket. */
  interface VideoLink {
    fun ack(streamId: String, seq: Long)

    fun idr(streamId: String)
  }

  private inner class Open(var id: String, var role: Role, val spec: MutableState<PanelSpec>, var widthM: Float, var heightM: Float) {
    var entity: Entity? = null
    var regIds = mutableListOf<Int>()
    var minimized = false
    /** HTML panels grow once to fit their content (BUG-0863a3); reset when the content changes */
    var fitted = false
    var movedByUser = false
    var placedPose: Pose? = null
    var lastSeenPose: Pose? = null
    // streams
    var streamId: String? = null
    var videoW = 1920
    var videoH = 1200
    var decoder: VideoDecoder? = null
    var badge: Entity? = null
    val streamState = mutableStateOf("starting")
  }

  private val open = LinkedHashMap<String, Open>()
  private val byStream = ConcurrentHashMap<String, Open>()
  private var nextRegistrationId = 0x7f_c0_00_00 // far away from R.id values
  val count = mutableIntStateOf(0)

  // ---------------- bridge messages ----------------

  /** Review P4: one hidden, fully composed ask card is kept ready, so xr_ask only swaps state. */
  private var prewarmed: Open? = null
  private val hiddenPose = Pose(Vector3(0f, -10f, 0f))

  private fun prewarm() {
    if (prewarmed != null) return
    val o = Open("__prewarm", Role.PRIMARY, mutableStateOf(AskSpec("", emptyList(), null)), 0.8f, PREWARM_ASK_H)
    create(o, hiddenPose)
    o.entity?.setComponent(Visible(false))
    prewarmed = o
  }

  fun show(msg: Show) {
    if (open.containsKey(msg.id)) return // re-sent after a reconnect: already visible
    val warm = prewarmed
    if (msg.panel is AskSpec && warm != null && sizeFor(msg.panel).second <= PREWARM_ASK_H) {
      prewarmed = null
      warm.id = msg.id
      warm.role = msg.role
      warm.spec.value = msg.panel
      open[msg.id] = warm
      recenterIfRoomIsEmpty(warm)
      place(warm, defaultPose(warm))
      warm.entity?.setComponent(Visible(true))
      count.intValue = open.size
      return
    }
    val (w, h) = sizeFor(msg.panel)
    val o = Open(msg.id, msg.role, mutableStateOf(msg.panel), w, h)
    if (msg.panel is StreamSpec) {
      o.streamId = msg.panel.streamId
      byStream[msg.panel.streamId] = o
      if (msg.role == Role.OVERLAY) overlay()?.let { o.widthM = it.widthM; o.heightM = it.heightM }
    } else if (msg.role == Role.OVERLAY) {
      // BUG-405388: anything else shown "on the Mac screen" is never bigger than the Mac screen.
      macBox()?.let { m ->
        val (fw, fh) = PlacementPlanner.fitInside(o.widthM, o.heightM, m.second, m.third)
        o.widthM = fw
        o.heightM = fh
      }
    }
    open[msg.id] = o
    recenterIfRoomIsEmpty(o)
    create(o, defaultPose(o))
    count.intValue = open.size
  }

  fun update(msg: Update) {
    val o = open[msg.id] ?: return
    msg.panel?.let {
      if (it::class == o.spec.value::class) {
        o.spec.value = it
        o.fitted = false // new content may need more room
      }
    }
    var recreate = false
    if (msg.widthM != null && msg.heightM != null && (msg.widthM != o.widthM || msg.heightM != o.heightM) && o.role != Role.OVERLAY) {
      o.widthM = msg.widthM
      o.heightM = msg.heightM
      recreate = true
    }
    if (msg.role != null && msg.role != o.role) {
      o.role = msg.role
      o.movedByUser = false
    }
    val p = msg.placement
    val pose =
        when {
          p?.forward != null -> layout.relativePose(p.right ?: 0f, p.up ?: 0f, p.forward)
          p?.x != null && p.y != null && p.z != null -> Pose(Vector3(p.x, p.y, p.z), o.entity?.getComponent<Transform>()?.transform?.q ?: Pose().q)
          msg.role != null -> defaultPose(o)
          else -> null
        }
    if (pose != null) o.movedByUser = true // explicitly placed: keep it there on relayout
    if (recreate) {
      val keep = pose ?: o.entity?.getComponent<Transform>()?.transform ?: defaultPose(o)
      destroy(o)
      create(o, keep)
    } else if (pose != null) place(o, pose)
  }

  fun clear(msg: Clear) {
    open.values.filter { msg.id?.let { id -> it.id == id } ?: msg.role?.let { r -> it.role == r } ?: true }.map { it.id }.forEach { remove(it) }
  }

  /** "Stäng allt": remove every panel, then sweep anything the ledger says was created but is no longer owned. */
  fun clearAll() {
    open.keys.toList().forEach { remove(it) }
    sweepLeaks()
  }

  /** Reconnect: keep what the bridge still has (no WebView reloads, review patch 09), drop the rest. */
  fun retainOnly(ids: Set<String>) = open.keys.filter { it !in ids }.forEach { remove(it) }

  /** 0.3.0 orphan sweeper: the bridge sends every panel id it knows; anything else is removed. */
  fun sync(ids: Set<String>) {
    retainOnly(ids)
    sweepLeaks()
  }

  /** Control socket lost: never leave an old (blank/stale) video panel in the room. */
  fun dropStreams() {
    open.values.filter { it.streamId != null }.map { it.id }.forEach { remove(it) }
  }

  fun ids(): Set<String> = open.keys.toSet()

  // ---- ledger: every entity / panel registration this class ever created, so leaks can be swept ----
  private val ledgerEntities = mutableListOf<Pair<Open, Entity>>()
  private val ledgerRegs = mutableListOf<Pair<Open, Int>>()

  private fun sweepLeaks() {
    val live = open.values.toSet()
    val ents = ledgerEntities.filter { (o, _) -> o !== prewarmed && o !in live }
    ents.forEach { (_, e) -> runCatching { e.destroy() } }
    ledgerEntities.removeAll(ents)
    val regs = ledgerRegs.filter { (o, _) -> o !== prewarmed && o !in live }
    regs.forEach { (_, r) -> runCatching { activity.panelRegistrations.remove(r) } }
    ledgerRegs.removeAll(regs)
  }

  fun layoutMode(msg: Layout) {
    open.values.forEach { it.minimized = it.id in msg.minimizedIds }
    relayout(keepUserMoves = true)
  }

  /**
   * Plan every panel again (see PlacementPlanner). Recenter (keepUserMoves=false) also resets user moves.
   * Order: the Mac screen first (everything else is planned around it), then panels the user placed (they stay),
   * then the rest in the order they were opened.
   */
  fun relayout(keepUserMoves: Boolean = false) {
    var tray = 0
    open.values.forEach { if (!keepUserMoves) it.movedByUser = false }
    open.values.filter { it.role == Role.OVERLAY && !it.minimized && !it.movedByUser }.forEach { place(it, overlayPose(it)) }
    val placed = ArrayList<Open>(open.values.filter { !it.minimized && it.movedByUser })
    open.values.forEach {
      if (it.minimized) {
        place(it, layout.trayPose(tray++), scale = 0.35f)
      } else if (it.movedByUser) {
        it.entity?.setComponent(Scale(Vector3(1f)))
      } else if (it.role != Role.OVERLAY) {
        place(it, planPose(it, placed))
        placed += it
      }
    }
  }

  /** Overlay was (re)calibrated or adjusted: move/resize mirror panels. */
  fun applyOverlay(o: OverlayStore.Overlay) {
    open.values.filter { it.role == Role.OVERLAY }.forEach {
      it.widthM = o.widthM
      it.heightM = o.heightM
      destroy(it)
      create(it, o.pose)
    }
  }

  /** Pose-only overlay nudge (no panel re-creation, so the video keeps playing). */
  fun moveOverlay(pose: Pose) {
    open.values.filter { it.role == Role.OVERLAY }.forEach { place(it, pose) }
  }

  // ---------------- streams ----------------

  fun streamState(msg: StreamState) {
    val o = byStream[msg.streamId] ?: return
    o.streamState.value = msg.state
    if (msg.state == "live" && msg.width > 0 && msg.height > 0 && (msg.width != o.videoW || msg.height != o.videoH)) {
      o.videoW = msg.width
      o.videoH = msg.height
      if (o.role != Role.OVERLAY) o.heightM = o.widthM * msg.height / msg.width
      val pose = o.entity?.getComponent<Transform>()?.transform ?: defaultPose(o)
      destroy(o)
      create(o, pose) // new surface with the right aspect; decoder restarts at the next keyframe
    }
    // Privacy: hide the last frame while the Mac is locked / the stream is paused.
    o.entity?.setComponent(Visible(msg.state == "live"))
    if (msg.state == "stopped" || msg.state == "error") remove(o.id)
  }

  /** Called on the network thread. Every frame is acked (credit-based flow control on the bridge). */
  fun onVideo(f: VideoFrame) {
    // Review 2 R2-04: acked by the decoder once the frame is inside MediaCodec (not on arrival).
    val d = byStream[f.streamId]?.decoder
    if (d != null) d.submit(f) else video.ack(f.streamId, f.seq)
  }

  // ---------------- per-frame housekeeping ----------------

  private var lastCheck = 0L

  /** Detect panels the user grabbed and moved; report them so the bridge state stays true. */
  fun tick() {
    val now = System.currentTimeMillis()
    if (now - lastCheck < 500) return
    lastCheck = now
    prewarm()
    for (o in open.values) {
      val pose = o.entity?.getComponent<Transform>()?.transform ?: continue
      o.badge?.setComponent(Transform(pose.times(Pose(Vector3(0f, o.heightM / 2 + 0.05f, 0f)))))
      val placed = o.placedPose ?: continue
      val moved = (pose.t - placed.t).length() > 0.02f
      val stable = o.lastSeenPose?.let { (pose.t - it.t).length() < 0.005f } ?: false
      o.lastSeenPose = pose
      if (moved && stable) {
        o.placedPose = pose
        o.movedByUser = true
        send(Protocol.panelMoved(o.id, pose.t.x, pose.t.y, pose.t.z, o.widthM, o.heightM))
      }
    }
  }

  // ---------------- internals ----------------

  private fun defaultPose(o: Open): Pose = if (o.role == Role.OVERLAY) overlayPose(o) else planPose(o, open.values.filter { !it.minimized })

  /** The stream panel that shows the Mac screen (role overlay), if any. */
  private fun macPanel(): Open? = open.values.firstOrNull { it.role == Role.OVERLAY && it.spec.value is StreamSpec && !it.minimized && it.placedPose != null }

  /** Where the Mac screen is and how big: the live mirror panel, else the saved calibration. Centre, width, height. */
  private fun macBox(): Triple<Vector3, Float, Float>? {
    macPanel()?.let { m -> return Triple(m.placedPose!!.t, m.widthM, m.heightM) }
    return overlay()?.let { Triple(it.pose.t, it.widthM, it.heightM) }
  }

  /** Role overlay = on the Mac screen. The mirror itself sits exactly there; anything else 3 cm in front of it. */
  private fun overlayPose(o: Open): Pose {
    val base = overlay()?.pose ?: (if (o.spec.value is StreamSpec) null else macPanel()?.placedPose) ?: layout.poseFor(Role.OVERLAY, 0)
    if (o.spec.value is StreamSpec) return base
    val eye = layout.frame(base.t).eye
    val toEye = eye - base.t
    val l = toEye.length()
    return if (l > 0.1f) Pose(base.t + toEye * (0.03f / l), base.q) else base
  }

  private fun zoneOf(o: Open): PlacementPlanner.Zone {
    val spec = o.spec.value
    return when {
      // Cards that wait for an answer: closest to the user and never under another panel.
      spec is AskSpec || spec is PermissionSpec || spec is ListenSpec || spec is HeardSpec || (spec is TestSpec && spec.url == null) -> PlacementPlanner.Zone.QUESTION
      o.role == Role.SIDE -> PlacementPlanner.Zone.RIGHT
      o.role == Role.LOG -> PlacementPlanner.Zone.LEFT
      else -> PlacementPlanner.Zone.CENTER
    }
  }

  /**
   * A free spot for [o]: never on top of [others] (where they are NOW, also after the user moved them), never
   * behind or below the Mac screen (BUG-1fcf21, BUG-3115b5, BUG-4a4024, BUG-068994, BUG-405388).
   */
  private fun planPose(o: Open, others: Collection<Open>): Pose {
    val mac = macBox()
    val frame = layout.frame(mac?.first)
    val occupied =
        others
            .filter { it !== o && !it.minimized && it.role != Role.OVERLAY }
            .mapNotNull { p -> p.placedPose?.let { layout.rectOf(frame, it.t, p.widthM, p.heightM) } } +
            systemPanels().map { layout.rectOf(frame, it.first, it.second, it.third) }
    val spot = PlacementPlanner.plan(zoneOf(o), o.widthM, o.heightM, occupied, mac?.let { layout.rectOf(frame, it.first, it.second, it.third) })
    return layout.poseAt(frame, spot)
  }

  /** Without a Mac screen the layout origin follows the user: the first panel in an empty room re-captures it. */
  private fun recenterIfRoomIsEmpty(o: Open) {
    if (open.values.none { it !== o && !it.minimized }) layout.recenter()
  }

  /** The WebView measured its content: grow the panel (once per content) so nothing has to be scrolled. */
  private fun fitContent(o: Open, contentDp: Int) {
    val spec = o.spec.value
    if (o.fitted || spec !is HtmlSpec || (spec.format != null && spec.format != "html") || o.role == Role.OVERLAY || o.minimized) return
    val want = ((contentDp + HTML_HEADER_DP) / DP_PER_METER).coerceAtMost(MAX_FIT_HEIGHT_M)
    if (want <= o.heightM * 1.03f) return
    // Not from inside the WebView callback of the very panel that is about to be destroyed.
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      if (open[o.id] !== o || o.fitted) return@post
      o.fitted = true
      o.heightM = want
      val keep = if (o.movedByUser) o.placedPose else null
      destroy(o)
      create(o, keep ?: defaultPose(o))
    }
  }

  private fun create(o: Open, pose: Pose) {
    val regId = nextRegistrationId++
    val spec = o.spec.value
    if (spec is StreamSpec) {
      activity.registerPanel(
          VideoSurfacePanelRegistration(
              regId,
              surfaceConsumer = { _, surface ->
                o.decoder?.release()
                o.decoder =
                    VideoDecoder(
                        surface,
                        o.videoW,
                        o.videoH,
                        onHandedToDecoder = { f -> video.ack(f.streamId, f.seq) },
                        onNeedKeyframe = { video.idr(spec.streamId) },
                    )
                spec.streamId.let(video::idr) // new surface: start from an IDR frame
              },
              settingsCreator = { MediaPanelSettings(QuadShapeOptions(o.widthM, o.heightM), PixelDisplayOptions(o.videoW, o.videoH)) },
          ),
      )
      // Always-visible streaming indicator (separate small panel above the video).
      val badgeId = nextRegistrationId++
      activity.registerPanel(composeRegistration(badgeId, 0.42f, 0.07f) { StreamBadge(spec, o.streamState.value) { dismiss(o.id) } })
      o.badge = Entity.createPanelEntity(badgeId, Transform(pose.times(Pose(Vector3(0f, o.heightM / 2 + 0.05f, 0f)))))
      o.badge?.let { ledgerEntities += o to it }
      ledgerRegs += o to badgeId
      o.regIds += badgeId
    } else {
      activity.registerPanel(composeRegistration(regId, o.widthM, o.heightM) { Content(o) })
    }
    o.regIds += regId
    ledgerRegs += o to regId
    // Overlay mirrors stay where calibration put them; everything else can be grabbed and moved.
    val grab = Grabbable(o.role != Role.OVERLAY, GrabbableType.FACE)
    o.entity = Entity.createPanelEntity(regId, Transform(pose), grab)
    o.entity?.let { ledgerEntities += o to it }
    o.placedPose = pose
    if (o.minimized) o.entity?.setComponent(Scale(Vector3(0.35f)))
  }

  private fun composeRegistration(regId: Int, w: Float, h: Float, content: @Composable () -> Unit) =
      PanelRegistration(regId) { _ ->
        config {
          width = w
          height = h
          layoutWidthInDp = w * DP_PER_METER
          layoutHeightInDp = h * DP_PER_METER
          layerConfig = LayerConfig()
          enableTransparent = true
          includeGlass = false
          themeResourceId = R.style.PanelTheme
        }
        composePanel { setContent { content() } }
      }

  private fun place(o: Open, pose: Pose, scale: Float = 1f) {
    o.entity?.setComponent(Transform(pose))
    o.entity?.setComponent(Scale(Vector3(scale)))
    o.placedPose = pose
    o.lastSeenPose = null
  }

  private fun destroy(o: Open) {
    o.decoder?.release()
    o.decoder = null
    o.entity?.destroy()
    o.badge?.destroy()
    o.entity = null
    o.badge = null
    // Review patch 06: registrations were never removed (unbounded growth, kept panel content alive).
    o.regIds.forEach { activity.panelRegistrations.remove(it) }
    o.regIds.clear()
    ledgerEntities.removeAll { it.first === o }
    ledgerRegs.removeAll { it.first === o }
  }

  private fun remove(id: String) {
    val o = open.remove(id) ?: return
    o.streamId?.let { byStream.remove(it) }
    destroy(o)
    count.intValue = open.size
  }

  private fun answer(id: String, data: JSONObject) {
    send(Protocol.response(id, data))
    remove(id)
  }

  private fun dismiss(id: String) {
    send(Protocol.dismissed(id))
    remove(id)
  }

  @Composable
  private fun Content(o: Open) {
    val id = o.id
    when (val spec = o.spec.value) {
      is AskSpec ->
          AskCard(spec, onChoose = { answer(id, Protocol.askAnswer(it)) }, onDismiss = { dismiss(id) }, onRecenter = onRecenter, onTalk = { talk(o.id, it) })
      is CompareSpec ->
          ComparePanel(spec, onChoose = { answer(id, Protocol.compareAnswer(it)) }, onDismiss = { dismiss(id) }, onRecenter = onRecenter, onTalk = { talk(o.id, it) })
      is TestSpec ->
          TestCard(
              spec,
              onVerdict = { works, checked -> answer(id, Protocol.testAnswer(works, checked)) },
              onDismiss = { dismiss(id) },
              onRecenter = onRecenter,
              onTalk = { talk(o.id, it) },
          )
      is ListenSpec -> ListenPanel(spec, onTalk = { talk(o.id, it) }, onDismiss = { dismiss(id) })
      // 0.3.0: the bridge no longer sends "heard" cards (preview happens in the voice panel); an old bridge's card
      // is answered "cancel" so nothing is sent by accident and nothing is left behind.
      is HeardSpec -> androidx.compose.runtime.LaunchedEffect(id) { answer(id, Protocol.heardAnswer(false)) }
      is PreviewSpec -> PreviewPanel(spec, onDismiss = { dismiss(id) }, onRecenter = onRecenter)
      is TextSpec -> TextPanel(spec, onDismiss = { dismiss(id) }, onRecenter = onRecenter)
      is HtmlSpec -> HtmlPanel(spec, onDismiss = { dismiss(id) }, onRecenter = onRecenter, onContentHeight = { fitContent(o, it) })
      // No talk button on permission cards: voice can never approve anything.
      is PermissionSpec -> PermissionCard(spec, onDecision = { answer(id, Protocol.permissionAnswer(it)) }, onDismiss = { dismiss(id) })
      is StreamSpec -> Unit // rendered by the video panel
    }
  }

  companion object {
    const val DP_PER_METER = 1000f
    private const val PREWARM_ASK_H = 0.81f
    /** the ⟲ ✕ row above the WebView of an HTML panel */
    private const val HTML_HEADER_DP = 56f
    private const val MAX_FIT_HEIGHT_M = 1.25f

    /** Panel size in metres (width, height). At 1000 dp/m one dp is 1 mm. Content scrolls if needed. */
    fun sizeFor(p: PanelSpec): Pair<Float, Float> =
        when (p) {
          is AskSpec -> 0.80f to (0.33f + (if (p.context != null) 0.08f else 0f) + 0.10f * p.options.size)
          is PreviewSpec ->
              when (p.device) {
                "phone" -> 0.42f to 0.86f
                "tablet" -> 0.75f to 0.95f
                else ->
                    when (p.size) {
                      "small" -> 0.80f to 0.55f
                      "large" -> 1.80f to 1.10f
                      "wide" -> 1.80f to 0.80f
                      else -> 1.20f to 0.80f
                    }
              }
          is HtmlSpec ->
              when (p.size) {
                "small" -> 0.70f to 0.50f
                "large" -> 1.60f to 1.00f
                "wide" -> 1.70f to 0.80f
                else -> 1.10f to 0.75f
              }
          is CompareSpec -> 2.00f to 0.90f
          is TestSpec -> if (p.url != null) 1.20f to 1.10f else 0.85f to (0.42f + 0.07f * p.checklist.size)
          is TextSpec -> 0.90f to 0.70f
          is PermissionSpec -> 0.95f to (if (p.diff != null) 0.85f else 0.55f)
          is StreamSpec -> 0.90f to 0.5625f
          is ListenSpec -> 0.70f to 0.42f
          is HeardSpec -> 0.70f to 0.40f
        }
  }
}
