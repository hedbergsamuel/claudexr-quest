package com.claudexr.quest.ui

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import com.claudexr.quest.AskSpec
import com.claudexr.quest.CompareSpec
import com.claudexr.quest.HeardSpec
import com.claudexr.quest.HtmlSpec
import com.claudexr.quest.ListenSpec
import com.claudexr.quest.PermissionSpec
import com.claudexr.quest.StreamSpec
import com.claudexr.quest.PreviewSpec
import com.claudexr.quest.TestSpec
import com.claudexr.quest.TextSpec

// Plain, calm panels. Pointing + pinching (hands) or trigger (controllers) clicks the buttons;
// this input comes from VRFeature's default panel ray interaction.

internal val Bg = Color(0xF21B1C20)
internal val Fg = Color(0xFFF2F2F2)
internal val Muted = Color(0xFFA8ABB3)
internal val Accent = Color(0xFFD97757)

// Sizes assume 1000 dp per metre (1 dp = 1 mm on the panel), read at ~1.2 m.
internal val TitleSize = 30.sp
internal val BodySize = 24.sp
internal val SmallSize = 20.sp

/**
 * Common frame: header (title, recenter, close) + content that fills the rest of the panel.
 * The content slot gets the remaining height, so callers decide what scrolls and what is pinned.
 */
@Composable
private fun PanelFrame(
    title: String?,
    onClose: (() -> Unit)?,
    onRecenter: (() -> Unit)?,
    content: @Composable ColumnScope.() -> Unit,
) {
  Column(
      Modifier.fillMaxSize().clip(RoundedCornerShape(24.dp)).background(Bg).padding(20.dp),
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(
          title ?: "",
          color = Fg,
          fontSize = TitleSize,
          lineHeight = 36.sp,
          fontWeight = FontWeight.SemiBold,
          modifier = Modifier.weight(1f),
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
      )
      if (onRecenter != null) {
        TextButton(onClick = onRecenter) { Text("⟲", color = Muted, fontSize = TitleSize) }
      }
      if (onClose != null) TextButton(onClick = onClose) { Text("✕", color = Muted, fontSize = TitleSize) }
    }
    Spacer(Modifier.height(12.dp))
    Column(Modifier.weight(1f).fillMaxWidth()) { content() }
  }
}

@Composable
fun AskCard(spec: AskSpec, onChoose: (Int) -> Unit, onDismiss: () -> Unit, onRecenter: () -> Unit, onTalk: ((Boolean) -> Unit)? = null) {
  PanelFrame(spec.question, onDismiss, onRecenter) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      spec.context?.let { Text(it, color = Muted, fontSize = SmallSize) }
      spec.options.forEachIndexed { i, opt ->
        Button(
            onClick = { onChoose(i) },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2C2E35)),
        ) {
          Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
            Text("${i + 1}. ${opt.label}", color = Fg, fontSize = BodySize, fontWeight = FontWeight.Medium)
            opt.description?.let { Text(it, color = Muted, fontSize = SmallSize) }
          }
        }
      }
      onTalk?.let { TalkButton(onTalk = it, modifier = Modifier.fillMaxWidth()) }
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebPane(url: String, modifier: Modifier = Modifier) {
  AndroidView(
      modifier = modifier.clip(RoundedCornerShape(16.dp)),
      factory = { ctx ->
        WebView(ctx).apply {
          settings.javaScriptEnabled = true
          settings.domStorageEnabled = true
          // Review patch 06: no file/content access, only http(s) pages, navigation stays in the panel.
          settings.allowFileAccess = false
          settings.allowContentAccess = false
          webViewClient =
              object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = !isWebUrl(request.url.toString())
              }
          if (isWebUrl(url)) loadUrl(url)
        }
      },
      // Review patch 06: destroy the WebView when the panel goes away (renderer, timers, audio, GPU surface).
      onRelease = { it.stopLoading(); it.destroy() },
  )
}

internal fun isWebUrl(u: String) = u.startsWith("http://", ignoreCase = true) || u.startsWith("https://", ignoreCase = true)

/** HTML from the bridge runs with no network, no navigation and no JS bridge (review d9). */
private const val HTML_CSP =
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'\">"

