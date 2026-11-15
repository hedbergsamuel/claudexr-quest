import CoreMedia
import Foundation
import ScreenCaptureKit

/// 0.4.1 (punkt 7, IDE-8e4736): the Mac's system audio, for playback in the headset. Serve mode only.
///
///   stdin  {"cmd":"audio-start","sid":"au1","excludeBundles":["com.apple.mail"]}   {"cmd":"audio-stop","sid":"au1"}
///   stdout the same frame header as video: [u32 BE len][u8 sidLen][sid][u64 BE captureUs][u8 flags][payload]
///          with flags = 0x80 (AUDIO). Payload: PCM signed 16-bit little-endian, 48 000 Hz, 2 channels interleaved.
///   stderr {"event":"audio_started"|"audio_stopped"|"error"|"paused"|"resumed","sid":...}
///
/// Why PCM and not Opus: no codec on either side (the Quest app builds offline without new dependencies), lowest
/// possible latency, ~1.5 Mbit/s is nothing on the LAN the video already uses. Opus can come later.
/// ScreenCaptureKit needs a display filter even for audio only: a 2x2 px, 1 fps video output is attached and ignored.
/// UNVERIFIED (needs a real Mac): that excluded apps' audio is also left out, and the latency of SCK audio delivery.
/// Never run during the night build; it needs "Screen & System Audio Recording" for the helper.
final class AudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
  static let flagAudio: UInt8 = 0x80
  static let sampleRate = 48_000
  static let channels = 2

  let sid: String
  let excludeBundles: [String]
  var onEnd: ((AudioCapture) -> Void)?
  private var stream: SCStream?
  private let queue = DispatchQueue(label: "claudexr.audio")
  private let state = NSLock()
  private var _ended = false
  private var _paused = false
  private var observers: [NSObjectProtocol] = []
  private var formatWarned = false // touched on `queue` only

  init(sid: String, excludeBundles: [String]) {
    self.sid = sid
    self.excludeBundles = excludeBundles
  }

  private func ev(_ obj: [String: Any]) {
    var o = obj
    o["sid"] = sid
    emit(o)
  }

  func start() async throws {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    guard let d = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else {
      throw NSError(domain: "claudexr", code: 2, userInfo: [NSLocalizedDescriptionKey: "no display"])
    }
    let excluded = content.applications.filter { excludeBundles.contains($0.bundleIdentifier) }
    let filter = SCContentFilter(display: d, excludingApplications: excluded, exceptingWindows: [])
    let cfg = SCStreamConfiguration()
    cfg.width = 2
    cfg.height = 2
    cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
    cfg.queueDepth = 3
    cfg.showsCursor = false
    cfg.capturesAudio = true
    cfg.excludesCurrentProcessAudio = true
    cfg.sampleRate = AudioCapture.sampleRate
    cfg.channelCount = AudioCapture.channels
    let s = SCStream(filter: filter, configuration: cfg, delegate: self)
    try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
    try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue) // ignored; avoids "output not found" drops
    try await s.startCapture()
    stream = s
    observeLock()
    ev(["event": "audio_started", "rate": AudioCapture.sampleRate, "channels": AudioCapture.channels, "format": "s16le"])
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio, sb.isValid else { return }
    state.lock()
    let skip = _ended || _paused
    state.unlock()
    if skip { return }
    guard let asbd = sb.formatDescription?.audioStreamBasicDescription else { return }
    let isFloat = asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0
    let nonInterleaved = asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
    guard asbd.mFormatID == kAudioFormatLinearPCM, isFloat, asbd.mBitsPerChannel == 32, Int(asbd.mSampleRate) == AudioCapture.sampleRate else {
      if !formatWarned {
        formatWarned = true
        ev(["event": "warning", "message": "unexpected audio format \(asbd.mSampleRate) Hz, flags \(asbd.mFormatFlags), \(asbd.mBitsPerChannel) bit: dropped"])
      }
      return
    }
    let frames = CMSampleBufferGetNumSamples(sb)
    if frames <= 0 { return }
    let outCh = AudioCapture.channels
    var pcm = Data(count: frames * outCh * 2)
    do {
      try sb.withAudioBufferList { abl, _ in
        let bufs = abl
        let inCh = Int(asbd.mChannelsPerFrame)
        pcm.withUnsafeMutableBytes { raw in
          let out = raw.bindMemory(to: Int16.self)
          for f in 0..<frames {
            for c in 0..<outCh {
              let src = min(c, max(0, inCh - 1)) // mono source -> both ears
              var v: Float = 0
              if nonInterleaved {
                if src < bufs.count, let p = bufs[src].mData { v = p.assumingMemoryBound(to: Float.self)[f] }
              } else if let p = bufs[0].mData {
                v = p.assumingMemoryBound(to: Float.self)[f * inCh + src]
              }
              let clamped = max(-1, min(1, v))
              out[f * outCh + c] = Int16(clamped * 32767).littleEndian
            }
          }
        }
      }
    } catch {
      return
    }
    let ptsUs = UInt64(max(0, CMTimeGetSeconds(sb.presentationTimeStamp) * 1_000_000))
    let sidBytes = Array(sid.utf8)
    let pre = 1 + sidBytes.count
    var header = Data(count: 13 + pre)
    header.withUnsafeMutableBytes { p in
      p.storeBytes(of: UInt32(pre + 9 + pcm.count).bigEndian, toByteOffset: 0, as: UInt32.self)
      p.storeBytes(of: UInt8(sidBytes.count), toByteOffset: 4, as: UInt8.self)
      for (i, b) in sidBytes.enumerated() { p.storeBytes(of: b, toByteOffset: 5 + i, as: UInt8.self) }
      p.storeBytes(of: ptsUs.bigEndian, toByteOffset: 4 + pre, as: UInt64.self)
      p.storeBytes(of: AudioCapture.flagAudio, toByteOffset: 12 + pre, as: UInt8.self)
    }
    let frame = header + pcm
    CaptureOutput.queue.async {
      self.state.lock()
      let dead = self._ended
      self.state.unlock()
      if !dead { FileHandle.standardOutput.write(frame) }
    }
  }

  /// No audio while the Mac is locked or the screen saver runs (same rule as video).
  private func observeLock() {
    let c = DistributedNotificationCenter.default()
    let set: (Bool, String) -> Void = { [weak self] p, reason in
      guard let self else { return }
      self.state.lock()
      self._paused = p
      self.state.unlock()
      self.ev(p ? ["event": "paused", "reason": reason] : ["event": "resumed"])
    }
    observers = [
      c.addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in set(true, "screen_locked") },
      c.addObserver(forName: .init("com.apple.screensaver.didstart"), object: nil, queue: .main) { _ in set(true, "screensaver") },
      c.addObserver(forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main) { _ in set(false, "") },
      c.addObserver(forName: .init("com.apple.screensaver.didstop"), object: nil, queue: .main) { _ in set(false, "") },
    ]
  }

  func stop(reportStopped: Bool = true) {
    state.lock()
    let already = _ended
    _ended = true
    state.unlock()
    if already { return }
    let c = DistributedNotificationCenter.default()
    for o in observers { c.removeObserver(o) }
    observers.removeAll()
    let s = stream
    stream = nil
    Task {
      try? await s?.stopCapture()
      if reportStopped { self.ev(["event": "audio_stopped"]) }
      self.onEnd?(self)
    }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    ev(errorEvent(error))
    stop(reportStopped: false)
  }
}
