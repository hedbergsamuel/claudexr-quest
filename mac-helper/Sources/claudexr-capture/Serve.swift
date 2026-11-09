import Foundation

/// `claudexr-capture serve` (0.4.0): ONE long-lived process that owns every capture and the window list.
///
/// Why: with one helper process per stream, each new helper process (a new `stream`, or even a short `list-windows`)
/// interrupted the ScreenCaptureKit streams of the helpers that were already running. They died with -3805
/// ("application connection being interrupted"), so a new window stream "replaced" the previous one and the display
/// stream restarted with a new id (BUG-2e4ecb, BUG-2153ff, BUG-9e3e1b, BUG-39391d). Inside one process several
/// SCStreams live side by side, which is the normal way to use ScreenCaptureKit.
///
/// stdin, one JSON object per line:
///   {"cmd":"start","sid":"ab12cd34","window":178,"fps":30,"bitrate":12000000,"maxWidth":1600}
///   {"cmd":"start","sid":"ef56ab78","display":0,"excludeBundles":["com.apple.mail"],"fps":30,"bitrate":12000000,"maxWidth":1600}
///   {"cmd":"stop","sid":"ab12cd34"}
///   {"cmd":"key","sid":"ab12cd34"}                 IDR now
///   {"cmd":"bitrate","sid":"ab12cd34","bps":8000000}
///   {"cmd":"list","rid":"r1"}                      -> {"event":"windows","rid":"r1","windows":[...]}
/// stdout: frames [u32 BE len][u8 sidLen][sid][u64 BE captureUs][u8 flags(1=key)][H.264 Annex-B]
/// stderr: JSON events, each with "sid": started | first_frame | paused | resumed | stopped | error
///         plus {"event":"serve_ready","protocol":1} once at start.
/// stdin closed (the bridge died or let go) = exit, so no capture can outlive the bridge.
final class Server {
  private var captures: [String: Capture] = [:]
  private let lock = NSLock()

  func run() {
    emit(["event": "serve_ready", "protocol": 1])
    Thread {
      while let line = readLine() {
        guard let data = line.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let cmd = obj["cmd"] as? String
        else { continue }
        self.handle(cmd, obj)
      }
      exit(0)
    }.start()
  }

  private func get(_ sid: String) -> Capture? {
    lock.lock(); defer { lock.unlock() }
    return captures[sid]
  }

  private func handle(_ cmd: String, _ o: [String: Any]) {
    let sid = (o["sid"] as? String) ?? ""
    switch cmd {
    case "start":
      // sid: short ascii id chosen by the bridge (it is echoed in every frame header, so keep it small).
      guard !sid.isEmpty, sid.utf8.count <= 32, sid.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else {
        emit(["event": "error", "sid": sid, "message": "bad sid", "code": "bad_request"])
        return
      }
      if get(sid) != nil {
        emit(["event": "error", "sid": sid, "message": "sid already in use", "code": "bad_request"])
        return
      }
      let num: (String) -> Int? = { k in (o[k] as? NSNumber)?.intValue }
      let cap = Capture(
        windowID: num("window").map { UInt32($0) },
        displayID: num("display").map { UInt32($0) },
        excludeBundles: (o["excludeBundles"] as? [String]) ?? [],
        fps: num("fps") ?? 30,
        bitrate: num("bitrate") ?? 12_000_000,
        maxWidth: num("maxWidth") ?? 1600,
        sid: sid)
      cap.onEnd = { [weak self] c in
        guard let self, let id = c.sid else { return }
        self.lock.lock()
        if self.captures[id] === c { self.captures[id] = nil }
        self.lock.unlock()
      }
      lock.lock()
      captures[sid] = cap
      lock.unlock()
      Task {
        do { try await cap.start() } catch {
          var e = errorEvent(error)
          e["sid"] = sid
          emit(e)
          cap.stop(reportStopped: false)
        }
      }
    case "stop":
      // Unknown sid: answer "stopped" anyway so the bridge never waits for a capture that is already gone.
      if let c = get(sid) { c.stop() } else { emit(["event": "stopped", "sid": sid]) }
    case "key":
      get(sid)?.requestKeyframe()
    case "bitrate":
      if let b = (o["bps"] as? NSNumber)?.intValue, b > 0 { get(sid)?.setBitrate(b) }
    case "list":
      let rid = (o["rid"] as? String) ?? ""
      Task {
        do {
          emit(["event": "windows", "rid": rid, "windows": try await Capture.listWindows()])
        } catch {
          var e = errorEvent(error)
          e["event"] = "list_error"
          e["rid"] = rid
          emit(e)
        }
      }
    default:
      break
    }
  }
}
