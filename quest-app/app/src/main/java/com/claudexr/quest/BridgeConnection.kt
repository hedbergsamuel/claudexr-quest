package com.claudexr.quest

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString

/**
 * Keeps the headset connected to the bridge: discover (or fixed URL) -> WSS -> pair or hello ->
 * on loss, wait and start over. Trust model: the bridge's self-signed certificate is pinned by its
 * SHA-256 fingerprint at pairing time; a different certificate is refused. Callbacks run on the
 * main thread.
 */
class BridgeConnection(
    context: Context,
    private val fixedUrl: String?,
    private val appVersion: String,
    private val onMessage: (BridgeMessage) -> Unit,
    private val onVideo: (VideoFrame) -> Unit,
    /** control socket lost (main thread): the app drops stream panels so no stale video is left behind */
    private val onLost: () -> Unit = {},
    /** 0.4.1: Mac system audio blocks (called on the OkHttp thread: hand off, never block) */
    private val onAudio: (AudioBlock) -> Unit = {},
) {
  enum class State {
    SEARCHING,
    CONNECTING,
    /** Waiting for the user to type the code shown on the Mac. */
    PAIRING,
    CONNECTED,
    /** The bridge presented a different certificate than the one pinned at pairing. */
    CERT_MISMATCH,
  }

  private val _state = MutableStateFlow(State.SEARCHING)
  val state: StateFlow<State> = _state
  private val _host = MutableStateFlow<String?>(null)
  val host: StateFlow<String?> = _host
  /** True while the media socket (video + push-to-talk audio) is open. */
  private val _mediaUp = MutableStateFlow(false)
  val mediaUp: StateFlow<Boolean> = _mediaUp
  private var videoUrl: String? = null
  private var videoToken: String? = null
  private var videoAttempt = 0
  private val _pairMessage = MutableStateFlow<String?>(null)
  val pairMessage: StateFlow<String?> = _pairMessage

  /** Short ID of the bridge certificate on THIS connection; the Mac shows the same ID while pairing. */
  private val _certId = MutableStateFlow<String?>(null)
  val certId: StateFlow<String?> = _certId
  /** Fingerprint of the control socket's certificate (review 2 #15: not shared with other connections). */
  @Volatile private var mainFingerprint: String? = null

  val pairing = PairingStore(context)
  private val device = "${Build.MANUFACTURER} ${Build.MODEL}"
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var seenFingerprint: String? = null

  private val trustManager =
      object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit

        override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String?) {
          val fp = PairingStore.sha256Hex(chain[0].encoded)
          seenFingerprint = fp
          val pinned = pairing.fingerprint
          if (pinned != null && pinned != fp) throw CertificateException("bridge certificate changed")
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
      }

  // Review patch 08: short connect timeout and 5 s pings so a dead link is noticed in seconds.
  private val http =
      OkHttpClient.Builder()
          .connectTimeout(2, TimeUnit.SECONDS)
          .pingInterval(5, TimeUnit.SECONDS)
          .sslSocketFactory(SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), null) }.socketFactory, trustManager)
          // Self-signed cert on a LAN IP: identity comes from the pinned fingerprint, not the hostname.
          .hostnameVerifier { _, _ -> true }
          .build()
  /** Bonjour result that arrived while another attempt was in flight: tried next. */
  private var discovered: String? = null
  private val discovery =
      BridgeDiscovery(context) { url, name ->
        main.post {
          if (socket == null) connect(url, name) else discovered = url
        }
      }
  private var socket: WebSocket? = null
  private var video: WebSocket? = null
  private var running = false
  private var attempt = 0
  private var currentUrl: String? = null
  private val worker = java.util.concurrent.Executors.newSingleThreadExecutor()

  fun start() {
    running = true
    val found = discovered.also { discovered = null }
    when {
      fixedUrl != null -> connect(fixedUrl, fixedUrl)
      found != null -> connect(found, "bonjour")
      // Review patch 08: try the last good address first, run Bonjour in parallel.
      pairing.lastUrl != null -> {
        connect(pairing.lastUrl!!, "cached")
        discovery.start()
      }
      else -> search()
    }
  }

  fun stop() {
    running = false
    discovery.stop()
    main.removeCallbacksAndMessages(VIDEO_RETRY)
    val v = video
    video = null
    _mediaUp.value = false
    v?.close(1000, "app closed")
    socket?.close(1000, "app closed")
    socket = null
  }

  /** Called from onResume: reconnect immediately instead of waiting for the backoff. */
  fun nudge() {
    if (running && socket == null) {
      main.removeCallbacksAndMessages(RETRY)
      attempt = 0
      start()
    }
  }

  /** Video frames are acked on the video socket (credit-based flow control on the bridge). */
  fun ackVideo(streamId: String, seq: Long) {
    video?.send(Protocol.videoAck(streamId, seq))
  }

  fun requestIdr(streamId: String) {
    video?.send(Protocol.videoIdr(streamId))
  }

  /** Push-to-talk control + audio go on the media socket (separate from control messages). False = socket not open. */
  fun sendMedia(text: String): Boolean = if (_mediaUp.value) video?.send(text) ?: false else false

  fun sendVoiceChunk(id: String, pcm: ByteArray): Boolean {
    val idb = id.toByteArray(Charsets.US_ASCII)
    val frame = ByteArray(2 + idb.size + pcm.size)
    frame[0] = 0xA1.toByte()
    frame[1] = idb.size.toByte()
    System.arraycopy(idb, 0, frame, 2, idb.size)
    System.arraycopy(pcm, 0, frame, 2 + idb.size, pcm.size)
    return if (_mediaUp.value) video?.send(okio.ByteString.of(*frame)) ?: false else false
  }

  fun send(text: String): Boolean = socket?.send(text) ?: false

  /** User typed the 8-digit code shown on the Mac. The slow KDF runs off the main thread. */
  fun submitCode(code: String) {
    val fp = mainFingerprint ?: return
    val nonce = PairingStore.newNonce()
    _pairMessage.value = "Kontrollerar…"
    worker.execute {
      val proof = PairingStore.proofHex(code, fp, nonce)
      main.post { send(Protocol.pairConfirm(device, nonce, proof)) }
    }
  }

  /** Forget the pairing (e.g. after the Mac was reinstalled) and pair again. */
  fun unpair() {
    pairing.clear()
    socket?.close(1000, "unpair")
    socket = null
    if (running) start()
  }

  private fun search() {
    _state.value = State.SEARCHING
    discovery.start()
  }

  private fun connect(url: String, name: String) {
    if (!running || socket != null) return
    _state.value = State.CONNECTING
    Log.i(TAG, "connecting to $url ($name)")
    currentUrl = url
    socket = http.newWebSocket(Request.Builder().url(url).build(), Listener(name))
  }

  /** Exponential backoff 250 ms -> 5 s with jitter (review patch 08). */
  private fun scheduleRetry(delayMs: Long? = null) {
    socket = null
    main.removeCallbacksAndMessages(VIDEO_RETRY)
    val v = video
    video = null
    _mediaUp.value = false
    v?.close(1000, null)
    if (_state.value != State.CERT_MISMATCH) _state.value = State.SEARCHING
    _host.value = null
    onLost()
    val base = delayMs ?: minOf(5000L, 250L shl minOf(attempt, 5))
    attempt++
    val jitter = (base * 0.2 * Math.random()).toLong()
    if (running) main.postAtTime({ if (running && socket == null) start() }, RETRY, android.os.SystemClock.uptimeMillis() + base + jitter)
  }

  private fun openVideo(url: String, token: String) {
    videoUrl = url
    videoToken = token
    videoAttempt = 0
    connectVideo()
  }

  /** (Re)connects the media socket. Retries with backoff 500 ms -> 5 s as long as the control socket is up. */
  private fun connectVideo() {
    val url = videoUrl ?: return
    val token = videoToken ?: return
    if (!running || _state.value != State.CONNECTED) return
    val old = video
    video = null
    _mediaUp.value = false
    old?.close(1000, null)
    val vurl = url.replace(Regex("/headset$"), "/video")
    lateinit var ws: WebSocket
    fun lost(why: String) {
      main.post {
        if (video !== ws) return@post
        Log.w(TAG, "media socket lost: $why")
        video = null
        _mediaUp.value = false
        if (running && _state.value == State.CONNECTED) {
          val base = minOf(5000L, 500L shl minOf(videoAttempt, 4))
          videoAttempt++
          main.postAtTime({ if (running && video == null) connectVideo() }, VIDEO_RETRY, android.os.SystemClock.uptimeMillis() + base)
        }
      }
    }
    ws =
        http.newWebSocket(
            Request.Builder().url(vurl).build(),
            object : WebSocketListener() {
              override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(Protocol.videoHello(token))
                main.post {
                  if (video === ws) {
                    videoAttempt = 0
                    _mediaUp.value = true
                  }
                }
              }

              override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                // Straight to the decoder thread (never via the main thread).
                val b = bytes.toByteArray()
                if (b.isNotEmpty() && b[0] == 0xC3.toByte()) Protocol.parseAudio(b)?.let(onAudio)
                else Protocol.parseVideo(b)?.let(onVideo)
              }

              override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, null)
              }

              override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost("closed $code")

              override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = lost(t.message ?: "failure")
            },
        )
    video = ws
  }

  private fun handle(ws: WebSocket, msg: BridgeMessage, name: String) {
    when (msg) {
      is PairCodeShown -> {
        _state.value = State.PAIRING
        _pairMessage.value = "Skriv koden som visas på Macen (${msg.expiresInS} s)"
      }
      is PairOk -> {
        pairing.save(msg.token, mainFingerprint ?: "", msg.deviceId)
        _pairMessage.value = null
        ws.send(Protocol.hello(msg.token, device, appVersion))
      }
      is PairFailed -> {
        _pairMessage.value =
            when (msg.reason) {
              "wrong_code" -> "Fel kod, försök igen"
              "too_many_attempts", "no_active_code" -> "Koden gick ut. Tryck Ny kod."
              "rate_limited" -> "Vänta några sekunder och försök igen"
              else -> "Parkopplingen misslyckades (${msg.reason})"
            }
      }
      is Unauthorized -> {
        // Our token is unknown to this bridge (unpaired on the Mac): pair again.
        pairing.clear()
        ws.send(Protocol.pairRequest(device))
      }
      is Welcome -> {
        _state.value = State.CONNECTED
        _host.value = msg.host.ifBlank { name }
        attempt = 0
        discovery.stop()
        // Only an address that answered with the pinned certificate and accepted our token is cached.
        currentUrl?.let { pairing.lastUrl = it }
        pairing.token?.let { t -> currentUrl?.let { openVideo(it, t) } }
      }
      else -> Unit
    }
    onMessage(msg)
  }

  /** Ask the bridge for a fresh pairing code (shown on the Mac). */
  fun requestCode() {
    send(Protocol.pairRequest(device))
  }

  private inner class Listener(private val name: String) : WebSocketListener() {
    override fun onOpen(webSocket: WebSocket, response: Response) {
      val fp = response.handshake?.peerCertificates?.firstOrNull()?.encoded?.let(PairingStore::sha256Hex) ?: seenFingerprint
      mainFingerprint = fp
      _certId.value = fp?.let { PairingStore.shortId(it) }
      val token = pairing.token
      if (token != null && pairing.fingerprint == fp) webSocket.send(Protocol.hello(token, device, appVersion))
      else webSocket.send(Protocol.pairRequest(device))
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
      val msg = Protocol.parse(text) ?: return
      main.post { if (socket === webSocket) handle(webSocket, msg, name) }
    }


    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
      webSocket.close(code, null)
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
      Log.i(TAG, "closed: $code $reason")
      main.post { if (socket === webSocket) scheduleRetry() }
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
      Log.w(TAG, "failure: ${t.message}")
      main.post {
        if (socket !== webSocket) return@post
        if (t.message?.contains("certificate changed") == true || t.cause is CertificateException) {
          _state.value = State.CERT_MISMATCH
          scheduleRetry(10_000)
        } else scheduleRetry()
      }
    }
  }

  companion object {
    private const val TAG = "ClaudeXR.Connection"
    private val RETRY = Any()
    private val VIDEO_RETRY = Any()
  }
}
