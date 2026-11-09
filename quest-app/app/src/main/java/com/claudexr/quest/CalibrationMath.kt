package com.claudexr.quest

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Pure math for screen calibration (no Android/SDK types, unit-tested on the JVM).
 *
 * Camera frame convention (same as Meta's Spatial Scanner sample): x right, y up, z forward.
 * Normalized image point of pixel (u, v) with v from the top: ((u - cx) / fx, ((H - v) - cy) / fy).
 * Marker plane: origin at the QR centre, X right, Y up, metres.
 */
object CalibrationMath {
  data class V3(val x: Double, val y: Double, val z: Double) {
    operator fun plus(o: V3) = V3(x + o.x, y + o.y, z + o.z)
    operator fun minus(o: V3) = V3(x - o.x, y - o.y, z - o.z)
    operator fun times(s: Double) = V3(x * s, y * s, z * s)
    fun dot(o: V3) = x * o.x + y * o.y + z * o.z
    fun cross(o: V3) = V3(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x)
    fun length() = sqrt(dot(this))
    fun normalized() = this * (1.0 / length())
  }

  /** Marker pose in camera coordinates: right/up/forward(into the marker plane, away from camera), centre t. */
  data class MarkerPose(val right: V3, val up: V3, val forward: V3, val t: V3, val reprojErr: Double)

  /**
   * Marker-plane coordinates of the points ZXing returns for a QR code, in ZXing's order:
   * bottom-left finder, top-left finder, top-right finder, alignment pattern (version >= 2).
   */
  fun qrPlanePoints(modules: Int, moduleSizeM: Double): List<Pair<Double, Double>> {
    val n = modules.toDouble()
    fun p(col: Double, row: Double) = Pair((col - n / 2) * moduleSizeM, (n / 2 - row) * moduleSizeM)
    return listOf(p(3.5, n - 3.5), p(3.5, 3.5), p(n - 3.5, 3.5), p(n - 6.5, n - 6.5))
  }

  fun normalize(u: Double, v: Double, fx: Double, fy: Double, cx: Double, cy: Double, imageHeight: Double) =
      Pair((u - cx) / fx, ((imageHeight - v) - cy) / fy)

  /** Planar pose from >= 4 correspondences via homography (DLT) + decomposition. */
  fun solvePose(plane: List<Pair<Double, Double>>, img: List<Pair<Double, Double>>): MarkerPose? {
    if (plane.size < 4 || plane.size != img.size) return null
    // h = [h11 h12 h13 h21 h22 h23 h31 h32], h33 = 1, least squares via normal equations.
    val rows = ArrayList<DoubleArray>()
    val rhs = ArrayList<Double>()
    for (i in plane.indices) {
      val (X, Y) = plane[i]
      val (x, y) = img[i]
      rows += doubleArrayOf(X, Y, 1.0, 0.0, 0.0, 0.0, -x * X, -x * Y); rhs += x
      rows += doubleArrayOf(0.0, 0.0, 0.0, X, Y, 1.0, -y * X, -y * Y); rhs += y
    }
    val ata = Array(8) { DoubleArray(8) }
    val atb = DoubleArray(8)
    for (r in rows.indices) for (i in 0 until 8) {
      atb[i] += rows[r][i] * rhs[r]
      for (j in 0 until 8) ata[i][j] += rows[r][i] * rows[r][j]
    }
    val h = solve(ata, atb) ?: return null
    val h1 = V3(h[0], h[3], h[6])
    val h2 = V3(h[1], h[4], h[7])
    val h3 = V3(h[2], h[5], 1.0)
    var lambda = 2.0 / (h1.length() + h2.length())
    if (h3.z * lambda < 0) lambda = -lambda // marker must be in front of the camera
    val r1 = (h1 * lambda).normalized()
    var r2 = h2 * lambda
    r2 = (r2 - r1 * r1.dot(r2)).normalized()
    val r3 = r1.cross(r2)
    val t = h3 * lambda
    var err = 0.0
    for (i in plane.indices) {
      val (X, Y) = plane[i]
      val pc = r1 * X + r2 * Y + t
      err += sqrt(sq(pc.x / pc.z - img[i].first) + sq(pc.y / pc.z - img[i].second))
    }
    return MarkerPose(r1, r2, r3, t, err / plane.size)
  }

  private fun sq(v: Double) = v * v

  /** Gaussian elimination with partial pivoting. */
  fun solve(a0: Array<DoubleArray>, b0: DoubleArray): DoubleArray? {
    val n = b0.size
    val a = Array(n) { a0[it].copyOf() }
    val b = b0.copyOf()
    for (c in 0 until n) {
      var p = c
      for (r in c + 1 until n) if (abs(a[r][c]) > abs(a[p][c])) p = r
      if (abs(a[p][c]) < 1e-12) return null
      val tr = a[c]; a[c] = a[p]; a[p] = tr
      val tb = b[c]; b[c] = b[p]; b[p] = tb
      for (r in c + 1 until n) {
        val f = a[r][c] / a[c][c]
        for (k in c until n) a[r][k] -= f * a[c][k]
        b[r] -= f * b[c]
      }
    }
    val x = DoubleArray(n)
    for (r in n - 1 downTo 0) {
      var s = b[r]
      for (k in r + 1 until n) s -= a[r][k] * x[k]
      x[r] = s / a[r][r]
    }
    return x
  }
}
