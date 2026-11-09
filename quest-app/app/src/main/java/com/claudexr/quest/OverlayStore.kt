package com.claudexr.quest

import android.content.Context
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Quaternion
import com.meta.spatial.core.Vector3
import com.meta.spatial.mruk.MRUKFeature
import com.meta.spatial.runtime.Scene

/**
 * Remembers where the Mac screen overlay goes.
 *
 * Spatial SDK 0.15.0 has no public API for persistent user spatial anchors, so the pose is stored
 * relative to the scanned room's MRUK anchor (which the system keeps stable across sessions).
 * Without a room scan the pose is stored in world space and is only valid until a recenter/reboot.
 */
class OverlayStore(context: Context, private val mruk: MRUKFeature, private val scene: () -> Scene) {
  data class Overlay(val pose: Pose, val widthM: Float, val heightM: Float, val anchored: Boolean)

  private val prefs = context.getSharedPreferences("claudexr_overlay", Context.MODE_PRIVATE)

  fun save(o: Overlay): Boolean {
    val room = mruk.getCurrentRoom()
    val (local, roomId) =
        if (room != null) {
          val anchor = scene().getAnchorPose(room.anchor.handle)
          anchor.inverse().times(o.pose) to room.anchor.uuid.toString()
        } else o.pose to ""
    prefs
        .edit()
        .putString("room", roomId)
        .putString("pose", listOf(local.t.x, local.t.y, local.t.z, local.q.w, local.q.x, local.q.y, local.q.z).joinToString(","))
        .putFloat("w", o.widthM)
        .putFloat("h", o.heightM)
        .apply()
    return room != null
  }

  fun load(): Overlay? {
    val s = prefs.getString("pose", null) ?: return null
    val v = s.split(",").map { it.toFloat() }
    if (v.size != 7) return null
    val local = Pose(Vector3(v[0], v[1], v[2]), Quaternion(v[3], v[4], v[5], v[6]))
    val roomId = prefs.getString("room", "") ?: ""
    val w = prefs.getFloat("w", 0.3f)
    val h = prefs.getFloat("h", 0.2f)
    if (roomId.isEmpty()) return Overlay(local, w, h, false)
    val room = mruk.rooms.firstOrNull { it.anchor.uuid.toString() == roomId } ?: return null
    return Overlay(scene().getAnchorPose(room.anchor.handle).times(local), w, h, true)
  }

  fun clear() = prefs.edit().clear().apply()
}
