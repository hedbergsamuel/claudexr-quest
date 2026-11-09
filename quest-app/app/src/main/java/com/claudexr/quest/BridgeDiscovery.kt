package com.claudexr.quest

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import java.net.Inet4Address
import java.net.Inet6Address
import java.util.concurrent.Executors

/**
 * Finds the bridge on the Mac via Bonjour/mDNS (service type _claudexr._tcp) using Android NSD.
 * Calls [onFound] with a ready-to-use WebSocket URL, e.g. ws://192.168.1.20:47800/headset.
 */
class BridgeDiscovery(context: Context, private val onFound: (url: String, name: String) -> Unit) {
  private val nsd = context.getSystemService(NsdManager::class.java)
  private val executor = Executors.newSingleThreadExecutor()
  private var listener: NsdManager.DiscoveryListener? = null

  fun start() {
    if (listener != null) return
    val l =
        object : NsdManager.DiscoveryListener {
          override fun onDiscoveryStarted(serviceType: String) {
            Log.i(TAG, "discovery started")
          }

          override fun onServiceFound(info: NsdServiceInfo) {
            Log.i(TAG, "found ${info.serviceName}")
            resolve(info)
          }

          override fun onServiceLost(info: NsdServiceInfo) {
            Log.i(TAG, "lost ${info.serviceName}")
          }

          override fun onDiscoveryStopped(serviceType: String) {
            Log.i(TAG, "discovery stopped")
          }

          override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
            Log.w(TAG, "start discovery failed: $errorCode")
            listener = null
          }

          override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
            Log.w(TAG, "stop discovery failed: $errorCode")
          }
        }
    listener = l
    nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, l)
  }

  fun stop() {
    listener?.let { runCatching { nsd.stopServiceDiscovery(it) } }
    listener = null
  }

  private fun resolve(info: NsdServiceInfo) {
    // API 34+: registerServiceInfoCallback replaces the deprecated resolveService.
    val cb =
        object : NsdManager.ServiceInfoCallback {
          override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
            Log.w(TAG, "resolve failed: $errorCode")
          }

          override fun onServiceUpdated(si: NsdServiceInfo) {
            val addr =
                si.hostAddresses.firstOrNull { it is Inet4Address } ?: si.hostAddresses.firstOrNull()
            if (addr == null) return
            val host = if (addr is Inet6Address) "[${addr.hostAddress}]" else addr.hostAddress
            val path = si.attributes["path"]?.toString(Charsets.UTF_8) ?: DEFAULT_WS_PATH
            // v0.2 bridges announce tls=1; plain ws is only used for an explicitly configured URL.
            val scheme = if (si.attributes["tls"]?.toString(Charsets.UTF_8) == "1") "wss" else "ws"
            runCatching { nsd.unregisterServiceInfoCallback(this) }
            onFound("$scheme://$host:${si.port}$path", si.serviceName)
          }

          override fun onServiceLost() = Unit

          override fun onServiceInfoCallbackUnregistered() = Unit
        }
    nsd.registerServiceInfoCallback(info, executor, cb)
  }

  companion object {
    private const val TAG = "ClaudeXR.Discovery"
  }
}
