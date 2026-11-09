package com.claudexr.quest

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.SessionConfiguration
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Quaternion
import com.meta.spatial.core.Vector3
import java.util.concurrent.Executors

/**
 * Finds the calibration QR code shown on the Mac with the left passthrough camera (Camera2,
 * Horizon OS v74+) and computes where the Mac's screen is in the room. Camera images are processed
 * in memory on the headset only and never leave it.
 *
 * Camera pose/intrinsics conversion follows Meta's Spatial Scanner showcase (CameraController.kt).
 */
class ScreenCalibrator(
    private val context: Context,
    private val viewerPose: () -> Pose,
    private val onDone: (Result) -> Unit,
) {
  data class Result(
      val ok: Boolean,
      val error: String? = null,
      val pose: Pose? = null,
      val widthM: Float = 0f,
      val heightM: Float = 0f,
      val detections: Int = 0,
      val residualPx: Float = 0f,
  )

  private class Detection(val center: Vector3, val right: Vector3, val up: Vector3, val forward: Vector3, val errPx: Double)

  private var thread: HandlerThread? = null
  private var camera: CameraDevice? = null
  private var reader: ImageReader? = null
  @Volatile private var busy = false
  @Volatile private var finished = false
  private val detections = ArrayList<Detection>()

  @SuppressLint("MissingPermission") // permissions are checked by MainActivity before start()
  fun start(req: Calibrate) {
    finished = false
    detections.clear()
    val mgr = context.getSystemService(CameraManager::class.java)
    val id =
        mgr.cameraIdList.firstOrNull { cid ->
          val ch = mgr.getCameraCharacteristics(cid)
          ch.get(KEY_SOURCE) == 0 && ch.get(KEY_POSITION) == 0
        } ?: mgr.cameraIdList.firstOrNull { mgr.getCameraCharacteristics(it).get(KEY_SOURCE) == 0 }
    if (id == null) return finish(Result(false, "no_passthrough_camera"))
    val ch = mgr.getCameraCharacteristics(id)
    val tr = ch.get(CameraCharacteristics.LENS_POSE_TRANSLATION)
    val rot = ch.get(CameraCharacteristics.LENS_POSE_ROTATION)
    val k = ch.get(CameraCharacteristics.LENS_INTRINSIC_CALIBRATION)
    val sensor = ch.get(CameraCharacteristics.SENSOR_INFO_PRE_CORRECTION_ACTIVE_ARRAY_SIZE)
    if (tr == null || rot == null || k == null || sensor == null) return finish(Result(false, "no_camera_intrinsics"))
    // Same conversion as Meta's Spatial Scanner sample.
    val headToCamera =
        Pose(
            Vector3(tr[0], tr[1], -tr[2]),
            Quaternion(rot[3], -rot[0], -rot[1], rot[2]).inverse().times(Quaternion(180f, 0f, 0f)),
        )
    val sizes = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)!!.getOutputSizes(ImageFormat.YUV_420_888)
    // Pick a resolution we handle explicitly (Meta: don't just take the largest). 1280x960 (4:3) preferred.
    val size = sizes.firstOrNull { it.width == 1280 && it.height == 960 } ?: sizes.firstOrNull { it.width * 3 == it.height * 4 } ?: sizes.first()
    // Intrinsics are given for the sensor array; scale them to the chosen output size.
    val sx = size.width.toDouble() / sensor.right
    val sy = size.height.toDouble() / sensor.bottom
    val fx = k[0] * sx
    val fy = k[1] * sy
    val cx = k[2] * sx
    val cy = k[3] * sy
    val plane = CalibrationMath.qrPlanePoints(req.modules, (req.markerSizeM / req.modules).toDouble())

    val t = HandlerThread("claudexr-calib").apply { start() }
    thread = t
    val handler = Handler(t.looper)
    val r = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 3)
    reader = r
    val qr = QRCodeReader()
    val hints = mapOf(DecodeHintType.TRY_HARDER to true, DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE))
    r.setOnImageAvailableListener({ ir ->
      val img = ir.acquireLatestImage() ?: return@setOnImageAvailableListener
      if (busy || finished) {
        img.close()
        return@setOnImageAvailableListener
      }
      busy = true
      val head = viewerPose() // approximate: pose at arrival (capture latency 20-40 ms; user holds still)
      val w = img.width
      val h = img.height
      val plane0 = img.planes[0]
      val y = ByteArray(w * h)
      val buf = plane0.buffer
      for (row in 0 until h) {
        buf.position(row * plane0.rowStride)
        buf.get(y, row * w, w)
      }
      img.close()
      try {
        val res = qr.decode(BinaryBitmap(HybridBinarizer(PlanarYUVLuminanceSource(y, w, h, 0, 0, w, h, false))), hints)
        val pts = res.resultPoints
        if (res.text == req.payload && pts != null && pts.size >= 4) {
          val img4 = pts.take(4).map { CalibrationMath.normalize(it.x.toDouble(), it.y.toDouble(), fx, fy, cx, cy, h.toDouble()) }
          CalibrationMath.solvePose(plane, img4)?.let { mp ->
            val cam = head.times(headToCamera)
            val toV = { v: CalibrationMath.V3 -> Vector3(v.x.toFloat(), v.y.toFloat(), v.z.toFloat()) }
            detections +=
                Detection(cam.times(toV(mp.t)), cam.q.times(toV(mp.right)), cam.q.times(toV(mp.up)), cam.q.times(toV(mp.forward)), mp.reprojErr * fx)
          }
        }
      } catch (_: Exception) {
        // not found in this frame
      } finally {
        busy = false
      }
      if (detections.size >= TARGET_DETECTIONS) finishWithAverage(req)
    }, handler)

    mgr.openCamera(
        id,
        object : CameraDevice.StateCallback() {
          override fun onOpened(cd: CameraDevice) {
            camera = cd
            cd.createCaptureSession(
                SessionConfiguration(
                    SessionConfiguration.SESSION_REGULAR,
                    listOf(OutputConfiguration(r.surface)),
                    Executors.newSingleThreadExecutor(),
                    object : CameraCaptureSession.StateCallback() {
                      override fun onConfigured(s: CameraCaptureSession) {
                        val rq = cd.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply { addTarget(r.surface) }
                        s.setRepeatingRequest(rq.build(), null, handler)
                      }

                      override fun onConfigureFailed(s: CameraCaptureSession) = finish(Result(false, "camera_session_failed"))
                    },
                ),
            )
          }

          override fun onDisconnected(cd: CameraDevice) = finish(Result(false, "camera_disconnected"))

          override fun onError(cd: CameraDevice, error: Int) = finish(Result(false, "camera_error_$error"))
        },
        handler,
    )
    handler.postDelayed({ if (!finished) finishWithAverage(req) }, req.seconds * 1000L)
  }

  private fun finishWithAverage(req: Calibrate) {
    if (finished) return
    if (detections.size < MIN_DETECTIONS) return finish(Result(false, "marker_not_found", detections = detections.size))
    // Robust average: drop detections more than 3 cm from the median centre.
    val med = Vector3(median(detections.map { it.center.x }), median(detections.map { it.center.y }), median(detections.map { it.center.z }))
    val good = detections.filter { (it.center - med).length() < 0.03f }.ifEmpty { detections }
    val n = good.size.toFloat()
    fun avg(f: (Detection) -> Vector3) = good.map(f).reduce { a, b -> a + b } * (1f / n)
    val center = avg { it.center }
    val fwd = avg { it.forward }.normalize()
    val up = avg { it.up }.normalize()
    val right = avg { it.right }.normalize()
    // Screen centre from the marker centre; the bridge reports the marker offset from the screen centre.
    val screenCenter = center - right * req.screen.markerOffsetX - up * req.screen.markerOffsetY
    // Overlay 4 mm in front of the physical screen, facing the user (same convention as other panels).
    val pose = Pose(screenCenter - fwd * 0.004f, Quaternion.lookRotation(fwd, up))
    finish(Result(true, pose = pose, widthM = req.screen.widthM, heightM = req.screen.heightM, detections = good.size, residualPx = good.map { it.errPx }.average().toFloat()))
  }

  private fun median(v: List<Float>) = v.sorted()[v.size / 2]

  /** Close the camera now (app paused / headset taken off). No-op when nothing is running. */
  fun cancel(reason: String) {
    if (!finished && (camera != null || reader != null)) finish(Result(false, reason))
  }

  private fun finish(r: Result) {
    if (finished) return
    finished = true
    runCatching { camera?.close() }
    runCatching { reader?.close() }
    thread?.quitSafely()
    camera = null
    reader = null
    Log.i(TAG, "calibration: $r")
    onDone(r)
  }

  companion object {
    private const val TAG = "ClaudeXR.Calibration"
    private const val TARGET_DETECTIONS = 10
    private const val MIN_DETECTIONS = 3
    private val KEY_SOURCE = CameraCharacteristics.Key("com.meta.extra_metadata.camera_source", Int::class.java)
    private val KEY_POSITION = CameraCharacteristics.Key("com.meta.extra_metadata.position", Int::class.java)
    const val PERMISSION_HEADSET_CAMERA = "horizonos.permission.HEADSET_CAMERA"
  }
}