@Composable
fun PreviewPanel(spec: PreviewSpec, onDismiss: () -> Unit, onRecenter: () -> Unit) {
  PanelFrame(spec.title ?: spec.url, onDismiss, onRecenter) {
    when (spec.device) {
      // Device frames: a simple bezel so the page renders at a realistic width.
      "phone", "tablet", "laptop" ->
          Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            val radius = if (spec.device == "phone") 36.dp else 18.dp
            Box(
                Modifier.fillMaxSize().clip(RoundedCornerShape(radius)).background(Color(0xFF0B0B0D)).padding(if (spec.device == "laptop") 10.dp else 14.dp),
            ) {
              WebPane(spec.url, Modifier.fillMaxSize())
            }
          }
      else -> WebPane(spec.url, Modifier.fillMaxSize())
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun HtmlPanel(spec: HtmlSpec, onDismiss: () -> Unit, onRecenter: () -> Unit, onContentHeight: (Int) -> Unit = {}) {
  // Rendered by the bridge (xr_present templates / xr_show html). The title is part of the HTML.
  Column(Modifier.fillMaxSize().clip(RoundedCornerShape(24.dp)).background(Bg)) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.End) {
      TextButton(onClick = onRecenter) { Text("⟲", color = Muted, fontSize = SmallSize) }
      TextButton(onClick = onDismiss) { Text("✕", color = Muted, fontSize = SmallSize) }
    }
    AndroidView(
        modifier = Modifier.weight(1f).fillMaxWidth(),
        factory = { ctx ->
          WebView(ctx).apply {
            settings.javaScriptEnabled = true // slides navigation only; CSP blocks all network access
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            webViewClient =
                object : WebViewClient() {
                  override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true // no navigation

                  // 0.4.0 (BUG-0863a3): report how tall the content really is (CSS px = dp here), so the panel can
                  // grow to fit instead of making the user scroll a dashboard.
                  override fun onPageFinished(view: WebView, url: String?) {
                    view.evaluateJavascript("Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)") { v ->
                      v?.trim('"')?.toFloatOrNull()?.let { onContentHeight(it.toInt()) }
                    }
                  }
                }
          }
        },
        update = { it.loadDataWithBaseURL(null, HTML_CSP + spec.html, "text/html", "utf-8", null) },
        onRelease = { it.stopLoading(); it.destroy() },
    )
  }
}

@Composable
fun PermissionCard(spec: PermissionSpec, onDecision: (Boolean) -> Unit, onDismiss: () -> Unit) {
  // Review 2 R2-05: "Godkänn" is armed only after the card has been visible for 1 s (a pinch meant for
  // whatever was at this spot a moment ago must not approve) and after everything has been scrolled
  // into view (the card shows the exact request; that only helps if it was all on screen once).
  val scroll = rememberScrollState()
  var armed by remember(spec) { mutableStateOf(false) }
  var seenAll by remember(spec) { mutableStateOf(false) }
  LaunchedEffect(spec) {
    kotlinx.coroutines.delay(ARM_DELAY_MS)
    armed = true
  }
  if (!seenAll && scroll.maxValue != Int.MAX_VALUE && scroll.value >= scroll.maxValue - 4) seenAll = true
  PanelFrame(spec.title, onDismiss, null) {
    Text(spec.tool, color = Muted, fontSize = SmallSize)
    spec.warnings.forEach { w -> Text("⚠ $w", color = Color(0xFFFF6B5E), fontSize = 20.sp, fontWeight = FontWeight.SemiBold) }
    Spacer(Modifier.height(6.dp))
    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll)) {
      Text(spec.subject, color = Fg, fontSize = 22.sp, fontFamily = FontFamily.Monospace)
      spec.detail?.let {
        Spacer(Modifier.height(8.dp))
        Text(it, color = Muted, fontSize = SmallSize)
      }
      spec.diff?.let { d ->
        Spacer(Modifier.height(10.dp))
        d.lines().forEach { line ->
          val c = when {
            line.startsWith("+") -> Color(0xFF7FD69B)
            line.startsWith("-") -> Color(0xFFF08A8A)
            line.startsWith("@@") -> Color(0xFF8AB4F8)
            else -> Fg
          }
          Text(line, color = c, fontSize = 17.sp, fontFamily = FontFamily.Monospace)
        }
      }
      // Everything above is EXACTLY what will run; nothing is masked or shortened.
    }
    Spacer(Modifier.height(10.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
      Button(
          onClick = { if (armed && seenAll) onDecision(true) },
          enabled = armed && seenAll,
          modifier = Modifier.weight(1f),
          colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3A8F5C)),
      ) {
        Text(if (!seenAll) "Läs allt ↓" else "Godkänn", fontSize = BodySize)
      }
      Button(onClick = { onDecision(false) }, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB54848))) {
        Text("Neka", fontSize = BodySize)
      }
    }
    Text("✕ = svara i terminalen i stället", color = Muted, fontSize = 15.sp)
  }
}

