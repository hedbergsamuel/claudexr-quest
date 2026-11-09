package com.claudexr.quest

import android.media.MediaCodec
import android.media.MediaFormat
import android.util.Log
import android.view.Surface
import java.nio.ByteBuffer
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Low-latency H.264 decoder for one stream (Annex-B access units from the Mac helper) rendering
 * straight into the Surface of a Spatial SDK video panel. Runs on its own thread.
 *
 * Review 2 R2-04: a frame is acked ([onHandedToDecoder]) only once it is inside MediaCodec, so the
 * bridge's credit-based flow control also covers a slow decoder (thermal throttling). The local queue
 * holds at most 3 frames; on overflow or a decoder error the stream restarts from a fresh IDR at once
 * ([onNeedKeyframe]) instead of waiting for the encoder's 10 s GOP.
 */
class VideoDecoder(
    private val surface: Surface,
    private val width: Int,
    private val height: Int,
    private val onHandedToDecoder: (VideoFrame) -> Unit = {},
    private val onNeedKeyframe: () -> Unit = {},
) {
  private val queue = LinkedBlockingQueue<VideoFrame>(3)
  @Volatile private var running = true
  @Volatile private var needKey = true
  private var codec: MediaCodec? = null
  private val thread = Thread(::loop, "claudexr-decoder").apply { start() }

  fun submit(f: VideoFrame) {
    if (needKey && !f.keyframe) {
      onHandedToDecoder(f) // nothing will use it: free the credit so the bridge can send the IDR
      return
    }
    if (!queue.offer(f)) {
      // Decoder can't keep up: drop the backlog (latency over completeness) and restart from an IDR.
      val dropped = ArrayList<VideoFrame>()
      queue.drainTo(dropped)
      dropped.forEach(onHandedToDecoder)
      if (f.keyframe) queue.offer(f)
      else {
        needKey = true
        onHandedToDecoder(f)
        onNeedKeyframe()
      }
    } else if (f.keyframe) needKey = false
  }

  fun release() {
    running = false
    thread.interrupt()
  }

  private fun loop() {
    val info = MediaCodec.BufferInfo()
    try {
      while (running) {
        val f = queue.poll(20, TimeUnit.MILLISECONDS)
        if (f != null) {
          try {
            if (codec == null) {
              if (!f.keyframe) continue // acked in finally
              codec = configure(f.data) ?: continue
            }
            val c = codec!!
            val idx = c.dequeueInputBuffer(10_000)
            if (idx >= 0) {
              val buf = c.getInputBuffer(idx)!!
              buf.clear()
              if (f.data.size <= buf.capacity()) {
                buf.put(f.data)
                c.queueInputBuffer(idx, 0, f.data.size, f.ptsUs, if (f.keyframe) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
              } else {
                c.queueInputBuffer(idx, 0, 0, f.ptsUs, 0)
                needKey = true
                onNeedKeyframe()
              }
            } else {
              // No input buffer in 10 ms: the decoder is behind. Skip to the next IDR.
              needKey = true
              onNeedKeyframe()
            }
          } finally {
            onHandedToDecoder(f)
          }
        }
        val c = codec ?: continue
        try {
          while (true) {
            val out = c.dequeueOutputBuffer(info, 0)
            if (out < 0) break
            c.releaseOutputBuffer(out, true) // render immediately
          }
        } catch (e: IllegalStateException) {
          // Codec error (e.g. surface replaced): rebuild at the next keyframe instead of dying silently.
          Log.w(TAG, "decoder reset", e)
          runCatching { c.stop() }
          runCatching { c.release() }
          codec = null
          needKey = true
          onNeedKeyframe()
        }
      }
    } catch (_: InterruptedException) {
    } catch (e: Exception) {
      Log.e(TAG, "decoder error", e)
    } finally {
      runCatching { codec?.stop() }
      runCatching { codec?.release() }
    }
  }

  private fun configure(keyframe: ByteArray): MediaCodec? {
    val nals = splitNals(keyframe)
    val sps = nals.firstOrNull { (it[0].toInt() and 0x1f) == 7 } ?: return null
    val pps = nals.firstOrNull { (it[0].toInt() and 0x1f) == 8 } ?: return null
    val start = byteArrayOf(0, 0, 0, 1)
    val format =
        MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width.coerceAtLeast(16), height.coerceAtLeast(16)).apply {
          setByteBuffer("csd-0", ByteBuffer.wrap(start + sps))
          setByteBuffer("csd-1", ByteBuffer.wrap(start + pps))
          setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
          setInteger(MediaFormat.KEY_PRIORITY, 0)
        }
    val codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    // KEY_LOW_LATENCY only where the decoder supports it (otherwise some decoders refuse to configure).
    val caps = codec.codecInfo.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC)
    if (!caps.isFeatureSupported(android.media.MediaCodecInfo.CodecCapabilities.FEATURE_LowLatency)) format.removeKey(MediaFormat.KEY_LOW_LATENCY)
    return codec.apply {
      configure(format, surface, null, 0)
      start()
    }
  }

  companion object {
    private const val TAG = "ClaudeXR.Decoder"

    /** Split an Annex-B buffer into NAL units (without start codes). */
    fun splitNals(b: ByteArray): List<ByteArray> {
      val starts = mutableListOf<Pair<Int, Int>>() // (start code index, payload index)
      var i = 0
      while (i + 3 <= b.size) {
        if (b[i].toInt() == 0 && b[i + 1].toInt() == 0) {
          if (b[i + 2].toInt() == 1) {
            starts += i to i + 3
            i += 3
            continue
          }
          if (i + 4 <= b.size && b[i + 2].toInt() == 0 && b[i + 3].toInt() == 1) {
            starts += i to i + 4
            i += 4
            continue
          }
        }
        i++
      }
      return starts.mapIndexedNotNull { k, (_, p) ->
        val end = if (k + 1 < starts.size) starts[k + 1].first else b.size
        if (end > p) b.copyOfRange(p, end) else null
      }
    }
  }
}
