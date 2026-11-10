package com.claudexr.quest

import java.nio.ByteBuffer
import org.json.JSONArray
import org.json.JSONObject

// Mirror of bridge/src/protocol.ts. JSON text frames + binary video frames over WSS.
const val PROTOCOL_VERSION = 2
const val SERVICE_TYPE = "_claudexr._tcp"
const val DEFAULT_WS_PATH = "/headset"

enum class Role(val wire: String) {
  PRIMARY("primary"),
  COMPARE("compare"),
  LOG("log"),
  SIDE("side"),
  OVERLAY("overlay");

  companion object {
    fun from(s: String?): Role = entries.firstOrNull { it.wire == s } ?: PRIMARY
  }
}

data class AskOption(val label: String, val description: String?)

sealed interface PanelSpec

data class AskSpec(val question: String, val options: List<AskOption>, val context: String?) : PanelSpec

data class PreviewSpec(val url: String, val title: String?, val size: String, val device: String = "none") : PanelSpec

data class CompareSpec(
    val title: String?,
    val question: String?,
    val aLabel: String,
    val aUrl: String,
    val bLabel: String,
    val bUrl: String,
    val wantChoice: Boolean,
) : PanelSpec

data class TestSpec(val title: String, val instructions: String, val url: String?, val checklist: List<String>) : PanelSpec

data class TextSpec(val title: String, val content: String, val format: String) : PanelSpec

/** [format]: null/"html" = a rendered template or page (its panel grows to fit); "text"/"diff"/"log"/"md" = scrolling text. */
data class HtmlSpec(val title: String, val html: String, val size: String, val format: String? = null) : PanelSpec

/** Exactly what will run (never masked/clipped by the bridge) plus risk warnings. */
data class PermissionSpec(
    val title: String,
    val tool: String,
    val subject: String,
    val detail: String?,
    val diff: String?,
    val warnings: List<String>,
) : PanelSpec

data class StreamSpec(val title: String, val streamId: String, val source: String, val app: String?) : PanelSpec

/** xr_ask listen:true: "hold to talk" card. */
data class ListenSpec(val prompt: String) : PanelSpec

/** "Jag hörde: …" confirmation before a spoken answer goes to Claude. */
data class HeardSpec(val text: String, val target: String, val autoSendMs: Int) : PanelSpec

/** World position as reported to / requested by the bridge. */
data class Placement(
    val x: Float? = null,
    val y: Float? = null,
    val z: Float? = null,
    val right: Float? = null,
    val up: Float? = null,
    val forward: Float? = null,
)

data class ActivityInfo(
    val state: String,
    val todos: List<Pair<String, String>>, // text, status
    val steps: List<String>,
)

data class ScreenInfo(val widthM: Float, val heightM: Float, val markerOffsetX: Float, val markerOffsetY: Float)

sealed interface BridgeMessage

/** [open] = panel ids the bridge still has; the app keeps those (no WebView reloads on reconnect). */
data class Welcome(val host: String, val bridgeVersion: String, val devMode: Boolean, val open: Set<String>?) : BridgeMessage

data class PairCodeShown(val expiresInS: Int) : BridgeMessage

data class PairOk(val token: String, val deviceId: String) : BridgeMessage

data class PairFailed(val reason: String) : BridgeMessage

data class Unauthorized(val reason: String) : BridgeMessage

data class Show(val id: String, val role: Role, val awaitingResponse: Boolean, val panel: PanelSpec) : BridgeMessage

data class Update(
    val id: String,
    val role: Role?,
    val panel: PanelSpec?,
    val widthM: Float?,
    val heightM: Float?,
    val placement: Placement?,
) : BridgeMessage

data class Clear(val id: String?, val role: Role?) : BridgeMessage

data class Layout(val mode: String, val minimizedIds: Set<String>) : BridgeMessage

data class Activity(val info: ActivityInfo) : BridgeMessage

data class Toast(val text: String, val level: String, val sound: Boolean) : BridgeMessage

/** Voice command "centrera": move panels in front of the user. */
object Recenter : BridgeMessage