private const val ARM_DELAY_MS = 1_000L

@Composable
fun StreamBadge(spec: StreamSpec, state: String, onStop: () -> Unit) {
  val live = state == "live"
  Row(
      Modifier.fillMaxSize().clip(RoundedCornerShape(20.dp)).background(if (live) Color(0xF2B3261E) else Color(0xF2444444)).padding(horizontal = 14.dp),
      verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(
        when (state) {
          "live" -> "● STRÖMMAR"
          "paused" -> "⏸ PAUSAD (Macen låst)"
          "starting" -> "… startar"
          else -> state
        },
        color = Color.White,
        fontSize = 20.sp,
        fontWeight = FontWeight.Bold,
    )
    Spacer(Modifier.width(10.dp))
    Text(spec.title, color = Color.White, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
    TextButton(onClick = onStop) { Text("Stoppa", color = Color.White, fontSize = 18.sp) }
  }
}

@Composable
fun ComparePanel(spec: CompareSpec, onChoose: (String) -> Unit, onDismiss: () -> Unit, onRecenter: () -> Unit, onTalk: ((Boolean) -> Unit)? = null) {
  PanelFrame(spec.question ?: spec.title ?: "Compare", onDismiss, onRecenter) {
    Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
      listOf("a" to (spec.aLabel to spec.aUrl), "b" to (spec.bLabel to spec.bUrl)).forEach { (key, v) ->
        Column(Modifier.weight(1f)) {
          Text("${key.uppercase()}: ${v.first}", color = Fg, fontSize = 22.sp)
          Spacer(Modifier.height(8.dp))
          WebPane(v.second, Modifier.weight(1f).fillMaxWidth())
          if (spec.wantChoice) {
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = { onChoose(key) },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) {
              Text("Choose ${key.uppercase()}", fontSize = 22.sp)
            }
          }
        }
      }
    }
    if (spec.wantChoice) {
      Spacer(Modifier.height(10.dp))
      Row(Modifier.align(Alignment.CenterHorizontally), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        OutlinedButton(onClick = { onChoose("neither") }) { Text("Neither", color = Fg, fontSize = 20.sp) }
        onTalk?.let { TalkButton(onTalk = it) }
      }
    }
  }
}

@Composable
fun TestCard(spec: TestSpec, onVerdict: (Boolean, List<Boolean>) -> Unit, onDismiss: () -> Unit, onRecenter: () -> Unit, onTalk: ((Boolean) -> Unit)? = null) {
  val checked = remember { mutableStateListOf(*Array(spec.checklist.size) { false }) }
  PanelFrame(spec.title, onDismiss, onRecenter) {
    if (spec.url != null) {
      WebPane(spec.url, Modifier.weight(1f).fillMaxWidth())
      Spacer(Modifier.height(10.dp))
    }
    // Instructions + checklist scroll; the verdict buttons below are always visible.
    Column(
        Modifier.then(if (spec.url != null) Modifier.height(220.dp) else Modifier.weight(1f))
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
    ) {
      Text(spec.instructions, color = Muted, fontSize = SmallSize)
      Spacer(Modifier.height(8.dp))
      spec.checklist.forEachIndexed { i, item ->
        Row(verticalAlignment = Alignment.CenterVertically) {
          Checkbox(checked = checked[i], onCheckedChange = { checked[i] = it })
          Text(item, color = Fg, fontSize = BodySize)
        }
      }
    }
    Spacer(Modifier.height(10.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
      Button(
          onClick = { onVerdict(true, checked.toList()) },
          modifier = Modifier.weight(1f),
          colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3A8F5C)),
      ) {
        Text("Works", fontSize = BodySize)
      }
      Button(
          onClick = { onVerdict(false, checked.toList()) },
          modifier = Modifier.weight(1f),
          colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB54848)),
      ) {
        Text("Broken", fontSize = BodySize)
      }
    }
    onTalk?.let {
      Spacer(Modifier.height(8.dp))
      TalkButton(label = "🎤 Håll och säg \"funkar\" eller beskriv felet", onTalk = it, modifier = Modifier.fillMaxWidth())
    }
  }
}

