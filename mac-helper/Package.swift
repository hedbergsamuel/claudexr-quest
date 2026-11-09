// swift-tools-version:5.9
// ClaudeXR Mac helper: screen/window capture (ScreenCaptureKit + VideoToolbox H.264), display geometry,
// calibration marker, and on-device speech recognition (Speech framework). Build on the Mac:
//   swift build -c release      ->  .build/release/claudexr-capture
import PackageDescription

let package = Package(
  name: "claudexr-capture",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(
      name: "claudexr-capture",
      path: "Sources/claudexr-capture",
      exclude: ["Info.plist"],
      linkerSettings: [
        // Embed an Info.plist so macOS can show proper permission prompts for this CLI tool.
        .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Sources/claudexr-capture/Info.plist"]),
      ]
    ),
  ]
)