/** 0.3.0: every panel id the bridge knows; the app removes any other panel (orphan sweeper). */
data class Sync(val ids: Set<String>) : BridgeMessage

/** 0.3.0: voice pipeline state (listening -> transcribing -> preview -> sent|queued|cancelled|error|idle). */
data class VoiceState(
    val id: String?,
    val state: String,
    val text: String?,
    val target: String?,
    val detail: String?,
    val autoSendMs: Int,
) : BridgeMessage

data class HudStream(val streamId: String, val title: String, val source: String, val state: String)

/** 0.3.0: always-visible status line (what is streamed, mic, dimming). */
data class Hud(
    val text: String,
    val streams: List<HudStream>,
    val micListening: Boolean,
    val dimmed: Boolean,
    val displayState: String,
) : BridgeMessage

data class StreamState(val streamId: String, val state: String, val reason: String?, val width: Int, val height: Int) :
    BridgeMessage

data class Calibrate(
    val requestId: String,
    val payload: String,
    val modules: Int,
    val markerSizeM: Float,
    val screen: ScreenInfo,
    val seconds: Int,
) : BridgeMessage

/** Binary frame on the /video socket: [0xC2][u8 idLen][id][u32 seq][u64 captureUs][u8 flags][Annex-B payload] */
class VideoFrame(val streamId: String, val seq: Long, val ptsUs: Long, val keyframe: Boolean, val data: ByteArray)

object Protocol {
  /** Returns null for unknown/malformed messages (they are ignored). */
  fun parse(text: String): BridgeMessage? =
      try {
        val o = JSONObject(text)
        when (o.optString("type")) {
          "welcome" ->
              Welcome(o.optString("host", "Mac"), o.optString("bridgeVersion", "?"), o.optBoolean("devMode"), o.optJSONArray("open")?.strings()?.toSet())
          "pair_code_shown" -> PairCodeShown(o.optInt("expiresInS", 120))
          "pair_ok" -> PairOk(o.getString("token"), o.optString("deviceId"))
          "pair_failed" -> PairFailed(o.optString("reason"))
          "unauthorized" -> Unauthorized(o.optString("reason"))
          "clear" -> Clear(o.optStringOrNull("id"), o.optStringOrNull("role")?.let { Role.from(it) })
          "show" ->
              parsePanel(o.getJSONObject("panel"))?.let {
                Show(o.getString("id"), Role.from(o.optString("role")), o.optBoolean("awaitingResponse"), it)
              }
          "update" ->
              Update(
                  o.getString("id"),
                  o.optStringOrNull("role")?.let { Role.from(it) },
                  o.optJSONObject("panel")?.let { parsePanel(it) },
                  o.optFloatOrNull("widthM"),
                  o.optFloatOrNull("heightM"),
                  o.optJSONObject("placement")?.let { parsePlacement(it) },
              )
          "layout" -> Layout(o.optString("mode", "review"), o.optJSONArray("ids")?.strings()?.toSet() ?: emptySet())
          "activity" -> {
            val a = o.getJSONObject("activity")
            Activity(
                ActivityInfo(
                    a.optString("state", "idle"),
                    a.optJSONArray("todos")?.objects()?.map { it.optString("text") to it.optString("status") } ?: emptyList(),
                    a.optJSONArray("steps")?.objects()?.map { it.optString("text") } ?: emptyList(),
                ),
            )
          }
          "recenter" -> Recenter
          "sync" -> Sync(o.optJSONArray("ids")?.strings()?.toSet() ?: emptySet())
          "voice_state" ->
              VoiceState(
                  o.optStringOrNull("id"),
                  o.optString("state", "idle"),
                  o.optStringOrNull("text"),
                  o.optStringOrNull("target"),
                  o.optStringOrNull("detail"),
                  o.optInt("autoSendMs"),
              )
          "hud" ->
              Hud(
                  o.optString("text"),
                  o.optJSONArray("streams")?.objects()?.map { HudStream(it.optString("streamId"), it.optString("title"), it.optString("source"), it.optString("state")) } ?: emptyList(),
                  o.optBoolean("micListening"),
                  o.optBoolean("dimmed"),
                  o.optString("displayState", "off"),
              )
          "toast" -> Toast(o.optString("text"), o.optString("level", "info"), o.optBoolean("sound"))
          "stream_state" ->
              StreamState(o.getString("streamId"), o.optString("state"), o.optStringOrNull("reason"), o.optInt("width"), o.optInt("height"))
          "calibrate" -> {
            val s = o.getJSONObject("screen")
            val off = s.optJSONObject("markerOffsetM")
            Calibrate(
                o.getString("requestId"),
                o.getString("payload"),
                o.optInt("modules", 25),
                o.getDouble("markerSizeM").toFloat(),
                ScreenInfo(
                    s.getDouble("widthM").toFloat(),
                    s.getDouble("heightM").toFloat(),
                    off?.optDouble("x", 0.0)?.toFloat() ?: 0f,
                    off?.optDouble("y", 0.0)?.toFloat() ?: 0f,
                ),
                o.optInt("seconds", 20),
            )
          }
          else -> null
        }
      } catch (e: Exception) {
        null
      }