@Composable
fun TextPanel(spec: TextSpec, onDismiss: () -> Unit, onRecenter: () -> Unit) {
  PanelFrame(spec.title, onDismiss, onRecenter) {
    val mono = spec.format != "markdown" && spec.format != "text"
    // Review patch 07: lazy list, so a 100 kB log doesn't compose thousands of Texts at once.
    val lines = remember(spec.content) { spec.content.lines() }
    LazyColumn(Modifier.fillMaxSize()) {
      items(lines.size) { i ->
        val line = lines[i]
        val color =
            when {
              spec.format != "diff" -> Fg
              line.startsWith("+") && !line.startsWith("+++") -> Color(0xFF7FD69B)
              line.startsWith("-") && !line.startsWith("---") -> Color(0xFFF08A8A)
              line.startsWith("@@") -> Color(0xFF8AB4F8)
              else -> Fg
            }
        Text(line, color = color, fontSize = if (mono) 18.sp else SmallSize, fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default)
      }
    }
  }
}


/**
 * Talk button on a card: hold and release, or tap to start and tap again to send (holdOrTapToTalk).
 * 0.4.0: if the card disappears while the microphone is on (answered, timed out, closed), the release is reported.
 * 0.3.x did not, which left the microphone session open and made every later press do nothing (BUG-36fba1).
 */
@Composable
fun TalkButton(label: String = "🎤 Håll och säg svaret", onTalk: (Boolean) -> Unit, modifier: Modifier = Modifier) {
  val pressed = remember { androidx.compose.runtime.mutableStateOf(false) }
  val latched = remember { androidx.compose.runtime.mutableStateOf(false) }
  androidx.compose.runtime.LaunchedEffect(MicState.active.value) { if (!MicState.active.value) latched.value = false }
  androidx.compose.runtime.DisposableEffect(Unit) {
    onDispose {
      if (pressed.value || latched.value) {
        pressed.value = false
        latched.value = false
        onTalk(false)
      }
    }
  }
  val on = pressed.value || latched.value
  Box(
      modifier
          .clip(RoundedCornerShape(16.dp))
          .background(if (on) Color(0xFFB3261E) else Color(0xFF2C2E35))
          .pointerInput(Unit) { holdOrTapToTalk(pressed, latched, onTalk) }
          .padding(horizontal = 18.dp, vertical = 12.dp),
      contentAlignment = Alignment.Center,
  ) {
    Text(
        when {
          latched.value -> "● Mikrofonen är på, tryck för att skicka"
          pressed.value -> "● Mikrofonen är på, släpp för att skicka"
          else -> label
        },
        color = Fg,
        fontSize = SmallSize,
    )
  }
}

@Composable
fun ListenPanel(spec: ListenSpec, onTalk: (Boolean) -> Unit, onDismiss: () -> Unit) {
  PanelFrame(spec.prompt, onDismiss, null) {
    Text("Claude väntar på ett muntligt svar. Håll in knappen medan du talar, eller tryck en gång för att starta och en gång till för att skicka. Texten visas innan den skickas.", color = Muted, fontSize = SmallSize)
    Spacer(Modifier.weight(1f))
    TalkButton(label = "🎤 Håll in och tala", onTalk = onTalk, modifier = Modifier.fillMaxWidth().height(110.dp))
  }
}

/** "Jag hörde: …" with Skicka / Avbryt (and an auto-send countdown when configured). */
@Composable
fun HeardPanel(spec: HeardSpec, onSend: (Boolean) -> Unit) {
  val left = remember { androidx.compose.runtime.mutableIntStateOf(spec.autoSendMs / 1000) }
  if (spec.autoSendMs > 0) {
    androidx.compose.runtime.LaunchedEffect(spec) {
      while (left.intValue > 0) {
        kotlinx.coroutines.delay(1000)
        left.intValue--
      }
    }
  }
  PanelFrame("Jag hörde", null, null) {
    Text("\u201C${spec.text}\u201D", color = Fg, fontSize = BodySize)
    Spacer(Modifier.height(6.dp))
    Text("Svar till: ${spec.target}", color = Muted, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    Spacer(Modifier.weight(1f))
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
      Button(onClick = { onSend(true) }, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Accent)) {
        Text(if (spec.autoSendMs > 0) "Skicka (${left.intValue})" else "Skicka", fontSize = BodySize)
      }
      Button(onClick = { onSend(false) }, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2C2E35))) {
        Text("Avbryt", fontSize = BodySize)
      }
    }
  }
}
