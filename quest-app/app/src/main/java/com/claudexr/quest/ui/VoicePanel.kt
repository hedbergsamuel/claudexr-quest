package com.claudexr.quest.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Whether the microphone session is live (set by MainActivity). The talk buttons use it to drop a "latched" tap when
 * the session ended some other way (30 s limit, panel closed, connection lost).
 */
object MicState {
  val active = mutableStateOf(false)
}

/** A press shorter than this is a tap: the microphone stays on until the next tap (see holdOrTapToTalk). */
const val TAP_LATCH_MS = 400L

/**
 * Hold to talk, OR tap once to start and once more to send. 0.3.x only had hold: with hand tracking a pinch is
 * easily lost mid-sentence, and a held press that never reported its release left the microphone session stuck so
 * that every later press was ignored (BUG-36fba1, BUG-82a49d, BUG-8324e4). UNTESTED on a headset.
 */
suspend fun androidx.compose.ui.input.pointer.PointerInputScope.holdOrTapToTalk(
    pressed: androidx.compose.runtime.MutableState<Boolean>,
    latched: androidx.compose.runtime.MutableState<Boolean>,
    onTalk: (Boolean) -> Unit,
) {
  detectTapGestures(
      onPress = {
        if (latched.value) {
          // second tap: stop and send
          latched.value = false
          onTalk(false)
          tryAwaitRelease()
          return@detectTapGestures
        }
        val t0 = android.os.SystemClock.uptimeMillis()
        pressed.value = true
        onTalk(true)
        val released = tryAwaitRelease()
        pressed.value = false
        if (released && MicState.active.value && android.os.SystemClock.uptimeMillis() - t0 < TAP_LATCH_MS) latched.value = true
        else onTalk(false)
      },
  )
}

/** What the bridge last said about the voice pipeline (voice_state). */
data class VoiceUi(
    val id: String? = null,
    /** idle | listening | transcribing | preview | sent | queued | cancelled | error */
    val state: String = "idle",
    val text: String? = null,
    val target: String? = null,
    val detail: String? = null,
    val autoSendMs: Int = 0,
)

private val Red = Color(0xFFB3261E)
private val Green = Color(0xFF3A8F5C)
private val Grey = Color(0xFF2C2E35)

/**
 * Big push-to-talk panel. Hold the big button to speak and release to send, or tap once to start and once more to
 * send. The recognised text is previewed here (Skicka / Avbryt) before it goes to the chat, so there is no separate
 * "Jag hörde" card that could collide with the next attempt.
 * 0.4.0: 0.60 x 0.46 m, 0.75 m away and below the line of sight (0.3.x: 0.40 m from the head, where it sat between
 * the user and the card being answered and where the hand rays start behind the panel: BUG-8324e4).
 */