  private fun parsePlacement(p: JSONObject): Placement {
    val pos = p.optJSONObject("position")
    val rel = p.optJSONObject("relative")
    return Placement(
        pos?.optFloatOrNull("x"),
        pos?.optFloatOrNull("y"),
        pos?.optFloatOrNull("z"),
        rel?.optFloatOrNull("right"),
        rel?.optFloatOrNull("up"),
        rel?.optFloatOrNull("forward"),
    )
  }

  private fun parsePanel(p: JSONObject): PanelSpec? =
      when (p.optString("kind")) {
        "ask" ->
            AskSpec(
                p.getString("question"),
                p.getJSONArray("options").objects().map { AskOption(it.getString("label"), it.optStringOrNull("description")) },
                p.optStringOrNull("context"),
            )
        "preview" -> PreviewSpec(p.getString("url"), p.optStringOrNull("title"), p.optString("size", "medium"), p.optString("device", "none"))
        "compare" -> {
          val a = p.getJSONObject("a")
          val b = p.getJSONObject("b")
          CompareSpec(
              p.optStringOrNull("title"),
              p.optStringOrNull("question"),
              a.getString("label"),
              a.getString("url"),
              b.getString("label"),
              b.getString("url"),
              p.optBoolean("wantChoice", true),
          )
        }
        "test" ->
            TestSpec(p.getString("title"), p.getString("instructions"), p.optStringOrNull("url"), p.optJSONArray("checklist")?.strings() ?: emptyList())
        "text" -> TextSpec(p.getString("title"), p.getString("content"), p.optString("format", "text"))
        "html" -> HtmlSpec(p.optString("title"), p.getString("html"), p.optString("size", "medium"), p.optStringOrNull("format"))
        "permission" ->
            PermissionSpec(
                p.optString("title"),
                p.optString("tool"),
                p.optString("subject"),
                p.optStringOrNull("detail"),
                p.optStringOrNull("diff"),
                p.optJSONArray("warnings")?.strings() ?: emptyList(),
            )
        "stream" -> StreamSpec(p.optString("title"), p.getString("streamId"), p.optString("source"), p.optStringOrNull("app"))
        "listen" -> ListenSpec(p.optString("prompt"))
        "heard" -> HeardSpec(p.optString("text"), p.optString("target"), p.optInt("autoSendMs"))
        else -> null
      }

  fun parseVideo(b: ByteArray): VideoFrame? {
    if (b.size < 16 || b[0] != 0xC2.toByte()) return null
    val idLen = b[1].toInt() and 0xff
    if (b.size < 2 + idLen + 13) return null
    val id = String(b, 2, idLen, Charsets.US_ASCII)
    val bb = ByteBuffer.wrap(b, 2 + idLen, 13)
    val seq = bb.int.toLong() and 0xffffffffL
    val pts = bb.long
    val flags = bb.get().toInt()
    return VideoFrame(id, seq, pts, flags and 1 == 1, b.copyOfRange(2 + idLen + 13, b.size))
  }

