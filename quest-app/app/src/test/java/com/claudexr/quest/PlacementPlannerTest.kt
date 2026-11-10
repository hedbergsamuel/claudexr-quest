package com.claudexr.quest

import com.claudexr.quest.PlacementPlanner.Rect
import com.claudexr.quest.PlacementPlanner.Spot
import com.claudexr.quest.PlacementPlanner.Zone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Panel placement without overlap (BUG-1fcf21, BUG-3115b5, BUG-4a4024, BUG-068994, BUG-405388). */
class PlacementPlannerTest {
  // The Mac screen as the app places it before calibration: 0.60 x 0.375 m, 0.7 m away, 0.30 m below eye height.
  private val mac = PlacementPlanner.rectAt(0f, -0.30f, 0.7f, 0.60f, 0.375f)

  private class Room(val mac: Rect?) {
    val rects = ArrayList<Rect>()
    val spots = ArrayList<Spot>()

    fun add(zone: Zone, w: Float, h: Float): Spot {
      val s = PlacementPlanner.plan(zone, w, h, rects, mac)
      rects += PlacementPlanner.rectOf(s, w, h)
      spots += s
      return s
    }

    fun assertNoOverlap() {
      for (i in rects.indices) for (j in i + 1 until rects.size) assertFalse("panel $i overlaps panel $j: ${rects[i]} ${rects[j]}", rects[i].intersects(rects[j], 0f))
      mac?.let { m -> rects.forEachIndexed { i, r -> assertFalse("panel $i is behind/over the Mac screen: $r", r.intersects(PlacementPlanner.macZone(m), 0f)) } }
    }
  }

  @Test
  fun primaryPanelGoesAboveTheMacScreenNotBehindIt() {
    val room = Room(mac)
    val s = room.add(Zone.CENTER, 1.10f, 0.75f) // xr_present, medium
    assertEquals(0f, s.yawDeg, 0.01f)
    assertTrue(s.free)
    val r = room.rects[0]
    assertTrue("bottom edge ${r.pitchMin} must be above the Mac's top edge ${mac.pitchMax}", r.pitchMin >= mac.pitchMax + PlacementPlanner.GAP_DEG - 0.01f)
    room.assertNoOverlap()
  }

  @Test
  fun fivePanelsAndAQuestionNeverOverlap() {
    // BUG-3115b5: 4 xr_present + 1 live page without a role, then a question.
    val room = Room(mac)
    repeat(4) { room.add(Zone.CENTER, 1.10f, 0.75f) }
    room.add(Zone.CENTER, 1.20f, 0.80f)
    val q = room.add(Zone.QUESTION, 0.80f, 0.53f)
    room.assertNoOverlap()
    assertTrue(room.spots.all { it.free })
    assertTrue("the question is the closest panel", room.spots.dropLast(1).all { it.distanceM > q.distanceM })
  }

  @Test
  fun questionCardIsBesideThePanelItAsksAboutAndCloser() {
    // BUG-4a4024 / BUG-405388: the card covered (or sat behind) the panel it asked about.
    val room = Room(mac)
    val table = room.add(Zone.CENTER, 1.60f, 1.00f) // xr_present table, large
    val q = room.add(Zone.QUESTION, 0.80f, 0.63f) // ask with 3 options
    room.assertNoOverlap()
    assertTrue(q.distanceM < table.distanceM)
    assertTrue("the card prefers the right side", q.yawDeg > 0f)
    assertTrue("the card stays within easy head turn (${q.yawDeg}°)", q.yawDeg <= 64f)
  }

  @Test
  fun questionAloneIsStraightAheadAboveTheMac() {
    val room = Room(mac)
    val q = room.add(Zone.QUESTION, 0.80f, 0.53f)
    assertEquals(0f, q.yawDeg, 0.01f)
    assertEquals(PlacementPlanner.QUESTION_DISTANCE, q.distanceM, 0.001f)
    room.assertNoOverlap()
  }

  @Test
  fun sideIsAlwaysRightAndLogAlwaysLeft() {
    // BUG-068994: a "side" diff panel ended up straight ahead, hidden by the Mac screen.
    val room = Room(mac)
    room.add(Zone.CENTER, 1.10f, 0.75f)
    val side = room.add(Zone.RIGHT, 1.60f, 1.00f) // diff, large
    val log = room.add(Zone.LEFT, 1.10f, 0.75f)
    val side2 = room.add(Zone.RIGHT, 0.90f, 0.70f)
    assertTrue(side.yawDeg >= 20f && side2.yawDeg >= 20f)
    assertTrue(room.spots.all { it.free })
    assertTrue(log.yawDeg <= -20f)
    room.assertNoOverlap()
  }

  @Test
  fun bigPanelsMoveAwayInsteadOfFillingTheView() {
    assertEquals(1.3f, PlacementPlanner.distanceFor(Zone.CENTER, 1.10f, 0.75f), 0.01f)
    val far = PlacementPlanner.distanceFor(Zone.CENTER, 1.60f, 1.00f)
    assertTrue(far > 1.5f && far <= PlacementPlanner.MAX_DISTANCE)
    assertEquals(PlacementPlanner.MAX_DISTANCE, PlacementPlanner.distanceFor(Zone.CENTER, 2.0f, 1.4f), 0.001f)
    // content never comes as close as a question card
    assertTrue(PlacementPlanner.distanceFor(Zone.RIGHT, 0.4f, 0.3f) > PlacementPlanner.distanceFor(Zone.QUESTION, 0.8f, 0.73f))
  }

  @Test
  fun worksWithoutAMacScreenAndAvoidsPanelsTheUserMoved() {
    val room = Room(null)
    val a = room.add(Zone.CENTER, 1.10f, 0.75f)
    assertEquals(0f, a.yawDeg, 0.01f)
    // the user dragged a panel to 1.3 m right, 0.9 m ahead, eye height (where "side" would normally go)
    room.rects += PlacementPlanner.rectAt(1.3f, 0f, 0.9f, 0.9f, 0.7f)
    room.add(Zone.RIGHT, 0.9f, 0.7f)
    room.add(Zone.QUESTION, 0.8f, 0.53f)
    room.assertNoOverlap()
  }

  @Test
  fun crowdedRoomFallsBackInFrontInsteadOfFailing() {
    val wall = listOf(Rect(-180f, 180f, -90f, 90f))
    val s = PlacementPlanner.plan(Zone.QUESTION, 0.8f, 0.53f, wall, mac)
    assertFalse(s.free)
    assertTrue(s.distanceM < PlacementPlanner.QUESTION_DISTANCE)
  }

  @Test
  fun overlayPanelsAreNeverBiggerThanTheMacScreen() {
    val (w, h) = PlacementPlanner.fitInside(0.70f, 0.50f, 0.60f, 0.375f)
    assertTrue(w <= 0.60f + 1e-4f && h <= 0.375f + 1e-4f)
    assertEquals(0.70f / 0.50f, w / h, 0.001f)
    assertEquals(0.30f to 0.20f, PlacementPlanner.fitInside(0.30f, 0.20f, 0.60f, 0.375f))
  }
}
