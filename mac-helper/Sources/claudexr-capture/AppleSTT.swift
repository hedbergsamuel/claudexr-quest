import Foundation
import Speech

/// On-device speech recognition with Apple's Speech framework (never uses the network:
/// requiresOnDeviceRecognition = true). Prints {"text":..,"lang":..}. UNTESTED.
enum AppleSTT {
  static func run(file: String, lang: String) {
    let url = URL(fileURLWithPath: file)
    let locales = lang == "auto" ? ["sv-SE", "en-US"] : [lang]
    SFSpeechRecognizer.requestAuthorization { status in
      guard status == .authorized else {
        print("{\"error\":\"speech_permission_denied\"}")
        exit(3)
      }
      var best: (text: String, lang: String, conf: Float) = ("", locales[0], -1)
      let group = DispatchGroup()
      // Review 2 R2-07: callbacks of the recognizers run concurrently, and a task may report a final
      // result AND an error: guard `best` and leave the group exactly once per task.
      let lock = NSLock()
      for loc in locales {
        guard let r = SFSpeechRecognizer(locale: Locale(identifier: loc)), r.supportsOnDeviceRecognition else { continue }
        let req = SFSpeechURLRecognitionRequest(url: url)
        req.requiresOnDeviceRecognition = true
        req.shouldReportPartialResults = false
        group.enter()
        var left = false
        let leaveOnce = {
          lock.lock(); defer { lock.unlock() }
          if !left { left = true; group.leave() }
        }
        r.recognitionTask(with: req) { result, error in
          if let result, result.isFinal {
            let segs = result.bestTranscription.segments
            let conf = segs.isEmpty ? 0 : segs.map(\.confidence).reduce(0, +) / Float(segs.count)
            lock.lock()
            if conf > best.conf { best = (result.bestTranscription.formattedString, loc, conf) }
            lock.unlock()
            leaveOnce()
          } else if error != nil {
            leaveOnce()
          }
        }
      }
      group.notify(queue: .main) {
        let d = try! JSONSerialization.data(withJSONObject: ["text": best.text, "lang": String(best.lang.prefix(2))])
        print(String(data: d, encoding: .utf8)!)
        exit(0)
      }
    }
    RunLoop.main.run()
  }
}
