import Foundation
import CryptoKit

/// Research-only native D-FINE session bootstrap.
///
/// This proves model integrity, CocoaPods linkage, CoreML provider registration,
/// session caching, and the model I/O contract. It intentionally does not
/// submit camera frames or alter the production scanner path.
final class DfineNativeRuntime {
  static let shared = DfineNativeRuntime()

  private let queue = DispatchQueue(label: "com.harmony.discover.dfine-runtime", qos: .userInitiated)
  private let expectedSHA256 = "999b6ae8970461b9a2b4a50f6cf07df3f355b131698a3e5b56cd420fbea5de30"

  private init() {}

  func initialize(modelPath: String, cacheDirectory: String) throws -> [String: Any] {
    try queue.sync {
      let modelURL = URL(fileURLWithPath: modelPath).standardizedFileURL
      guard modelURL.isFileURL, FileManager.default.fileExists(atPath: modelURL.path) else {
        throw NSError(domain: "DfineNativeRuntime", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "D-FINE model file does not exist at the supplied path."
        ])
      }

      let modelData = try Data(contentsOf: modelURL, options: .mappedIfSafe)
      let digest = SHA256.hash(data: modelData).map { String(format: "%02x", $0) }.joined()
      guard digest == expectedSHA256 else {
        throw NSError(domain: "DfineNativeRuntime", code: 2, userInfo: [
          NSLocalizedDescriptionKey: "D-FINE model SHA-256 does not match the pinned research model."
        ])
      }

      let cacheURL = URL(fileURLWithPath: cacheDirectory, isDirectory: true).standardizedFileURL
      try FileManager.default.createDirectory(
        at: cacheURL,
        withIntermediateDirectories: true
      )

      var result = try DfineOrtSessionProbe.initializeModel(
        atPath: modelURL.path,
        cacheDirectory: cacheURL.path
      )
      result["sha256"] = digest
      result["runtimeVersion"] = "1.32.0"
      return result
    }
  }
}
