package com.claudexr.quest

import com.meta.spatial.core.Pose
import com.meta.spatial.core.Quaternion
import com.meta.spatial.core.SystemManager
import com.meta.spatial.core.Vector3
import com.meta.spatial.mruk.MRUKFeature
import com.meta.spatial.mruk.SurfaceType
import com.meta.spatial.toolkit.PlayerBodyAttachmentSystem
import com.meta.spatial.toolkit.Transform
import android.util.Log
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Role table: Claude only says *which* role a panel has; this class decides *where* it goes.
 * Positions are relative to a "layout origin" = the user's head pose (yaw only) captured at the
 * first panel or when the user presses Recenter. If the room has been scanned (MRUK), panels are
 * pulled in so they never end up behind a real wall or furniture.
 */
class RoleLayout(
    private val systemManager: SystemManager,
    private val mruk: MRUKFeature?,
    private val viewerPose: () -> Pose?,
) {

  /** yawDeg: horizontal angle from straight ahead (negative = left). up: metres relative to eye height. */
  private data class Slot(val yawDeg: Float, val up: Float, val distance: Float)

  private val slots =
      mapOf(
          Role.PRIMARY to Slot(yawDeg = 0f, up = -0.10f, distance = 1.2f),
          Role.COMPARE to Slot(yawDeg = 0f, up = -0.05f, distance = 1.5f),
          Role.LOG to Slot(yawDeg = -40f, up = -0.20f, distance = 1.1f),
          Role.SIDE to Slot(yawDeg = 40f, up = -0.05f, distance = 1.1f),
          // Fallback for the Mac-screen mirror before calibration: low and close, like a laptop.
          Role.OVERLAY to Slot(yawDeg = 0f, up = -0.30f, distance = 0.7f),
      )
  private val activitySlot = Slot(yawDeg = -62f, up = -0.05f, distance = 1.0f)
  private val toastSlot = Slot(yawDeg = 0f, up = 0.22f, distance = 1.0f)
  private val statusSlot = Slot(yawDeg = 0f, up = -0.45f, distance = 1.0f)

  private var eye: Vector3? = null
  private var yawForward: Vector3? = null
  private var yawRight: Vector3? = null

  /** True once a plausible head pose has been captured. Until then panels get a provisional pose. */
  val hasOrigin: Boolean
    get() = eye != null

  /**
   * Capture the current head pose (position + yaw, no pitch/roll) as the layout origin.
   * Returns false while tracking isn't ready; callers retry on the next frame.
   */
  fun recenter(): Boolean {
    val head = currentHeadPose() ?: return false
    val f = head.q * Vector3.Forward
    f.y = 0f
    val r = head.q * Vector3.Right
    r.y = 0f
    if (len(f) < 1e-3f || len(r) < 1e-3f) return false
    eye = Vector3(head.t.x, head.t.y, head.t.z)
    yawForward = f.normalize()
    yawRight = r.normalize()
    Log.i(TAG, "layout origin: eye=${head.t}")
    return true
  }

  /**
   * Head pose in the app's (LOCAL_FLOOR) space. Primary source: Scene.getViewerPose().
   * Fallback: the avatar head entity. Rejects the all-zero pose that is reported before tracking
   * starts (that pose put panels on the floor in v0.1) and anything outside 0.3-2.5 m eye height.
   */
  private fun currentHeadPose(): Pose? {
    val candidates =
        listOf(
            runCatching { viewerPose() }.getOrNull(),
            systemManager
                .tryFindSystem<PlayerBodyAttachmentSystem>()
                ?.tryGetLocalPlayerAvatarBody()
                ?.head
                ?.tryGetComponent<Transform>()
                ?.transform,
        )
    return candidates.firstOrNull { it != null && it.t.y in 0.3f..2.5f }
  }

  fun poseFor(role: Role, indexInRole: Int): Pose {
    val s = slots.getValue(role)
    // Stack extra panels of the same role slightly to the side and closer.
    return place(Slot(s.yawDeg + indexInRole * 12f, s.up + indexInRole * 0.04f, s.distance - indexInRole * 0.05f))
  }

  /**
   * A pose [distance] m in front of the head (yaw only, no pitch) and [down] m below eye height, facing the user:
   * within finger reach (voice panel). Uses the live head pose; falls back to the layout origin.
   */
  fun nearHeadPose(distance: Float, down: Float): Pose {
    val head = currentHeadPose()
    val origin: Vector3
    var fwd: Vector3? = null
    if (head != null) {
      origin = Vector3(head.t.x, head.t.y, head.t.z)
      val f = head.q * Vector3.Forward
      f.y = 0f
      if (len(f) > 1e-3f) fwd = f.normalize()
    } else {
      origin = eye ?: Vector3(0f, 1.3f, 0f)
    }
    val dir = fwd ?: yawForward ?: Vector3.Forward
    val pos = origin + dir * distance
    pos.y = origin.y - down
    return Pose(pos, Quaternion.lookRotation(Vector3(pos.x - origin.x, 0f, pos.z - origin.z)))
  }

  fun statusPose(): Pose = place(statusSlot)

  fun activityPose(): Pose = place(activitySlot)

  fun toastPose(): Pose = place(toastSlot)

  /**
   * Collapsed panels line up low on the left ("tray"). 0.4.0: starts at -50° and grows to the left, so the tray is
   * never on top of the Mac screen or the keyboard (it used to start at -30°).
   */
  fun trayPose(index: Int): Pose = place(Slot(yawDeg = -50f - index * 9f, up = -0.50f, distance = 0.95f))

  /**
   * Position relative to the user's current head (yaw only), as requested by xr_panel move: ABSOLUTE metres from the
   * head (forward 1.5 = 1.5 m in front of the user), not a step from where the panel is now (IDE-ff2330).
   * 0.4.0: no longer moves the layout origin as a side effect.
   */
  fun relativePose(right: Float, up: Float, forward: Float): Pose {
    val head = currentHeadPose()
    var origin = eye ?: Vector3(0f, 1.3f, 0f)
    var fwd = yawForward ?: Vector3.Forward
    var r = yawRight ?: Vector3.Right
    if (head != null) {
      val f = head.q * Vector3.Forward
      f.y = 0f
      val rr = head.q * Vector3.Right
      rr.y = 0f
      if (len(f) > 1e-3f && len(rr) > 1e-3f) {
        origin = Vector3(head.t.x, head.t.y, head.t.z)
        fwd = f.normalize()
        r = rr.normalize()
      }
    }
    val pos = origin + fwd * forward + r * right
    pos.y = origin.y + up
    return Pose(pos, Quaternion.lookRotation(Vector3(pos.x - origin.x, 0f, pos.z - origin.z)))
  }

  // ---------------- 0.4.0: planned placement (see PlacementPlanner) ----------------

  /** The workspace the planner works in: where the user's eyes are and which way is "straight ahead". */
  class Frame(val eye: Vector3, val fwd: Vector3, val right: Vector3)

  /**
   * With a Mac screen ([macCentre], streamed or calibrated): the eyes are where the head is NOW and straight ahead
   * is the direction to the Mac screen. That is stable no matter where the user happens to look when a panel opens
   * (0.3.x used the gaze direction of that moment: "side" was sometimes right, sometimes straight ahead).
   * Without a Mac screen: the layout origin (first panel / Recenter).
   */
  fun frame(macCentre: Vector3?): Frame {
    val head = currentHeadPose()
    if (macCentre != null && head != null) {
      val f = Vector3(macCentre.x - head.t.x, 0f, macCentre.z - head.t.z)
      val hf = head.q * Vector3.Forward
      hf.y = 0f
      val hr = head.q * Vector3.Right
      hr.y = 0f
      if (len(f) > 0.15f && len(hf) > 1e-3f && len(hr) > 1e-3f) {
        val fwd = f.normalize()
        // "Right" = forward turned a quarter turn, the same way the head's right is turned from the head's forward
        // (taken from the head pose, so it does not depend on the coordinate convention).
        val sign = if (hf.z * hr.x - hf.x * hr.z >= 0f) 1f else -1f
        return Frame(Vector3(head.t.x, head.t.y, head.t.z), fwd, Vector3(fwd.z * sign, 0f, -fwd.x * sign))
      }
    }
    if (eye == null) recenter()
    return Frame(eye ?: Vector3(0f, 1.3f, 0f), yawForward ?: Vector3.Forward, yawRight ?: Vector3.Right)
  }

  /** Field-of-view rectangle of a panel (centre in world space, size in metres) as seen from the frame. */
  fun rectOf(f: Frame, centre: Vector3, widthM: Float, heightM: Float): PlacementPlanner.Rect {
    val dx = centre.x - f.eye.x
    val dz = centre.z - f.eye.z
    return PlacementPlanner.rectAt(dx * f.right.x + dz * f.right.z, centre.y - f.eye.y, dx * f.fwd.x + dz * f.fwd.z, widthM, heightM)
  }

  /** World pose for a planned spot: facing the user, pulled in if a scanned wall is in the way. */
  fun poseAt(f: Frame, s: PlacementPlanner.Spot): Pose {
    val dir = yaw(f.fwd, f.right, s.yawDeg)
    val distance = clampToRoom(f.eye, dir, s.distanceM)
    val pos = f.eye + dir * distance
    pos.y = f.eye.y + s.upM
    return Pose(pos, Quaternion.lookRotation(Vector3(pos.x - f.eye.x, 0f, pos.z - f.eye.z)))
  }

  private fun place(slot: Slot): Pose {
    if (eye == null) recenter()
    // Provisional origin until tracking is ready (MainActivity re-places everything once it is).
    val origin = eye ?: Vector3(0f, 1.3f, 0f)
    val fwd = yawForward ?: Vector3.Forward
    val right = yawRight ?: Vector3.Right
    val dir = yaw(fwd, right, slot.yawDeg)
    val distance = clampToRoom(origin, dir, slot.distance)
    val pos = origin + dir * distance
    pos.y = origin.y + slot.up
    // Panels face the user (same convention as Meta's samples: look from the eye to the panel).
    val flatToPanel = Vector3(pos.x - origin.x, 0f, pos.z - origin.z)
    return Pose(pos, Quaternion.lookRotation(flatToPanel))
  }

  /** If a scanned wall/object is closer than [wanted], stop 15 cm in front of it. */
  private fun clampToRoom(origin: Vector3, dir: Vector3, wanted: Float): Float {
    val feature = mruk ?: return wanted
    val room = feature.getCurrentRoom() ?: return wanted
    val hit =
        runCatching {
              feature.raycastRoom(room.anchor.uuid, origin, dir, wanted + 0.3f, SurfaceType.PLANE_VOLUME)
            }
            .getOrNull() ?: return wanted
    val d = len(hit.hitPosition - origin)
    return if (d < wanted + 0.15f) (d - 0.15f).coerceAtLeast(0.6f) else wanted
  }

  /** Direction [deg] degrees to the right of [fwd] in the horizontal plane (convention-free). */
  private fun yaw(fwd: Vector3, right: Vector3, deg: Float): Vector3 {
    val r = Math.toRadians(deg.toDouble())
    return fwd * cos(r).toFloat() + right * sin(r).toFloat()
  }

  private fun len(v: Vector3) = sqrt(v.x * v.x + v.y * v.y + v.z * v.z)

  companion object {
    private const val TAG = "ClaudeXR.Layout"
  }
}
