package com.claudexr.quest

import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.tan

/**
 * Where a new panel goes (0.4.0). Pure math, no Spatial SDK types: unit-tested in PlacementPlannerTest.
 *
 * 0.3.x had one fixed slot per role and stacked panels of the same role 12° apart, although a panel is 35-70° wide.
 * Result: panels on top of each other, new panels behind the Mac screen, and the question card under the panel it
 * asked about (BUG-1fcf21, BUG-3115b5, BUG-4a4024, BUG-068994, BUG-405388).
 *
 * Now everything is planned in the user's field of view, in degrees, relative to a fixed "workspace frame"
 * (forward = towards the Mac screen when there is one; see RoleLayout.frame):
 *  * every visible panel and the Mac screen (plus everything below it: keyboard, hands) is an occupied rectangle;
 *  * a new panel takes the free spot closest to the preferred spot of its zone;
 *  * a panel that is too big for a comfortable angle is moved further away instead (1.0-2.0 m, plan section 7);
 *  * question cards are the closest panels in the room (1.0 m), so nothing can ever be in front of them.
 */
object PlacementPlanner {
  /** Field-of-view rectangle in degrees. Yaw: right of forward is positive. Pitch: up from eye height is positive. */
  data class Rect(val yawMin: Float, val yawMax: Float, val pitchMin: Float, val pitchMax: Float) {
    fun intersects(o: Rect, gap: Float): Boolean =
        yawMin < o.yawMax + gap && o.yawMin < yawMax + gap && pitchMin < o.pitchMax + gap && o.pitchMin < pitchMax + gap
  }

  /** Panel centre: [yawDeg] from forward, [upM] metres above eye height, [distanceM] horizontal distance. */
  data class Spot(val yawDeg: Float, val upM: Float, val distanceM: Float, val free: Boolean = true)

  enum class Zone {
    /** straight ahead, above the Mac screen: primary content, comparisons */
    CENTER,
    /** to the right: role "side" */
    RIGHT,
    /** to the left: role "log" */
    LEFT,
    /** cards that wait for an answer (ask, test, approval, listen): closest to the user, as near straight ahead as is free */
    QUESTION,
  }

  const val GAP_DEG = 2f
  private const val MAX_PITCH = 42f
  private const val MIN_PITCH = -40f
  /** how far to the side a panel may be planned (beyond ~100° the user has to turn the chair) */
  private const val MAX_YAW = 132f
  /** a panel should not be taller than this many degrees (neck comfort); bigger panels are moved away */
  private const val COMFORT_HALF_H = 17f
  private const val COMFORT_HALF_W = 36f
  const val QUESTION_DISTANCE = 1.0f
  const val MAX_DISTANCE = 2.0f

  private fun deg(rad: Float) = Math.toDegrees(rad.toDouble()).toFloat()

  private fun tanDeg(d: Float) = tan(Math.toRadians(d.toDouble())).toFloat()

  /** Rectangle of a panel given by its centre relative to the frame: [rightM], [upM] (from eye height), [forwardM]. */
  fun rectAt(rightM: Float, upM: Float, forwardM: Float, widthM: Float, heightM: Float): Rect {
    val d = max(hypot(rightM, forwardM), 0.2f)
    val yaw = deg(atan2(rightM, forwardM))
    val hw = deg(atan(widthM / 2 / d))
    return Rect(yaw - hw, yaw + hw, deg(atan((upM - heightM / 2) / d)), deg(atan((upM + heightM / 2) / d)))
  }

  fun rectOf(s: Spot, widthM: Float, heightM: Float): Rect {
    val hw = deg(atan(widthM / 2 / s.distanceM))
    return Rect(s.yawDeg - hw, s.yawDeg + hw, deg(atan((s.upM - heightM / 2) / s.distanceM)), deg(atan((s.upM + heightM / 2) / s.distanceM)))
  }

  /** Everything below the Mac screen is taken too (keyboard, trackpad, hands): nothing is ever planned there. */
  fun macZone(mac: Rect): Rect = Rect(mac.yawMin, mac.yawMax, -90f, mac.pitchMax)