@Composable
fun VoicePanel(
    ui: VoiceUi,
    held: Boolean,
    mediaUp: Boolean,
    onTalk: (Boolean) -> Unit,
    onDecision: (Boolean) -> Unit,
    onClose: () -> Unit,
) {
  val state = if (held) "listening" else ui.state
  Column(Modifier.fillMaxSize().clip(RoundedCornerShape(28.dp)).background(Bg).padding(18.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text("Röst", color = Fg, fontSize = TitleSize, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
      TextButton(onClick = onClose) { Text("✕", color = Muted, fontSize = TitleSize) }
    }
    val (status, color) =
        when (state) {
          "listening" -> "● Mikrofonen är på, släpp för att skicka" to Color(0xFFFF6B5E)
          "transcribing" -> "Transkriberar… (vänta)" to Accent
          "preview" -> "Skickas först när du trycker Skicka" to Muted
          "sent" -> "✓ Skickat${ui.detail?.let { ": $it" } ?: ""}" to Color(0xFF4CC38A)
          "queued" -> "Köat${ui.detail?.let { ": $it" } ?: ""}" to Color(0xFFE0B341)
          "cancelled" -> "Avbrutet" to Muted
          "error" -> "Fel: ${ui.detail ?: "okänt"}" to Color(0xFFF08A8A)
          else -> "Håll in och tala, eller tryck en gång för att starta och en gång till för att skicka." to Muted
        }
    Text(status, color = color, fontSize = SmallSize, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(vertical = 4.dp))
    if (!mediaUp) Text("Röstkanalen återansluter…", color = Color(0xFFE0B341), fontSize = 16.sp)
    Spacer(Modifier.height(6.dp))
    if (state == "preview") {
      PreviewBlock(ui, onDecision, Modifier.weight(1f))
    } else {
      Spacer(Modifier.weight(1f))
      HoldToTalkBig(enabled = state != "transcribing", held = held || state == "listening", onTalk = onTalk)
    }
  }
}

@Composable
private fun PreviewBlock(ui: VoiceUi, onDecision: (Boolean) -> Unit, modifier: Modifier) {
  val left = remember(ui.id, ui.text) { mutableIntStateOf(ui.autoSendMs / 1000) }
  if (ui.autoSendMs > 0) {
    LaunchedEffect(ui.id, ui.text) {
      while (left.intValue > 0) {
        kotlinx.coroutines.delay(1000)
        left.intValue--
      }
    }
  }
  Column(modifier.fillMaxWidth()) {
    Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
      Text("“${ui.text ?: ""}”", color = Fg, fontSize = BodySize)
    }
    ui.target?.let { Text("Till: $it", color = Muted, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxWidth().height(110.dp)) {
      Button(
          onClick = { onDecision(true) },
          modifier = Modifier.weight(1f).fillMaxSize(),
          shape = RoundedCornerShape(20.dp),
          colors = ButtonDefaults.buttonColors(containerColor = Green),
      ) {
        Text(if (ui.autoSendMs > 0) "Skicka (${left.intValue})" else "Skicka", fontSize = TitleSize, fontWeight = FontWeight.SemiBold)
      }
      Button(
          onClick = { onDecision(false) },
          modifier = Modifier.weight(1f).fillMaxSize(),
          shape = RoundedCornerShape(20.dp),
          colors = ButtonDefaults.buttonColors(containerColor = Grey),
      ) {
        Text("Avbryt", fontSize = TitleSize)
      }
    }
  }
}

/**
 * Large talk target (>= 0.44 x 0.17 m). Hold, or tap to start and tap again to send (holdOrTapToTalk). Works with
 * ray + pinch/trigger; direct finger poke depends on the Spatial SDK mapping touches to pointer events (UNTESTED on a
 * headset). If the panel is removed while the microphone is on, the release is still reported so it never stays open.
 */
@Composable
fun HoldToTalkBig(enabled: Boolean, held: Boolean, onTalk: (Boolean) -> Unit) {
  val pressed = remember { mutableStateOf(false) }
  val latched = remember { mutableStateOf(false) }
  LaunchedEffect(MicState.active.value) { if (!MicState.active.value) latched.value = false }
  DisposableEffect(Unit) {
    onDispose {
      if (pressed.value || latched.value) {
        pressed.value = false
        latched.value = false
        onTalk(false)
      }
    }
  }
  val on = pressed.value || latched.value || held
  Box(
      Modifier.fillMaxWidth()
          .height(170.dp)
          .clip(RoundedCornerShape(28.dp))
          .background(if (!enabled) Color(0xFF1F2024) else if (on) Red else Grey)
          .then(
              if (enabled)
                  Modifier.pointerInput(Unit) { holdOrTapToTalk(pressed, latched, onTalk) }
              else Modifier,
          ),
      contentAlignment = Alignment.Center,
  ) {
    Text(
        when {
          !enabled -> "Transkriberar…"
          latched.value -> "● Tryck för att skicka"
          on -> "● Släpp för att skicka"
          else -> "🎤 Håll in och tala"
        },
        color = Fg,
        fontSize = 34.sp,
        fontWeight = FontWeight.SemiBold,
        textAlign = TextAlign.Center,
    )
  }
}
