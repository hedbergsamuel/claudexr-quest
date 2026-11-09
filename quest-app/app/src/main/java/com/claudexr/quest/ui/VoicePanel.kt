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
 * Big push-to-talk panel, placed close to the head (finger reach). Press and hold the big button to speak,
 * release to send. The recognised text is previewed here (Skicka / Avbryt) before it goes to the chat,
 * so there is no separate "Jag hörde" card that could collide with the next attempt.
 * 0.50 x 0.40 m at 1000 dp/m.
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
          else -> "Håll in knappen och tala. Släpp för att skicka." to Muted
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
 * Large hold-to-talk target (>= 0.44 x 0.17 m). Works with ray + pinch/trigger held; direct finger poke depends on
 * the Spatial SDK mapping touches to pointer events (UNTESTED on a headset). If the panel is removed while pressed,
 * the release is still reported so the microphone never stays open.
 */
@Composable
fun HoldToTalkBig(enabled: Boolean, held: Boolean, onTalk: (Boolean) -> Unit) {
  val pressed = remember { mutableStateOf(false) }
  DisposableEffect(Unit) {
    onDispose {
      if (pressed.value) {
        pressed.value = false
        onTalk(false)
      }
    }
  }
  val on = pressed.value || held
  Box(
      Modifier.fillMaxWidth()
          .height(170.dp)
          .clip(RoundedCornerShape(28.dp))
          .background(if (!enabled) Color(0xFF1F2024) else if (on) Red else Grey)
          .then(
              if (enabled)
                  Modifier.pointerInput(Unit) {
                    detectTapGestures(
                        onPress = {
                          pressed.value = true
                          onTalk(true)
                          tryAwaitRelease()
                          pressed.value = false
                          onTalk(false)
                        },
                    )
                  }
              else Modifier,
          ),
      contentAlignment = Alignment.Center,
  ) {
    Text(
        when {
          !enabled -> "Transkriberar…"
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
