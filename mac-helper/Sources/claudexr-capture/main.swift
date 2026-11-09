// claudexr-capture: small CLI used by the ClaudeXR bridge (0.4.0).
//
//   list-windows                         JSON array of shareable windows
//   display-info                         JSON geometry of the main display (points, pixels, millimetres)
//   stream --window ID | --display ID [--exclude-bundles a,b] [--fps 30] [--bitrate 12000000] [--max-width 1600]
//        stdout: frames [u32 BE len][u64 BE captureUs][u8 flags(1=key)][H.264 Annex-B]
//        stderr: JSON events {"event":"started"|"first_frame"|"paused"|"resumed"|"error", ...}
//                error events carry "code" (NSError.code) and "domain" when known.
//        stdin : "K" = IDR now, "B <bps>" = bitrate
//   serve                                0.4.0: all captures + window list in one process, JSON commands on stdin
//                                        (protocol in Serve.swift). Preferred by the bridge; `stream` is kept as fallback.
//   show-marker --modules 25 --bits 0101... --size-pt 600 --seconds 20
//   stt-apple <file.wav> [--lang auto|sv-SE|en-US]   on-device speech recognition -> JSON {text, lang}
//   brightness get [--display ID]        {"brightness":0.62,"displayId":N}   (built-in display)
//   brightness set <0..1> [--display ID] {"ok":true,"brightness":v}  (NEVER run by tests: it changes the real backlight)
import AppKit
import CoreGraphics
import Foundation

/// One event line on stderr. Serialized: in `serve` mode several captures emit from different threads, and a long
/// line (the window list) must never be interleaved with another event.
let emitLock = NSLock()
func emit(_ obj: [String: Any]) {
  if let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) {
    emitLock.lock()
    FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
    emitLock.unlock()
  }
}

/// Error event with the numeric ScreenCaptureKit / Cocoa code and domain, so the bridge can give a precise message
/// (-3801 = user declined TCC, -3805 = connection to the capture service interrupted, ...).
func errorEvent(_ error: Error) -> [String: Any] {
  let ns = error as NSError
  return ["event": "error", "message": "\(error)", "code": ns.code, "domain": ns.domain]
}

/// Early warning when Screen & System Audio Recording looks denied for the process running us. It is only a WARNING:
/// CGPreflightScreenCaptureAccess() is unreliable for command-line tools whose responsible process is another binary
/// (launchd -> node -> this helper; the 0.2.0 display stream worked in that chain). ScreenCaptureKit itself decides:
/// a real refusal arrives as error -3801, which the bridge turns into a precise message.
func warnIfScreenCaptureLooksDenied() {
  if !CGPreflightScreenCaptureAccess() {
    emit([
      "event": "warning", "code": "tcc_preflight_false",
      "message":
        "Skärm- och systemljudsinspelning verkar inte vara tillåten för processen som kör hjälparen (bryggans node eller claudexr-capture). Försöker ändå; vid -3801 tillåt den under Systeminställningar → Integritet och säkerhet → Skärm- och systemljudsinspelning.",
    ])
  }
}

func printJSON(_ obj: Any) {
  let d = try! JSONSerialization.data(withJSONObject: obj, options: [])
  FileHandle.standardOutput.write(d)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func arg(_ name: String) -> String? {
  let a = CommandLine.arguments
  guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
  return a[i + 1]
}

// Connect to the window server BEFORE any CoreGraphics / ScreenCaptureKit call. A bare command-line process has no
// window-server connection; the first CG call then trips "Assertion failed: (did_initialize), function
// CGS_REQUIRE_INIT" (seen in the 0.2.0 bridge log) and ScreenCaptureKit streams die with -3805 ("application
// connection being interrupted"). NSApplication.shared performs that initialisation; the .prohibited policy keeps it
// invisible (no Dock icon, no menu bar). show-marker switches to .accessory itself to draw its window.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
_ = CGMainDisplayID()

let command = CommandLine.arguments.dropFirst().first ?? ""

switch command {
case "list-windows":
  warnIfScreenCaptureLooksDenied()
  Task {
    do {
      printJSON(try await Capture.listWindows())
      exit(0)
    } catch {
      emit(errorEvent(error))
      exit(1)
    }
  }
  app.run()
case "display-info":
  printJSON(Display.info())
case "stream":
  warnIfScreenCaptureLooksDenied()
  let cap = Capture(
    windowID: arg("--window").flatMap { UInt32($0) },
    displayID: arg("--display").flatMap { UInt32($0) },
    excludeBundles: (arg("--exclude-bundles") ?? "").split(separator: ",").map(String.init),
    fps: Int(arg("--fps") ?? "30") ?? 30,
    bitrate: Int(arg("--bitrate") ?? "12000000") ?? 12_000_000,
    maxWidth: Int(arg("--max-width") ?? "1600") ?? 1600)
  Task {
    do { try await cap.start() } catch {
      emit(errorEvent(error))
      exit(1)
    }
  }
  app.run()
case "serve":
  // 0.4.0: every capture and the window list in ONE process (see Serve.swift for why and for the protocol).
  warnIfScreenCaptureLooksDenied()
  let server = Server()
  server.run()
  app.run()
case "show-marker":
  Marker.run(
    modules: Int(arg("--modules") ?? "25") ?? 25, bits: arg("--bits") ?? "",
    sizePt: Double(arg("--size-pt") ?? "600") ?? 600, seconds: Double(arg("--seconds") ?? "20") ?? 20)
case "stt-apple":
  let file = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : ""
  AppleSTT.run(file: file, lang: arg("--lang") ?? "auto")
case "brightness":
  Brightness.run(args: Array(CommandLine.arguments.dropFirst(2)), displayArg: arg("--display").flatMap { UInt32($0) })
default:
  FileHandle.standardError.write("usage: claudexr-capture list-windows|display-info|stream|serve|show-marker|stt-apple|brightness\n".data(using: .utf8)!)
  exit(2)
}
