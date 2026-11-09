package com.claudexr.quest

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.ComposeView
import com.claudexr.quest.ui.ActivityPanel
import com.claudexr.quest.ui.OverlayAdjustPanel
import com.claudexr.quest.ui.PairingPanel
import com.claudexr.quest.ui.StatusPanel
import com.claudexr.quest.ui.ToastPanel
import com.claudexr.quest.ui.VoicePanel
import com.claudexr.quest.ui.VoiceUi
import com.meta.spatial.compose.ComposeFeature
import com.meta.spatial.compose.ComposeViewPanelRegistration
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Quaternion
import com.meta.spatial.core.SpatialFeature
import com.meta.spatial.core.Vector3
import com.meta.spatial.mruk.MRUKFeature
import com.meta.spatial.mruk.MRUKLoadDeviceResult
import com.meta.spatial.runtime.ReferenceSpace
import com.meta.spatial.toolkit.AppSystemActivity
import com.meta.spatial.toolkit.DpPerMeterDisplayOptions
import com.meta.spatial.toolkit.Grabbable
import com.meta.spatial.toolkit.GrabbableType
import com.meta.spatial.toolkit.Panel
import com.meta.spatial.toolkit.PanelRegistration
import com.meta.spatial.toolkit.PanelStyleOptions
import com.meta.spatial.toolkit.QuadShapeOptions
import com.meta.spatial.toolkit.Transform
import com.meta.spatial.toolkit.UIPanelSettings
import com.meta.spatial.toolkit.Visible
import com.meta.spatial.vr.VRFeature

/**
 * ClaudeXR: a passthrough (mixed reality) app that shows panels Claude Code asks for.
 *
 * Flow: Bonjour discovery -> WSS to the bridge on the Mac (pinned certificate, pairing code) ->
 * "show"/"update"/"layout"/... -> PanelManager -> user answers -> "response".
 *
 * Optional manual override (skips Bonjour):
 *   adb shell am start -n com.claudexr.quest/.MainActivity --es bridge_url wss://192.168.1.20:47800/headset
 */
class MainActivity : AppSystemActivity() {
  private lateinit var mruk: MRUKFeature
  private lateinit var layout: RoleLayout
  private lateinit var panels: PanelManager
  private lateinit var connection: BridgeConnection
  private lateinit var overlayStore: OverlayStore
  private lateinit var calibrator: ScreenCalibrator
  private val main = Handler(Looper.getMainLooper())

  private var statusEntity: Entity? = null
  private var pairingEntity: Entity? = null
  private var activityEntity: Entity? = null
  private var toastEntity: Entity? = null
  private var adjustEntity: Entity? = null
  private var voiceEntity: Entity? = null

  private val activityInfo = mutableStateOf(ActivityInfo("idle", emptyList(), emptyList()))
  private val toast = mutableStateOf(Toast("", "info", false))
  private val cameraNote = mutableStateOf<String?>(null)
  private val adjustNote = mutableStateOf<String?>(null)

