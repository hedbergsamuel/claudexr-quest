package com.claudexr.quest

import com.claudexr.quest.CalibrationMath.V3
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CalibrationMathTest {
  @Test
  fun recoversMarkerPoseFromFourQrPoints() {
    // Marker 0.12 m wide, yawed 25° and pitched -10°, 0.6 m in front of the camera, slightly off-centre.
    val yaw = Math.toRadians(25.0)
    val pitch = Math.toRadians(-10.0)
    val ry = { v: V3 -> V3(v.x * cos(yaw) + v.z * sin(yaw), v.y, -v.x * sin(yaw) + v.z * cos(yaw)) }
    val rx = { v: V3 -> V3(v.x, v.y * cos(pitch) - v.z * sin(pitch), v.y * sin(pitch) + v.z * cos(pitch)) }
    val rot = { v: V3 -> ry(rx(v)) }
    val t = V3(0.05, -0.03, 0.6)
    val plane = CalibrationMath.qrPlanePoints(25, 0.12 / 25)
    // Project with a 1280x960 camera (fx=fy=880, principal point at the centre), then back to normalized coords.
    val fx = 880.0
    val cx = 640.0
    val cy = 480.0
    val img =
        plane.map { (X, Y) ->
          val p = rot(V3(X, Y, 0.0)) + t
          val u = fx * p.x / p.z + cx
          val v = 960.0 - (fx * p.y / p.z + cy) // pixel rows from the top
          CalibrationMath.normalize(u + 0.2, v - 0.2, fx, fx, cx, cy, 960.0) // + sub-pixel detection noise
        }
    val pose = CalibrationMath.solvePose(plane, img)
    assertNotNull(pose)
    pose!!
    assertTrue("centre error ${(pose.t - t).length()}", (pose.t - t).length() < 0.003) // < 3 mm
    val n = rot(V3(0.0, 0.0, 1.0))
    assertTrue("normal ${pose.forward}", pose.forward.dot(n) > 0.999)
    assertEquals(1.0, pose.right.length(), 1e-9)
    assertTrue(abs(pose.right.dot(pose.up)) < 1e-9)
  }
}
