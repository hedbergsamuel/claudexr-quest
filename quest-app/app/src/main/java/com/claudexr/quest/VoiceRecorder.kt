package com.claudexr.quest

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Push-to-talk recorder: 16 kHz mono 16-bit PCM in 100 ms chunks, only while the button is held.
 * Nothing is written to storage; chunks go straight to [onChunk] (the encrypted media socket).
 */
class VoiceRecorder {
  private val _recording = MutableStateFlow(false)
  val recording: StateFlow<Boolean> = _recording
  @Volatile private var active = false
  private var thread: Thread? = null

  @SuppressLint("MissingPermission") // RECORD_AUDIO is checked by MainActivity before start()
  fun start(onChunk: (ByteArray) -> Unit): Boolean {
    if (active) return false
    val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val rec =
        try {
          AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, CHUNK * 4))
        } catch (e: Exception) {
          Log.w(TAG, "AudioRecord failed", e)
          return false
        }
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      return false
    }
    active = true
    _recording.value = true
    thread =
        Thread({
              rec.startRecording()
              val buf = ByteArray(CHUNK)
              var total = 0
              while (active && total < MAX_BYTES) {
                val n = rec.read(buf, 0, buf.size)
                if (n > 0) {
                  onChunk(buf.copyOf(n))
                  total += n
                }
              }
              rec.stop()
              rec.release()
              _recording.value = false
            }, "claudexr-mic")
            .apply { start() }
    return true
  }

  /** Stop and wait until the last chunk was handed over. */
  fun stop() {
    active = false
    thread?.join(500)
    thread = null
    _recording.value = false
  }

  companion object {
    private const val TAG = "ClaudeXR.Voice"
    const val RATE = 16_000
    private const val CHUNK = RATE * 2 / 10 // 100 ms
    private const val MAX_BYTES = RATE * 2 * 30 // 30 s cap (bridge enforces the same)
  }
}