  fun videoHello(token: String): String = JSONObject().put("type", "video_hello").put("token", token).toString()

  fun videoAck(streamId: String, seq: Long): String = JSONObject().put("type", "ack").put("s", streamId).put("seq", seq).toString()

  fun videoIdr(streamId: String): String = JSONObject().put("type", "idr").put("s", streamId).toString()

  fun hello(token: String, device: String, appVersion: String): String =
      JSONObject()
          .put("type", "hello")
          .put("protocol", PROTOCOL_VERSION)
          .put("token", token)
          .put("device", device)
          .put("app", "claudexr-quest")
          .put("appVersion", appVersion)
          .toString()

  fun pairRequest(device: String): String = JSONObject().put("type", "pair_request").put("device", device).toString()

  fun pairConfirm(device: String, nonce: String, mac: String): String =
      JSONObject().put("type", "pair_confirm").put("device", device).put("nonce", nonce).put("mac", mac).toString()

  fun response(id: String, data: JSONObject): String = JSONObject().put("type", "response").put("id", id).put("data", data).toString()

  fun dismissed(id: String): String = JSONObject().put("type", "dismissed").put("id", id).toString()

  fun panelMoved(id: String, x: Float, y: Float, z: Float, widthM: Float, heightM: Float): String =
      JSONObject()
          .put("type", "panel_moved")
          .put("id", id)
          .put("placement", JSONObject().put("position", JSONObject().put("x", x.toDouble()).put("y", y.toDouble()).put("z", z.toDouble())))
          .put("widthM", widthM.toDouble())
          .put("heightM", heightM.toDouble())
          .toString()

  fun calibrationResult(requestId: String, ok: Boolean, error: String?, detections: Int, residualPx: Float): String =
      JSONObject()
          .put("type", "calibration_result")
          .put("requestId", requestId)
          .put("ok", ok)
          .put("detections", detections)
          .put("residualPx", residualPx.toDouble())
          .apply { if (error != null) put("error", error) }
          .toString()

  fun appLog(level: String, message: String): String =
      JSONObject().put("type", "app_log").put("level", level).put("message", message.take(500)).toString()

  fun askAnswer(choiceIndex: Int): JSONObject = JSONObject().put("choiceIndex", choiceIndex)

  fun compareAnswer(choice: String): JSONObject = JSONObject().put("choice", choice)

  fun voiceStart(id: String, panelId: String?): String =
      JSONObject().put("type", "voice_start").put("id", id).apply { if (panelId != null) put("panelId", panelId) }.toString()

  fun voiceEnd(id: String): String = JSONObject().put("type", "voice_end").put("id", id).toString()

  fun voiceCancel(id: String): String = JSONObject().put("type", "voice_cancel").put("id", id).toString()

  fun voiceError(reason: String): String = JSONObject().put("type", "voice_error").put("reason", reason).toString()

  fun voiceDecision(id: String, send: Boolean): String =
      JSONObject().put("type", "voice_decision").put("id", id).put("send", send).toString()

  const val EMERGENCY_CLOSE = """{"type":"emergency_close"}"""
  const val CLOSE_OTHERS = """{"type":"close_others"}"""
  const val RESTART_DISPLAY = """{"type":"restart_display"}"""

  fun heardAnswer(send: Boolean): JSONObject = JSONObject().put("send", send)

  fun permissionAnswer(allow: Boolean): JSONObject = JSONObject().put("decision", if (allow) "allow" else "deny")

  fun testAnswer(works: Boolean, checked: List<Boolean>): JSONObject =
      JSONObject().put("verdict", if (works) "works" else "broken").put("checked", JSONArray(checked))
}

private fun JSONObject.optStringOrNull(key: String): String? = if (has(key) && !isNull(key)) getString(key) else null

private fun JSONObject.optFloatOrNull(key: String): Float? = if (has(key) && !isNull(key)) getDouble(key).toFloat() else null

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
