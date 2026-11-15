package com.claudexr.quest

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * 0.4.1 (punkt 7): plays the Mac's system audio (PCM s16le 48 kHz stereo blocks from the bridge) with a low-latency
 * AudioTrack. Untested in the headset.
 *
 * Latency rules: a small jitter queue ([MAX_QUEUED] blocks, ~10 ms each from the helper's real block size, which is
 * decided by ScreenCaptureKit and unverified); when it is full the OLDEST block is dropped, so delay never grows.
 * The track is created on the first block and released after [IDLE_RELEASE_MS] of silence (audio stopped).
 * [push] is called on the OkHttp thread and never blocks; all AudioTrack calls happen on the player thread.
 */
class MacAudioPlayer {
  companion object {
    private const val TAG = "MacAudio"
    const val SAMPLE_RATE = 48_000
    const val MAX_QUEUED = 8
    const val IDLE_RELEASE_MS = 1_500L
  }

  private val queue = ArrayBlockingQueue<AudioBlock>(MAX_QUEUED)
  @Volatile private var thread: Thread? = null
  @Volatile private var released = false
  @Volatile var dropped = 0L
    private set

  fun push(b: AudioBlock) {
    if (released) return
    while (!queue.offer(b)) {
      queue.poll()
      dropped++
    }
    ensureThread()
  }

  /** Drop everything queued (app paused). */
  fun flush() = queue.clear()

  fun release() {
    released = true
    queue.clear()
    thread?.interrupt()
  }

  @Synchronized
  private fun ensureThread() {
    if (thread?.isAlive == true || released) return
    thread = Thread({ run() }, "mac-audio").apply { isDaemon = true; start() }
  }

  private fun newTrack(): AudioTrack {
    val min = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
    return AudioTrack.Builder()
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
        .setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
        .setTransferMode(AudioTrack.MODE_STREAM)
        .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
        .setBufferSizeInBytes(maxOf(min, SAMPLE_RATE * 4 * 40 / 1000)) // >= 40 ms
        .build()
  }

  private fun run() {
    var track: AudioTrack? = null
    try {
      while (!released) {
        val b = queue.poll(IDLE_RELEASE_MS, TimeUnit.MILLISECONDS)
        if (b == null) {
          // silence: the Mac audio was stopped (or the link is gone). Free the output until the next block.
          track?.let { runCatching { it.pause(); it.flush(); it.release() } }
          track = null
          if (queue.isEmpty()) return
          continue
        }
        if (track == null) {
          track = newTrack()
          track.play()
          Log.i(TAG, "playing Mac audio (buffer ${track.bufferSizeInFrames} frames)")
        }
        track.write(b.pcm, 0, b.pcm.size, AudioTrack.WRITE_BLOCKING)
      }
    } catch (_: InterruptedException) {
      // released
    } catch (e: Exception) {
      Log.w(TAG, "audio playback failed: ${e.message}")
    } finally {
      track?.let { runCatching { it.release() } }
      synchronized(this) { if (thread === Thread.currentThread()) thread = null }
    }
  }
}