  /** Comfortable distance for a panel of this size: big panels go further away instead of filling the view. */
  fun distanceFor(zone: Zone, widthM: Float, heightM: Float): Float {
    if (zone == Zone.QUESTION) {
      // Always closer than any content panel (>= 1.2 m), a little further only for very tall cards.
      return min(1.15f, max(QUESTION_DISTANCE, heightM / (2 * tanDeg(22f))))
    }
    val base = if (zone == Zone.CENTER) 1.3f else 1.2f
    val need = max(heightM / (2 * tanDeg(COMFORT_HALF_H)), widthM / (2 * tanDeg(COMFORT_HALF_W)))
    return min(MAX_DISTANCE, max(base, need))
  }

  /**
   * @param occupied rectangles of the visible panels (not the Mac screen)
   * @param mac the Mac screen (streamed or calibrated), null when unknown
   */
  fun plan(zone: Zone, widthM: Float, heightM: Float, occupied: List<Rect>, mac: Rect?): Spot {
    val d = distanceFor(zone, widthM, heightM)
    val hw = deg(atan(widthM / 2 / d))
    val blocked = if (mac != null) occupied + macZone(mac) else occupied
    // Lowest centre whose bottom edge clears the Mac screen (straight ahead).
    val aboveMac = mac?.let { pitchForBottom(it.pitchMax + GAP_DEG, heightM, d) }
    val prefYaw =
        when (zone) {
          Zone.CENTER, Zone.QUESTION -> 0f
          // beside the Mac screen, never closer to the centre than 45° (or the Mac edge + own half width)
          Zone.RIGHT -> max(45f, (mac?.yawMax ?: 0f) + GAP_DEG + hw)
          Zone.LEFT -> min(-45f, (mac?.yawMin ?: 0f) - GAP_DEG - hw)
        }
    val prefPitch =
        when (zone) {
          Zone.CENTER, Zone.QUESTION -> aboveMac ?: -3f
          Zone.RIGHT, Zone.LEFT -> 0f
        }
    // First inside the zone; if the zone is full, anywhere free (a panel far to the side beats two on top of each other).
    for (strict in listOf(true, false)) {
      var best: Spot? = null
      var bestCost = Float.MAX_VALUE
      var yaw = -MAX_YAW
      while (yaw <= MAX_YAW) {
        val y = yaw
        yaw += 4f
        if (strict && zone == Zone.RIGHT && y < 20f) continue
        if (strict && zone == Zone.LEFT && y > -20f) continue
        for (p in pitchCandidates(prefPitch)) {
          val spot = Spot(y, d * tanDeg(p), d)
          val r = rectOf(spot, widthM, heightM)
          if (r.pitchMax > MAX_PITCH || r.pitchMin < MIN_PITCH) continue
          if (blocked.any { it.intersects(r, GAP_DEG) }) continue
          // Height changes cost more than turning the head; a question prefers the right side on a tie.
          val cost = abs(y - prefYaw) + 2f * abs(p - prefPitch) + (if (zone == Zone.QUESTION && y < 0f) 0.5f else 0f)
          if (cost < bestCost) {
            bestCost = cost
            best = spot
          }
        }
      }
      best?.let { return it }
      if (zone == Zone.CENTER || zone == Zone.QUESTION) break // already unrestricted
    }
    // Nothing free (very crowded room): the preferred spot, pulled 15 cm towards the user so it is at least on top.
    val fd = max(0.6f, d - 0.15f)
    return Spot(prefYaw, fd * tanDeg(prefPitch), fd, free = false)
  }

  /** Centre pitch (degrees) that puts the bottom edge of a panel at [bottomDeg]. */
  private fun pitchForBottom(bottomDeg: Float, heightM: Float, d: Float): Float = deg(atan((d * tanDeg(bottomDeg) + heightM / 2) / d))

  private fun pitchCandidates(pref: Float): List<Float> {
    val out = ArrayList<Float>(24)
    out += pref
    var p = -24f
    while (p <= 30f) {
      out += p
      p += 3f
    }
    return out
  }

  /**
   * Size for a non-stream panel shown with role "overlay": never bigger than the Mac screen it sits on
   * (BUG-405388: it used to cover the keyboard and the question card). Keeps the aspect ratio.
   */
  fun fitInside(widthM: Float, heightM: Float, maxW: Float, maxH: Float): Pair<Float, Float> {
    val k = min(1f, min(maxW / widthM, maxH / heightM))
    return widthM * k to heightM * k
  }
}
