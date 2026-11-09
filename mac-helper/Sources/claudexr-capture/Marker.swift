import AppKit

/// Full-screen calibration marker: a QR module matrix (from the bridge) drawn centred on the main
/// display, with a white quiet zone, above everything else, for a few seconds.
enum Marker {
  final class View: NSView {
    let modules: Int
    let bits: [Bool]
    let sizePt: CGFloat
    init(frame: NSRect, modules: Int, bits: [Bool], sizePt: CGFloat) {
      self.modules = modules
      self.bits = bits
      self.sizePt = sizePt
      super.init(frame: frame)
    }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ dirtyRect: NSRect) {
      NSColor.white.setFill()
      bounds.fill()
      let m = sizePt / CGFloat(modules)
      let x0 = (bounds.width - sizePt) / 2
      let y0 = (bounds.height - sizePt) / 2
      NSColor.black.setFill()
      for r in 0..<modules {
        for c in 0..<modules where bits[r * modules + c] {
          // AppKit's origin is bottom-left: row 0 is the top row of the code.
          NSRect(x: x0 + CGFloat(c) * m, y: y0 + CGFloat(modules - 1 - r) * m, width: m, height: m).fill()
        }
      }
    }
  }

  static func run(modules: Int, bits: String, sizePt: Double, seconds: Double) {
    let b = bits.map { $0 == "1" }
    guard b.count == modules * modules, let screen = NSScreen.main else {
      FileHandle.standardError.write("bad marker bits\n".data(using: .utf8)!)
      exit(2)
    }
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let w = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false, screen: screen)
    w.level = .screenSaver
    w.isOpaque = true
    w.ignoresMouseEvents = true
    w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    w.contentView = View(frame: NSRect(origin: .zero, size: screen.frame.size), modules: modules, bits: b, sizePt: CGFloat(sizePt))
    w.orderFrontRegardless()
    print("{\"shown\":true,\"centerPt\":[\(screen.frame.width / 2),\(screen.frame.height / 2)],\"sizePt\":\(sizePt)}")
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { exit(0) }
    app.run()
  }
}
