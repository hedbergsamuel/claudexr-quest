package com.claudexr.quest

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Pairing state stored in the app's private SharedPreferences: the bridge token and the pinned
 * SHA-256 fingerprint of the bridge's TLS certificate. See bridge/src/pairing.ts for the protocol.
 */
class PairingStore(context: Context) {
  private val prefs = context.getSharedPreferences("claudexr_pairing", Context.MODE_PRIVATE)

  val token: String?
    get() = prefs.getString("token", null)

  val fingerprint: String?
    get() = prefs.getString("fingerprint", null)

  val isPaired: Boolean
    get() = token != null && fingerprint != null

  fun save(token: String, fingerprint: String, deviceId: String) {
    prefs.edit().putString("token", token).putString("fingerprint", fingerprint).putString("deviceId", deviceId).apply()
  }

  /** Last bridge URL that answered with the pinned certificate (tried first on reconnect, review patch 08). */
  var lastUrl: String?
    get() = prefs.getString("lastUrl", null)
    set(v) = prefs.edit().putString("lastUrl", v).apply()

  fun clear() {
    prefs.edit().clear().apply()
  }

  companion object {
    fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

    const val KDF_ITERATIONS = 200_000

    /**
     * Proof of the 8-digit code, bound to the TLS certificate fingerprint (see bridge/src/pairing.ts):
     * PBKDF2-HMAC-SHA256(password = code, salt = "claudexr-pair-v2|fp|nonce", 200 000 iterations, 32 bytes).
     * Slow on purpose (~0.3-1 s); call it off the main thread.
     */
    fun proofHex(code: String, fingerprint: String, nonce: String): String {
      val spec = PBEKeySpec(code.toCharArray(), "claudexr-pair-v2|$fingerprint|$nonce".toByteArray(Charsets.UTF_8), KDF_ITERATIONS, 256)
      return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded.toHex()
    }

    /** Same format as the bridge's shortFingerprint(): first 8 hex, "ABCD-1234". */
    fun shortId(fp: String): String = fp.take(8).uppercase().let { "${it.take(4)}-${it.drop(4)}" }

    fun newNonce(): String = ByteArray(16).also { SecureRandom().nextBytes(it) }.toHex()

    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }
  }
}
