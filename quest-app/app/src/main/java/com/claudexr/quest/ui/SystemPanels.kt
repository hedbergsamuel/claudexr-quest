package com.claudexr.quest.ui

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudexr.quest.ActivityInfo

/**
 * Status bar: connection, HUD line (what is streamed, microphone, dimming), voice panel toggle,
 * recenter, "Stäng allt" (panic button), restart of the display stream, screen calibration. 1.25 x 0.15 m.
 */
@Composable
fun StatusPanel(
    state: String,
    host: String?,
    panelCount: Int,
    cameraNote: String?,
    hud: com.claudexr.quest.Hud?,
    micHeld: Boolean,
    voiceOpen: Boolean,
    onRecenter: () -> Unit,
    onCloseAll: () -> Unit,
    onRestartDisplay: () -> Unit,
    onCalibrate: () -> Unit,
    onAdjust: () -> Unit,
    onUnpair: () -> Unit,
    onVoice: () -> Unit,
) {
  Row(
      Modifier.fillMaxSize().clip(RoundedCornerShape(24.dp)).background(Bg).padding(horizontal = 20.dp, vertical = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
  ) {
    val dot = when (state) {
      "CONNECTED" -> Color(0xFF4CC38A)
      "CERT_MISMATCH" -> Color(0xFFE05050)
      else -> Color(0xFFE0B341)
    }
    Box(Modifier.size(18.dp).clip(RoundedCornerShape(50)).background(dot))
    Spacer(Modifier.width(14.dp))
    Column(Modifier.weight(1f)) {
      Text(
          when (state) {
            "CONNECTED" -> "Claude · ${host ?: "Mac"} · krypterad"
            "CONNECTING" -> "Ansluter till Macen…"
            "PAIRING" -> "Parkoppling: skriv koden"
            "CERT_MISMATCH" -> "Fel certifikat: koppla från och parkoppla igen"
            else -> "Söker efter Macen…"
          },
          color = Fg,
          fontSize = BodySize,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
      )
      Text(cameraNote ?: hudLine(hud, micHeld, panelCount), color = Muted, fontSize = SmallSize, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    // The microphone icon only opens/closes the big voice panel close to the head (hold-to-talk happens there).
    TextButton(onClick = onVoice) { Text(if (micHeld) "🔴" else "🎤", color = if (voiceOpen) Accent else Fg, fontSize = BodySize) }
    TextButton(onClick = onRecenter) { Text("Centrera", color = Accent, fontSize = SmallSize) }
    if (hud != null && hud.displayState != "live" && state == "CONNECTED") {
      TextButton(onClick = onRestartDisplay) { Text("Starta skärmen", color = Accent, fontSize = SmallSize) }
    }
    TextButton(onClick = onCloseAll) { Text("Stäng allt", color = Color(0xFFF08A8A), fontSize = SmallSize, fontWeight = FontWeight.SemiBold) }
    TextButton(onClick = onCalibrate) { Text("Kalibrera skärm", color = Muted, fontSize = SmallSize) }
    TextButton(onClick = onAdjust) { Text("Justera", color = Muted, fontSize = SmallSize) }
    if (state == "CERT_MISMATCH") TextButton(onClick = onUnpair) { Text("Koppla från", color = Color(0xFFF08A8A), fontSize = SmallSize) }
  }
}

/** One line: "Skärm ● live · Notion ● · Mikrofon: av · Dimmad". The bridge sends the text; this is the fallback. */
internal fun hudLine(hud: com.claudexr.quest.Hud?, micHeld: Boolean, panelCount: Int): String {
  if (hud == null) return "$panelCount panel(er)"
  val base =
      hud.text.ifBlank {
        val parts = hud.streams.map { "${it.title} ${if (it.state == "live") "●" else if (it.state == "paused") "⏸" else "…"}" }
        (listOf(if (parts.isEmpty()) "Ingen ström" else "Skärm/strömmar: ${parts.joinToString(", ")}") + "Mikrofon: ${if (hud.micListening) "lyssnar" else "av"}" + (if (hud.dimmed) "Dimmad" else ""))
            .joinToString(" · ")
      }
  return if (micHeld && !base.contains("lyssnar")) "$base · Mikrofon: lyssnar" else base
}

/** Numeric keypad for the 8-digit pairing code shown on the Mac, plus the certificate ID to compare. */
@Composable
fun PairingPanel(message: String?, certId: String?, onSubmit: (String) -> Unit, onNewCode: () -> Unit) {
  val code = remember { mutableStateOf("") }
  Column(
      Modifier.fillMaxSize().clip(RoundedCornerShape(24.dp)).background(Bg).padding(24.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text("Parkoppla med Macen", color = Fg, fontSize = TitleSize, fontWeight = FontWeight.SemiBold)
    Text(message ?: "Skriv koden som visas på Macen", color = Muted, fontSize = SmallSize)
    // Review 2 #16: compare with the ID in the Mac's dialog; different = someone in the middle -> deny on the Mac.
    certId?.let { Text("Macen ska visa ID $it", color = Accent, fontSize = SmallSize, fontWeight = FontWeight.SemiBold) }
    Spacer(Modifier.height(12.dp))
    Text(code.value.padEnd(8, '•').chunked(4).joinToString(" "), color = Fg, fontSize = 52.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(12.dp))
    val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK")
    keys.chunked(3).forEach { row ->
      Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(vertical = 5.dp)) {
        row.forEach { k ->
          Button(
              onClick = {
                when (k) {
                  "⌫" -> code.value = code.value.dropLast(1)
                  "OK" -> if (code.value.length == 8) onSubmit(code.value).also { code.value = "" }
                  else -> if (code.value.length < 8) code.value += k
                }
              },
              modifier = Modifier.width(130.dp).height(78.dp),
              shape = RoundedCornerShape(16.dp),
              colors = ButtonDefaults.buttonColors(containerColor = if (k == "OK") Accent else Color(0xFF2C2E35)),
          ) {
            Text(k, fontSize = 30.sp, color = Fg)
          }
        }
      }
    }
    TextButton(onClick = onNewCode) { Text("Ny kod", color = Muted, fontSize = SmallSize) }
  }
}

/** What Claude is doing right now (fed by hooks via the bridge). 0.5 x 0.5 m. */
@Composable
fun ActivityPanel(info: ActivityInfo, onClose: () -> Unit = {}) {
  Column(Modifier.fillMaxSize().clip(RoundedCornerShape(24.dp)).background(Bg).padding(20.dp)) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Spacer(Modifier.weight(1f))
      // 0.3.0: the activity panel used to sit idle ("Vilar") to the left with no way to close it.
      TextButton(onClick = onClose) { Text("✕", color = Muted, fontSize = BodySize) }
    }
    val (label, color) =
        when (info.state) {
          "working" -> "Claude arbetar" to Accent
          "waiting" -> "Väntar på dig" to Color(0xFFE0B341)
          "done" -> "Klar" to Color(0xFF4CC38A)
          else -> "Vilar" to Muted
        }
    Text(label, color = color, fontSize = BodySize, fontWeight = FontWeight.SemiBold)
    Spacer(Modifier.height(8.dp))
    info.todos.take(6).forEach { (text, status) ->
      val mark = when (status) {
        "completed" -> "✔"
        "in_progress" -> "▶"
        else -> "○"
      }
      Text("$mark $text", color = if (status == "completed") Muted else Fg, fontSize = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    if (info.todos.isNotEmpty()) Spacer(Modifier.height(8.dp))
    info.steps.takeLast(5).forEach { Text(it, color = Muted, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
  }
}

/** Short notification ("Claude är klar", "Väntar på dig"). 0.6 x 0.1 m. */
@Composable
fun ToastPanel(text: String, level: String) {
  val bg = when (level) {
    "done" -> Color(0xF22E6B48)
    "attention" -> Color(0xF2A5741B)
    else -> Bg
  }
  Box(Modifier.fillMaxSize().clip(RoundedCornerShape(30.dp)).background(bg).padding(horizontal = 24.dp), contentAlignment = Alignment.Center) {
    Text(text, color = Color.White, fontSize = BodySize, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

/** Fine-tuning of the Mac-screen overlay after calibration. 0.62 x 0.42 m. */
@Composable
fun OverlayAdjustPanel(onNudge: (String) -> Unit, onSave: () -> Unit, onRecalibrate: () -> Unit, onClose: () -> Unit, note: String?) {
  Column(Modifier.fillMaxSize().clip(RoundedCornerShape(24.dp)).background(Bg).padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
    Text("Justera skärmöverlägget", color = Fg, fontSize = BodySize, fontWeight = FontWeight.SemiBold)
    note?.let { Text(it, color = Muted, fontSize = 15.sp) }
    Spacer(Modifier.height(6.dp))
    val rows =
        listOf(
            listOf("←" to "left", "↑" to "up", "↓" to "down", "→" to "right"),
            listOf("Närmare" to "closer", "Längre" to "farther", "↺" to "rollL", "↻" to "rollR"),
            listOf("Större" to "bigger", "Mindre" to "smaller", "Bredare" to "wider", "Smalare" to "narrower"),
        )
    rows.forEach { r ->
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 3.dp)) {
        r.forEach { (label, key) ->
          Button(onClick = { onNudge(key) }, modifier = Modifier.width(130.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2C2E35))) {
            Text(label, fontSize = 18.sp, color = Fg)
          }
        }
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
      Button(onClick = onSave, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3A8F5C))) { Text("Spara", fontSize = 18.sp) }
      Button(onClick = onRecalibrate, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2C2E35))) { Text("Kalibrera om", fontSize = 18.sp) }
      Button(onClick = onClose, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2C2E35))) { Text("Stäng", fontSize = 18.sp) }
    }
  }
}
