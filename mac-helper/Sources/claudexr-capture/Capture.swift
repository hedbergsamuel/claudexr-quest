import Carbon // IsSecureEventInputEnabled
import CoreMedia
import Foundation
import ScreenCaptureKit
import VideoToolbox

/// Window/display capture -> low-latency H.264 -> framed Annex-B on stdout. Compiled, but stream is UNTESTED on a real screen.
final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
  let windowID: UInt32?
  let displayID: UInt32?
  let excludeBundles: [String]
  let fps: Int
  var bitrate: Int
  let maxWidth: Int

  private var stream: SCStream?
  private var session: VTCompressionSession?
  private let out = DispatchQueue(label: "claudexr.out") // serializes stdout writes
  private let captureQueue = DispatchQueue(label: "claudexr.capture")
  // Review 2 R2-07: these were written from the stdin thread / main queue and read on the capture queue
  // (data race; an IDR request could be lost). All access now goes through `state`.
  private let state = NSLock()
  private var _forceKey = true
  private var _paused = false
  private var secureInput = false
  private var forceKey: Bool {
    get { state.lock(); defer { state.unlock() }; return _forceKey }
    set { state.lock(); _forceKey = newValue; state.unlock() }
  }
  private var paused: Bool {
    get { state.lock(); defer { state.unlock() }; return _paused }
    set { state.lock(); _paused = newValue; state.unlock() }
  }
  /** Take-and-clear, so two threads can't both consume (or lose) one IDR request. */
  private func takeForceKey() -> Bool {
    state.lock(); defer { state.unlock() }
    let k = _forceKey
    _forceKey = false
    return k
  }
  private var startTime: CMTime?
  // 0.3.0: ScreenCaptureKit only delivers a frame when the content changes, so a static window/screen would stay
  // blank (and an IDR request "K" had no effect). The last frame is kept and re-encoded when an IDR is requested
  // and every 500 ms of silence. All of these are touched on `captureQueue` only.
  private var lastPixel: CVPixelBuffer?
  private var lastFrameAt = DispatchTime.now()
  private var lastPts = CMTime.invalid
  private var idleTimer: DispatchSourceTimer?
  private var firstFrameEmitted = false // guarded by `state`

  init(windowID: UInt32?, displayID: UInt32?, excludeBundles: [String], fps: Int, bitrate: Int, maxWidth: Int) {
    self.windowID = windowID
    self.displayID = displayID
    self.excludeBundles = excludeBundles
    self.fps = max(5, min(60, fps))
    self.bitrate = bitrate
    self.maxWidth = maxWidth
  }

  static func listWindows() async throws -> [[String: Any]] {
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    return content.windows.filter { $0.frame.width > 80 && $0.frame.height > 60 && $0.windowLayer == 0 }.map { w in
      [
        "id": Int(w.windowID), "title": w.title ?? "", "app": w.owningApplication?.applicationName ?? "",
        "bundleId": w.owningApplication?.bundleIdentifier ?? "", "pid": Int(w.owningApplication?.processID ?? 0),
        "width": Int(w.frame.width), "height": Int(w.frame.height), "onScreen": w.isOnScreen,
      ]
    }
  }

  func start() async throws {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    let filter: SCContentFilter
    var srcW: CGFloat
    var srcH: CGFloat
    if let wid = windowID {
      guard let w = content.windows.first(where: { $0.windowID == wid }) else { throw NSError(domain: "claudexr", code: 1, userInfo: [NSLocalizedDescriptionKey: "window \(wid) not found"]) }
      filter = SCContentFilter(desktopIndependentWindow: w)
      srcW = w.frame.width * 2
      srcH = w.frame.height * 2
    } else {
      let did = displayID ?? CGMainDisplayID()
      guard let d = content.displays.first(where: { $0.displayID == did }) ?? content.displays.first else { throw NSError(domain: "claudexr", code: 2, userInfo: [NSLocalizedDescriptionKey: "no display"]) }
      // Excluded apps (password managers, Mail, Messages ...) are blanked out of the mirror.
      let excluded = content.applications.filter { excludeBundles.contains($0.bundleIdentifier) }
      filter = SCContentFilter(display: d, excludingApplications: excluded, exceptingWindows: [])
      srcW = CGFloat(d.width) * 2
      srcH = CGFloat(d.height) * 2
    }
    // Encode at the size the panel can show (bridge passes --max-width), never larger than the source.
    let scale = min(1.0, CGFloat(maxWidth) / srcW)
    let w = Int(srcW * scale) & ~1
    let h = Int(srcH * scale) & ~1

    let cfg = SCStreamConfiguration()
    cfg.width = w
    cfg.height = h
    cfg.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange // NV12: no conversion before VideoToolbox
    cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    cfg.queueDepth = 3
    cfg.showsCursor = true
    cfg.capturesAudio = false

    try makeEncoder(width: w, height: h)
    let s = SCStream(filter: filter, configuration: cfg, delegate: self)
    try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: captureQueue)
    try await s.startCapture()
    stream = s
    observeLock()
    readStdin()
    startIdleTimer()
    emit(["event": "started", "width": w, "height": h])
  }

  // MARK: encoder

  private func makeEncoder(width: Int, height: Int) throws {
    let spec = [kVTVideoEncoderSpecification_EnableLowLatencyRateControl: true] as CFDictionary
    var s: VTCompressionSession?
    let st = VTCompressionSessionCreate(
      allocator: nil, width: Int32(width), height: Int32(height), codecType: kCMVideoCodecType_H264,
      encoderSpecification: spec, imageBufferAttributes: nil, compressedDataAllocator: nil,
      outputCallback: nil, refcon: nil, compressionSessionOut: &s)
    guard st == noErr, let session = s else { throw NSError(domain: "claudexr", code: Int(st), userInfo: [NSLocalizedDescriptionKey: "VTCompressionSessionCreate \(st)"]) }
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_High_AutoLevel)
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: bitrate as CFNumber)
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: fps as CFNumber)
    // Long GOP; IDR frames are requested on demand by the bridge ("K" on stdin).
    VTSessionSetProperty(session, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: (fps * 10) as CFNumber)
    VTCompressionSessionPrepareToEncodeFrames(session)
    self.session = session
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, !paused, session != nil, let px = CMSampleBufferGetImageBuffer(sb) else { return }
    if checkSecure() { return }
    // Only complete frames (ScreenCaptureKit also delivers idle/blank status frames).
    if let att = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
      let raw = att.first?[.status] as? Int, let status = SCFrameStatus(rawValue: raw), status != .complete
    {
      return
    }
    lastPixel = px
    lastFrameAt = DispatchTime.now()
    encode(px, pts: monotonic(CMSampleBufferGetPresentationTimeStamp(sb)))
  }

  /// Review 2 R2-07: while any app has Secure Event Input on (password prompts in Terminal/iTerm for
  /// sudo/ssh, password fields), send nothing. Returns true while secure. Capture queue only.
  private func checkSecure() -> Bool {
    let secure = IsSecureEventInputEnabled()
    if secure != secureInput {
      secureInput = secure
      if secure { emit(["event": "paused", "reason": "secure_input"]) } else {
        forceKey = true
        emit(["event": "resumed"])
      }
    }
    return secure
  }

  /// Presentation times must never go backwards (repeated frames use the host clock).
  private func monotonic(_ t: CMTime) -> CMTime {
    var out = t
    if lastPts.isValid, CMTimeCompare(out, lastPts) <= 0 { out = CMTimeAdd(lastPts, CMTime(value: 1000, timescale: 1_000_000)) }
    lastPts = out
    return out
  }

  private func encode(_ px: CVPixelBuffer, pts: CMTime) {
    guard let session else { return }
    var props: CFDictionary?
    if takeForceKey() {
      props = [kVTEncodeFrameOptionKey_ForceKeyFrame: true] as CFDictionary
    }
    VTCompressionSessionEncodeFrame(session, imageBuffer: px, presentationTimeStamp: pts, duration: .invalid, frameProperties: props, infoFlagsOut: nil) {
      [weak self] status, _, sample in
      guard status == noErr, let sample, let self else { return }
      self.write(sample)
    }
  }

  /// Re-encode the last frame (static content). `idleFor` = minimum silence in seconds (0 = right now, for "K").
  private func reencodeLast(idleFor: Double) {
    guard !paused, let px = lastPixel else { return }
    let idle = Double(DispatchTime.now().uptimeNanoseconds - lastFrameAt.uptimeNanoseconds) / 1e9
    guard idle >= idleFor else { return }
    if checkSecure() { return }
    lastFrameAt = DispatchTime.now()
    encode(px, pts: monotonic(CMClockGetTime(CMClockGetHostTimeClock())))
  }

  private func startIdleTimer() {
    let t = DispatchSource.makeTimerSource(queue: captureQueue)
    t.schedule(deadline: .now() + 0.5, repeating: 0.5)
    t.setEventHandler { [weak self] in self?.reencodeLast(idleFor: 0.5) }
    t.resume()
    idleTimer = t
  }

  /// AVCC -> Annex-B (+ SPS/PPS before keyframes), framed for the bridge.
  private func write(_ sample: CMSampleBuffer) {
    guard let block = CMSampleBufferGetDataBuffer(sample), let fmt = CMSampleBufferGetFormatDescription(sample) else { return }
    let notSync = (CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]])?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false
    let key = !notSync
    var annexB = Data()
    let start: [UInt8] = [0, 0, 0, 1]
    if key {
      var count = 0
      CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil, parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
      for i in 0..<count {
        var ptr: UnsafePointer<UInt8>?
        var size = 0
        if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: i, parameterSetPointerOut: &ptr, parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let ptr {
          annexB.append(contentsOf: start)
          annexB.append(ptr, count: size)
        }
      }
    }
    // Review 2 R2-07: the block buffer may be non-contiguous; GetDataPointer then only covers the first
    // segment (reading `totalLength` bytes from it would run past the segment). Copy out explicitly.
    let length = CMBlockBufferGetDataLength(block)
    var avcc = [UInt8](repeating: 0, count: length)
    guard CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: &avcc) == kCMBlockBufferNoErr else { return }
    var off = 0
    while off + 4 <= length {
      let nalLen = Int(avcc[off]) << 24 | Int(avcc[off + 1]) << 16 | Int(avcc[off + 2]) << 8 | Int(avcc[off + 3])
      off += 4
      guard nalLen > 0, off + nalLen <= length else { break }
      annexB.append(contentsOf: start)
      annexB.append(contentsOf: avcc[off..<(off + nalLen)])
      off += nalLen
    }
    let ptsUs = UInt64(max(0, CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) * 1_000_000))
    var header = Data(count: 13)
    header.withUnsafeMutableBytes { p in
      p.storeBytes(of: UInt32(9 + annexB.count).bigEndian, toByteOffset: 0, as: UInt32.self)
      p.storeBytes(of: ptsUs.bigEndian, toByteOffset: 4, as: UInt64.self)
      p.storeBytes(of: UInt8(key ? 1 : 0), toByteOffset: 12, as: UInt8.self)
    }
    state.lock()
    let first = !firstFrameEmitted
    firstFrameEmitted = true
    state.unlock()
    out.async {
      FileHandle.standardOutput.write(header + annexB)
      if first { emit(["event": "first_frame"]) }
    }
  }

  // MARK: control + privacy

  /// "K" = IDR now, "B <bps>" = bitrate (from the bridge's flow control).
  private func readStdin() {
    Thread {
      while let line = readLine() {
        let t = line.trimmingCharacters(in: .whitespaces)
        if t == "K" {
          self.forceKey = true
          // Static content produces no new frames: re-encode the last one as an IDR right away.
          self.captureQueue.async { self.reencodeLast(idleFor: 0) }
        } else if t.hasPrefix("B "), let b = Int(t.dropFirst(2)), let s = self.session {
          self.bitrate = b
          VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AverageBitRate, value: b as CFNumber)
        }
      }
      exit(0) // bridge closed our stdin: stop
    }.start()
  }

  /// Pause (send nothing) while the Mac is locked or the screen saver runs.
  private func observeLock() {
    let c = DistributedNotificationCenter.default()
    let pause: (String) -> Void = { reason in
      self.paused = true
      emit(["event": "paused", "reason": reason])
    }
    let resume: () -> Void = {
      self.paused = false
      self.forceKey = true
      emit(["event": "resumed"])
    }
    c.addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in pause("screen_locked") }
    c.addObserver(forName: .init("com.apple.screensaver.didstart"), object: nil, queue: .main) { _ in pause("screensaver") }
    c.addObserver(forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main) { _ in resume() }
    c.addObserver(forName: .init("com.apple.screensaver.didstop"), object: nil, queue: .main) { _ in resume() }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    emit(errorEvent(error))
    exit(1)
  }
}