  // 0.3.0 HUD / voice / activity visibility
  private val hud = mutableStateOf<Hud?>(null)
  private val voiceUi = mutableStateOf(VoiceUi())
  private val micHeld = mutableStateOf(false)
  private val voiceOpen = mutableStateOf(false)
  private var voiceAutoOpened = false
  private var activityHidden = false
  private var activityHiddenState: String? = null
  private val vibrator by lazy { getSystemService(android.os.Vibrator::class.java) }
  private var overlay: OverlayStore.Overlay? = null
  private var pendingCalibration: Calibrate? = null
  private val tone by lazy { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60) }

  /** Set by the Quest system recenter (onRecenter) or a Recenter button; handled on the next frame. */
  @Volatile private var recenterRequested = false

  override fun registerFeatures(): List<SpatialFeature> {
    mruk = MRUKFeature(this, systemManager)
    return listOf(VRFeature(this), ComposeFeature(), mruk)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    layout = RoleLayout(systemManager, mruk) { scene.getViewerPose() }
    overlayStore = OverlayStore(this, mruk) { scene }
    calibrator = ScreenCalibrator(this, { scene.getViewerPose() }) { r -> main.post { onCalibrated(r) } }
    connection =
        BridgeConnection(
            this,
            intent.getStringExtra("bridge_url"),
            BuildConfig.VERSION_NAME,
            onMessage = ::onBridgeMessage,
            onVideo = { panels.onVideo(it) },
            onLost = ::onConnectionLost,
        )
    panels =
        PanelManager(
            this,
            layout,
            { overlay },
            onRecenter = { recenterRequested = true },
            video =
                object : PanelManager.VideoLink {
                  override fun ack(streamId: String, seq: Long) = connection.ackVideo(streamId, seq)

                  override fun idr(streamId: String) = connection.requestIdr(streamId)
                },
            talk = ::pushToTalk,
        ) {
          connection.send(it)
        }
    loadRoomScan()
  }

  override fun onSceneReady() {
    super.onSceneReady()
    scene.enablePassthrough(true) // mixed reality: the user's room stays visible (also required by the camera API)
    scene.setReferenceSpace(ReferenceSpace.LOCAL_FLOOR)
    statusEntity = Entity.create(listOf(Panel(R.id.status_panel), Transform(layout.statusPose()), Grabbable(true, GrabbableType.FACE)))
    pairingEntity = Entity.create(listOf(Panel(R.id.pairing_panel), Transform(layout.poseFor(Role.PRIMARY, 0)), Visible(false)))
    activityEntity = Entity.create(listOf(Panel(R.id.activity_panel), Transform(layout.activityPose()), Grabbable(true, GrabbableType.FACE), Visible(false)))
    toastEntity = Entity.create(listOf(Panel(R.id.toast_panel), Transform(layout.toastPose()), Visible(false)))
    adjustEntity = Entity.create(listOf(Panel(R.id.adjust_panel), Transform(layout.poseFor(Role.SIDE, 0)), Grabbable(true, GrabbableType.FACE), Visible(false)))
    // Voice panel: close to the head, not grabbable (a grab must never compete with the hold-to-talk press).
    voiceEntity = Entity.create(listOf(Panel(R.id.voice_panel), Transform(layout.nearHeadPose(VOICE_DISTANCE_M, VOICE_DOWN_M)), Visible(false)))
    connection.start()
  }

  override fun onSceneTick() {
    super.onSceneTick()
    // Head tracking is often not ready in onSceneReady: keep trying until we have a real head pose,
    // then move the provisional panels in front of the user. Same path for explicit recenter.
    if (!layout.hasOrigin || recenterRequested) {
      if (layout.recenter()) {
        recenterRequested = false
        panels.relayout()
        statusEntity?.setComponent(Transform(layout.statusPose()))
        activityEntity?.setComponent(Transform(layout.activityPose()))
        toastEntity?.setComponent(Transform(layout.toastPose()))
      }
    }
    pairingEntity?.setComponent(Visible(connection.state.value == BridgeConnection.State.PAIRING))
    activityEntity?.setComponent(Visible(connection.state.value == BridgeConnection.State.CONNECTED && activityShown()))
    panels.tick()
  }

  /** Called by the Spatial SDK when the user holds the Meta button to recenter (system recenter). */
  override fun onRecenter(isUserInitiated: Boolean) {
    super.onRecenter(isUserInitiated)
    recenterRequested = true
  }

  // Review P4: keep the Wi-Fi radio out of power-save while the app is in front (lower, steadier latency).
  private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null

  override fun onResume() {
    super.onResume()
    runCatching {
      val wm = applicationContext.getSystemService(android.net.wifi.WifiManager::class.java)
      wifiLock = wifiLock ?: wm.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "claudexr")
      if (wifiLock?.isHeld == false) wifiLock?.acquire()
    }
    if (::connection.isInitialized) connection.nudge() // reconnect at once after taking the headset off/on
  }

  override fun onPause() {
    // Review 2 R2-06: the microphone and the passthrough camera must not stay open while the app is in
    // the background (headset taken off mid push-to-talk: the "release" event never arrives).
    cancelVoiceCapture()
    if (::calibrator.isInitialized) calibrator.cancel("app_paused")
    runCatching { if (wifiLock?.isHeld == true) wifiLock?.release() }
    super.onPause()
  }

  override fun onDestroy() {
    connection.stop()
    super.onDestroy()
  }

  private fun settings(w: Float, h: Float): (Entity) -> UIPanelSettings = { _ ->
    UIPanelSettings(
        shape = QuadShapeOptions(width = w, height = h),
        style = PanelStyleOptions(themeResourceId = R.style.PanelTheme),
        display = DpPerMeterDisplayOptions(PanelManager.DP_PER_METER),
    )
  }

  private fun compose(id: Int, w: Float, h: Float, content: @androidx.compose.runtime.Composable () -> Unit) =
      ComposeViewPanelRegistration(id, composeViewCreator = { _, ctx -> ComposeView(ctx).apply { setContent { content() } } }, settingsCreator = settings(w, h))

  override fun registerPanels(): List<PanelRegistration> =
      listOf(
          compose(R.id.status_panel, 1.25f, 0.15f) {
            val state by connection.state.collectAsState()
            val host by connection.host.collectAsState()
            StatusPanel(
                state = state.name,
                host = host,
                panelCount = panels.count.intValue,
                cameraNote = cameraNote.value,
                hud = hud.value,
                micHeld = micHeld.value,
                voiceOpen = voiceOpen.value,
                onRecenter = { recenterRequested = true },
                onCloseAll = ::closeEverything,
                onRestartDisplay = { connection.send(Protocol.RESTART_DISPLAY) },
                onCalibrate = { connection.send("""{"type":"request_calibration"}""") },
                onAdjust = { adjustEntity?.setComponent(Visible(true)) },
                onUnpair = { connection.unpair() },
                onVoice = { toggleVoicePanel() },
            )
          },
          compose(R.id.pairing_panel, 0.6f, 0.70f) {
            val msg by connection.pairMessage.collectAsState()
            val certId by connection.certId.collectAsState()
            PairingPanel(msg, certId, onSubmit = { connection.submitCode(it) }, onNewCode = { connection.requestCode() })
          },
          compose(R.id.activity_panel, 0.5f, 0.5f) { ActivityPanel(activityInfo.value, onClose = ::hideActivity) },
          compose(R.id.voice_panel, VOICE_W_M, VOICE_H_M) {
            val up by connection.mediaUp.collectAsState()
            VoicePanel(
                ui = voiceUi.value,
                held = micHeld.value,
                mediaUp = up,
                onTalk = { pushToTalk(null, it) },
                onDecision = ::decideVoice,
                onClose = ::closeVoicePanel,
            )
          },
          compose(R.id.toast_panel, 0.6f, 0.1f) { ToastPanel(toast.value.text, toast.value.level) },
          compose(R.id.adjust_panel, 0.62f, 0.44f) {
            OverlayAdjustPanel(
                onNudge = ::nudgeOverlay,
                onSave = { overlay?.let { adjustNote.value = if (overlayStore.save(it)) "Sparat (förankrat i rummet)" else "Sparat (utan rumsskanning: gäller tills recenter)" } },
                onRecalibrate = { connection.send("""{"type":"request_calibration"}""") },
                onClose = { adjustEntity?.setComponent(Visible(false)) },
                note = adjustNote.value,
            )
          },
      )

  private fun onBridgeMessage(msg: BridgeMessage) {
    when (msg) {
      // A (re)connect: the bridge re-sends whatever is still open, so start from a clean slate.
      is Welcome -> {
        msg.open?.let { panels.sync(it) } ?: panels.clearAll()
        voiceUi.value = VoiceUi()
      }
      is Sync -> panels.sync(msg.ids)
      is Hud -> hud.value = msg
      is VoiceState -> onVoiceState(msg)
      is Show -> panels.show(msg)
      is Update -> panels.update(msg)
      is Clear -> {
        panels.clear(msg)
        if (msg.id == null && msg.role == null) hideActivity() // "close all" also tidies the activity panel
      }
      is Layout -> panels.layoutMode(msg)
      is Activity -> {
        activityInfo.value = msg.info
        // A hidden activity panel comes back when the activity state changes.
        if (activityHidden && msg.info.state != activityHiddenState) activityHidden = false
      }
      is Toast -> showToast(msg)
      is StreamState -> panels.streamState(msg)
      is Calibrate -> startCalibration(msg)
      Recenter -> recenterRequested = true
      else -> Unit
    }
  }

  private fun showToast(t: Toast) {
    toast.value = t
    toastEntity?.setComponent(Transform(layout.toastPose()))
    toastEntity?.setComponent(Visible(true))
    if (t.sound) runCatching { tone.startTone(if (t.level == "attention") ToneGenerator.TONE_PROP_ACK else ToneGenerator.TONE_PROP_BEEP2, 180) }
    main.removeCallbacksAndMessages(TOAST_TOKEN)
    main.postAtTime({ toastEntity?.setComponent(Visible(false)) }, TOAST_TOKEN, android.os.SystemClock.uptimeMillis() + 4000)
  }

  // ---- Activity panel visibility (0.3.0: it used to sit idle on the left and could not be closed) ----

  private fun activityShown(): Boolean {
    val a = activityInfo.value
    return !activityHidden && (a.state != "idle" || a.todos.isNotEmpty() || a.steps.isNotEmpty())
  }

  private fun hideActivity() {
    activityHidden = true
    activityHiddenState = activityInfo.value.state
    activityEntity?.setComponent(Visible(false))
  }

  /** Panic button ("Stäng allt"): panels, streams (bridge side), brightness (bridge side). Works offline too. */
  private fun closeEverything() {
    panels.clearAll()
    hideActivity()
    adjustEntity?.setComponent(Visible(false))
    closeVoicePanel()
    connection.send(Protocol.EMERGENCY_CLOSE)
    showToast(Toast("Stängde allt", "done", false))
  }

  /** Control socket lost: stream panels must never stay behind (blank or showing a stale frame). */
  private fun onConnectionLost() {
    if (::panels.isInitialized) panels.dropStreams()
    hud.value = null
    cancelVoiceCapture()
    if (voiceUi.value.state != "idle") voiceUi.value = VoiceUi()
  }

  // ---- Voice panel (near the head) ----

  private fun toggleVoicePanel() = if (voiceOpen.value) closeVoicePanel() else openVoicePanel(auto = false)

  private fun openVoicePanel(auto: Boolean) {
    voiceAutoOpened = auto
    if (!voiceOpen.value) voiceEntity?.setComponent(Transform(layout.nearHeadPose(VOICE_DISTANCE_M, VOICE_DOWN_M)))
    voiceOpen.value = true
    voiceEntity?.setComponent(Visible(true))
  }

  private fun closeVoicePanel() {
    cancelVoiceCapture()
    // A previewed transcript that is still waiting must not hang on the bridge: closing = cancel.
    val u = voiceUi.value
    if (u.state == "preview" && u.id != null) connection.send(Protocol.voiceDecision(u.id, false))
    voiceUi.value = VoiceUi()
    voiceOpen.value = false
    voiceAutoOpened = false
    voiceEntity?.setComponent(Visible(false))
  }

  private fun decideVoice(send: Boolean) {
    val u = voiceUi.value
    if (u.id != null) connection.send(Protocol.voiceDecision(u.id, send))
    voiceUi.value = if (send) u.copy(state = "sent", detail = "skickar…") else VoiceUi(state = "cancelled")
  }

  private fun onVoiceState(m: VoiceState) {
    voiceUi.value = VoiceUi(m.id, m.state, m.text, m.target, m.detail, m.autoSendMs)
    if (m.state == "idle") {
      if (voiceAutoOpened) closeVoicePanel()
      return
    }
    // A card's own hold button (or a voice command) shows its progress and the preview in this panel.
    if (!voiceOpen.value) openVoicePanel(auto = true)
    if (voiceAutoOpened && m.state in setOf("sent", "queued", "cancelled", "error")) {
      main.removeCallbacksAndMessages(VOICE_HIDE_TOKEN)
      main.postAtTime({ if (voiceAutoOpened && voiceUi.value.state in setOf("sent", "queued", "cancelled", "error")) closeVoicePanel() }, VOICE_HIDE_TOKEN, android.os.SystemClock.uptimeMillis() + 3500)
    }
  }

  // ---- Push-to-talk (microphone only while held; audio never stored) ----

  private val recorder = VoiceRecorder()
  private var voiceId: String? = null
  private var micStart: Runnable? = null

  private fun pushToTalk(panelId: String?, down: Boolean) {
    if (down) {
      if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MIC)
        return
      }
      if (voiceId != null) return
      val id = java.util.UUID.randomUUID().toString().take(8)
      if (!connection.sendMedia(Protocol.voiceStart(id, panelId))) {
        // Media socket is reconnecting: say so instead of failing silently.
        val msg = "Röstkanalen är inte uppe, försöker igen. Håll in igen om en sekund."
        showToast(Toast(msg, "attention", false))
        voiceUi.value = VoiceUi(state = "error", detail = msg)
        return
      }
      voiceId = id
      micHeld.value = true
      cue(start = true)
      showMic(true)
      // Open the microphone just after the start cue, so the beep is not recorded.
      val r = Runnable {
        micStart = null
        val cur = voiceId ?: return@Runnable
        if (!recorder.start { pcm -> connection.sendVoiceChunk(cur, pcm) }) {
          voiceId = null
          micHeld.value = false
          showMic(false)
          connection.sendMedia(Protocol.voiceCancel(cur))
          connection.sendMedia(Protocol.voiceError("mic_unavailable"))
          voiceUi.value = VoiceUi(state = "error", detail = "Mikrofonen kunde inte öppnas")
        }
      }
      micStart = r
      main.postDelayed(r, MIC_START_DELAY_MS)
    } else {
      val id = voiceId ?: return
      voiceId = null
      micHeld.value = false
      val pending = micStart
      micStart = null
      if (pending != null) {
        // Released before the microphone was even open: nothing was recorded, treat as cancelled.
        main.removeCallbacks(pending)
        showMic(false)
        connection.sendMedia(Protocol.voiceCancel(id))
        return
      }
      recorder.stop()
      showMic(false)
      cue(start = false)
      connection.sendMedia(Protocol.voiceEnd(id))
    }
  }

  /** Stop everything without sending audio (panel closed, app paused, connection lost). */
  private fun cancelVoiceCapture() {
    val id = voiceId ?: return
    voiceId = null
    micHeld.value = false
    micStart?.let { main.removeCallbacks(it) }
    micStart = null
    recorder.stop()
    showMic(false)
    connection.sendMedia(Protocol.voiceCancel(id))
  }

  /** Sound + short vibration when the microphone opens (rising) and closes (falling). Haptics are best effort. */
  private fun cue(start: Boolean) {
    runCatching { tone.startTone(if (start) ToneGenerator.TONE_PROP_BEEP else ToneGenerator.TONE_PROP_ACK, if (start) 70 else 110) }
    runCatching {
      vibrator?.vibrate(android.os.VibrationEffect.createOneShot(if (start) 45L else 25L, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
    }
  }

  /** Clear in-room indicator while the microphone is open (the voice panel shows it itself when open). */
  private fun showMic(on: Boolean) {
    if (on && !voiceOpen.value) {
      main.removeCallbacksAndMessages(TOAST_TOKEN)
      toast.value = Toast("● Mikrofonen är på", "attention", false)
      toastEntity?.setComponent(Transform(layout.toastPose()))
      toastEntity?.setComponent(Visible(true))
    } else if (!on) toastEntity?.setComponent(Visible(false))
  }

  // ---- Screen calibration (passthrough camera; images never leave the headset) ----

  private fun hasCameraPermissions() =
      checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED &&
          checkSelfPermission(ScreenCalibrator.PERMISSION_HEADSET_CAMERA) == PackageManager.PERMISSION_GRANTED

  private fun startCalibration(req: Calibrate) {
    lastCalibrationId = req.requestId
    if (hasCameraPermissions()) {
      cameraNote.value = "Kalibrerar: titta på Mac-skärmen och håll huvudet stilla"
      calibrator.start(req)
    } else {
      pendingCalibration = req
      requestPermissions(arrayOf(Manifest.permission.CAMERA, ScreenCalibrator.PERMISSION_HEADSET_CAMERA), REQUEST_CAMERA)
    }
  }

  private fun onCalibrated(r: ScreenCalibrator.Result) {
    val req = pendingCalibration
    pendingCalibration = null
    cameraNote.value = if (r.ok) null else "Kalibrering misslyckades: ${r.error}"
    if (r.ok && r.pose != null) {
      val o = OverlayStore.Overlay(r.pose, r.widthM, r.heightM, false)
      overlay = o
      val anchored = overlayStore.save(o)
      adjustNote.value = "${r.detections} detektioner, ~${"%.1f".format(r.residualPx)} px fel. ${if (anchored) "Förankrat i rummet." else "Ingen rumsskanning: gäller tills recenter."}"
      panels.applyOverlay(o)
      adjustEntity?.setComponent(Visible(true))
    }
    lastCalibrationId?.let { connection.send(Protocol.calibrationResult(it, r.ok, r.error, r.detections, r.residualPx)) }
    if (req != null && req.requestId != lastCalibrationId) Log.w(TAG, "stale calibration result")
  }

  private var lastCalibrationId: String? = null

  /** Small steps: 5 mm, 3 mm depth, 0.5 % size, 0.3° roll. */
  private fun nudgeOverlay(key: String) {
    val o = overlay ?: run { adjustNote.value = "Kalibrera först"; return }
    val q = o.pose.q
    val right = q.times(Vector3.Right)
    val up = q.times(Vector3.Up)
    val fwd = q.times(Vector3.Forward)
    var pose = o.pose
    var w = o.widthM
    var h = o.heightM
    when (key) {
      "left" -> pose = Pose(pose.t - right * 0.005f, q)
      "right" -> pose = Pose(pose.t + right * 0.005f, q)
      "up" -> pose = Pose(pose.t + up * 0.005f, q)
      "down" -> pose = Pose(pose.t - up * 0.005f, q)
      "closer" -> pose = Pose(pose.t - fwd * 0.003f, q)
      "farther" -> pose = Pose(pose.t + fwd * 0.003f, q)
      "rollL" -> pose = Pose(pose.t, q.times(Quaternion.fromAxisAngle(Vector3.Forward, 0.3f)))
      "rollR" -> pose = Pose(pose.t, q.times(Quaternion.fromAxisAngle(Vector3.Forward, -0.3f)))
      "bigger" -> { w *= 1.005f; h *= 1.005f }
      "smaller" -> { w /= 1.005f; h /= 1.005f }
      "wider" -> w *= 1.005f
      "narrower" -> w /= 1.005f
    }
    val n = o.copy(pose = pose, widthM = w, heightM = h)
    overlay = n
    if (w != o.widthM || h != o.heightM) panels.applyOverlay(n) else panels.moveOverlay(pose)
    adjustNote.value = "Ändrat (tryck Spara för att behålla)"
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    when (requestCode) {
      REQUEST_MIC ->
          if (grantResults.firstOrNull() != PackageManager.PERMISSION_GRANTED) {
            cameraNote.value = "Mikrofon nekad: röst går inte (Inställningar → Appar → ClaudeXR → Behörigheter)"
            connection.sendMedia(Protocol.voiceError("mic_denied"))
          } else showToast(Toast("Mikrofon tillåten: håll in knappen och tala", "info", false))
      REQUEST_USE_SCENE -> if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) loadScene()
      REQUEST_CAMERA -> {
        val req = pendingCalibration
        if (hasCameraPermissions() && req != null) {
          startCalibration(req)
        } else {
          cameraNote.value = "Kameraåtkomst nekad: kalibrering går inte (Inställningar → Appar → ClaudeXR → Behörigheter)"
          req?.let { connection.send(Protocol.calibrationResult(it.requestId, false, "camera_permission_denied", 0, 0f)) }
          pendingCalibration = null
        }
      }
    }
  }

  // ---- Room scan (MRUK). Without it, panels are simply placed at fixed distances. ----

  private fun loadRoomScan() {
    if (checkSelfPermission(PERMISSION_USE_SCENE) == PackageManager.PERMISSION_GRANTED) loadScene()
    else requestPermissions(arrayOf(PERMISSION_USE_SCENE), REQUEST_USE_SCENE)
  }

  private fun loadScene() {
    mruk.loadSceneFromDevice().whenComplete { result: MRUKLoadDeviceResult, _ ->
      Log.i(TAG, "room scan load result: $result")
      main.post { if (overlay == null) overlay = runCatching { overlayStore.load() }.getOrNull() }
    }
  }

  companion object {
    private const val TAG = "ClaudeXR"
    private const val PERMISSION_USE_SCENE = "com.oculus.permission.USE_SCENE"
    private const val REQUEST_USE_SCENE = 1
    private const val REQUEST_CAMERA = 2
    private const val REQUEST_MIC = 3
    private val TOAST_TOKEN = Any()
    private val VOICE_HIDE_TOKEN = Any()
    private const val MIC_START_DELAY_MS = 110L
    // Voice panel: ~0.40 m in front of the head, 12 cm below eye height (finger reach).
    private const val VOICE_DISTANCE_M = 0.40f
    private const val VOICE_DOWN_M = 0.12f
    private const val VOICE_W_M = 0.50f
    private const val VOICE_H_M = 0.40f

    // TODO(v3): a stand-alone voice-driven session (Agent SDK); text can't be injected safely into a running CLI.
    // TODO(v3): ISDK direct touch (poke) in addition to ray + pinch.
    // TODO(v3): remote control of the Mac (deliberately out of scope: view only).
  }
}
