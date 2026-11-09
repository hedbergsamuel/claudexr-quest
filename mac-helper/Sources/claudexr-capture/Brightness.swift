import CoreGraphics
import Foundation
import IOKit

/// Backlight of the built-in display. `get` is read-only. `set` changes the REAL screen brightness:
/// the bridge calls it (dim while the display stream is live, restore afterwards); automated tests must
/// never run it (they use a fake helper). Built-in displays only: external monitors have no API here.
enum Brightness {
  private typealias GetFn = @convention(c) (CGDirectDisplayID, UnsafeMutablePointer<Float>) -> Int32
  private typealias SetFn = @convention(c) (CGDirectDisplayID, Float) -> Int32

  private static let handle = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY)
  private static let getFn: GetFn? = handle.flatMap { dlsym($0, "DisplayServicesGetBrightness") }.map { unsafeBitCast($0, to: GetFn.self) }
  private static let setFn: SetFn? = handle.flatMap { dlsym($0, "DisplayServicesSetBrightness") }.map { unsafeBitCast($0, to: SetFn.self) }

  static func builtinDisplay() -> CGDirectDisplayID? {
    var ids = [CGDirectDisplayID](repeating: 0, count: 16)
    var n: UInt32 = 0
    guard CGGetActiveDisplayList(16, &ids, &n) == .success else { return nil }
    return ids.prefix(Int(n)).first { CGDisplayIsBuiltin($0) != 0 }
  }

  static func get(_ id: CGDirectDisplayID) -> Float? {
    if let f = getFn {
      var v: Float = 0
      if f(id, &v) == 0 { return v }
    }
    return ioKit(id) { service in
      var v: Float = 0
      return IODisplayGetFloatParameter(service, 0, kIODisplayBrightnessKey as CFString, &v) == kIOReturnSuccess ? v : nil
    }
  }

  static func set(_ id: CGDirectDisplayID, _ value: Float) -> Bool {
    let v = min(1, max(0, value))
    if let f = setFn, f(id, v) == 0 { return true }
    return ioKit(id) { service in
      IODisplaySetFloatParameter(service, 0, kIODisplayBrightnessKey as CFString, v) == kIOReturnSuccess ? true : nil
    } ?? false
  }

  /// Fallback through IODisplayConnect services (deprecated, but present on some systems).
  private static func ioKit<T>(_ id: CGDirectDisplayID, _ body: (io_service_t) -> T?) -> T? {
    var iter: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IODisplayConnect"), &iter) == kIOReturnSuccess else { return nil }
    defer { IOObjectRelease(iter) }
    var s = IOIteratorNext(iter)
    while s != 0 {
      defer { IOObjectRelease(s) }
      if let r = body(s) { return r }
      s = IOIteratorNext(iter)
    }
    return nil
  }

  static func run(args: [String], displayArg: UInt32?) {
    func fail() -> Never {
      print("{\"error\":\"unsupported\"}")
      exit(1)
    }
    guard let id = displayArg ?? builtinDisplay() else { fail() }
    switch args.first {
    case "get":
      guard let v = get(id) else { fail() }
      printJSON(["brightness": Double(v), "displayId": Int(id)])
    case "set":
      guard args.count > 1, let v = Float(args[1]), v.isFinite else {
        FileHandle.standardError.write("usage: brightness set <0..1> [--display ID]\n".data(using: .utf8)!)
        exit(2)
      }
      let c = min(1, max(0, v))
      guard set(id, c) else { fail() }
      printJSON(["ok": true, "brightness": Double(c)])
    default:
      FileHandle.standardError.write("usage: brightness get|set <0..1> [--display ID]\n".data(using: .utf8)!)
      exit(2)
    }
  }
}
