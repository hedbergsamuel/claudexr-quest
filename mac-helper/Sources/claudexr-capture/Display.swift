import AppKit
import CoreGraphics

enum Display {
  /// Geometry of the main display. Points are what the marker is drawn in; millimetres come from
  /// CGDisplayScreenSize (EDID), which the headset needs for a metric overlay.
  static func info() -> [String: Any] {
    let id = CGMainDisplayID()
    let screen = NSScreen.main
    let frame = screen?.frame ?? .zero
    let mode = CGDisplayCopyDisplayMode(id)
    let mm = CGDisplayScreenSize(id)
    return [
      "displayId": Int(id),
      "widthPt": Double(frame.width), "heightPt": Double(frame.height),
      "widthPx": mode?.pixelWidth ?? Int(CGDisplayPixelsWide(id)),
      "heightPx": mode?.pixelHeight ?? Int(CGDisplayPixelsHigh(id)),
      "widthMm": Double(mm.width), "heightMm": Double(mm.height),
    ]
  }
}
