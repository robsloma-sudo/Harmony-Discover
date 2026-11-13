import Foundation
import CryptoKit
import ONNXRuntime

/// Research-only native D-FINE session bootstrap.
///
/// This deliberately does not run inference on camera frames yet. It proves
/// CocoaPods linkage, CoreML provider registration, model integrity, and the
/// exact model input/output contract before camera integration is attempted.
final class DfineNativeRuntime {
  static let shared = DfineNativeRuntime()

  private let queue = DispatchQueue(label: "com.harmony.discover.dfine-runtime", qos: .userInitiated)
  private var environment: ORTEnv?
  private var session: ORTSession?
  private var loadedModelPath: String?

  private let expectedSHA256 = "999b6ae8970461b9a2b4a50f6cf07df3f355b131698a3e5b56cd420fbea5de30"
  private let expectedOutputs: Set<String> = ["labels", "boxes", "scores", "masks"]

  private init() {}

  func initialize(modelPath: String, cacheDirectory: String) throws -> [String: Any] {
    try queue.sync {
      let modelURL = URL(fileURLWithPath: modelPath).standardizedFileURL
      guard modelURL.isFileURL, FileManager.default.fileExists(atPath: modelURL.path) else {
        throw NSError(domain: "DfineNativeRuntime", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "D-FINE model file does not exist at the supplied path."
        ])
      }

      if let session, loadedModelPath == modelURL.path {
        return try diagnostics(for: session, cached: true)
      }

      let modelData = try Data(contentsOf: modelURL, options: .mappedIfSafe)
      let digest = SHA256.hash(data: modelData).map { String(format: "%02x", $0) }.joined()
      guard digest == expectedSHA256 else {
        throw NSError(domain: "DfineNativeRuntime", code: 2, userInfo: [
          NSLocalizedDescriptionKey: "D-FINE model SHA-256 does not match the pinned research model."
        ])
      }

      try FileManager.default.createDirectory(
        at: URL(fileURLWithPath: cacheDirectory, isDirectory: true),
        withIntermediateDirectories: true
      )

      let env = try ORTEnv(loggingLevel: .warning)
      let options = try ORTSessionOptions()
      try options.setGraphOptimizationLevel(.all)

      // Register CoreML first; ONNX Runtime retains its CPU provider as fallback.
      // ModelCacheDirectory avoids recompiling the captured CoreML subgraphs on
      // every cold app launch. The session itself is retained and reused.
      try options.appendExecutionProvider("CoreML", providerOptions: [
        "ModelFormat": "MLProgram",
        "MLComputeUnits": "ALL",
        "RequireStaticInputShapes": "1",
        "EnableOnSubgraphs": "0",
        "ModelCacheDirectory": cacheDirectory
      ])

      let loaded = try ORTSession(env: env, modelPath: modelURL.path, sessionOptions: options)
      let inputNames = try loaded.inputNames()
      let outputNames = try loaded.outputNames()
      guard inputNames == ["input"], Set(outputNames) == expectedOutputs else {
        throw NSError(domain: "DfineNativeRuntime", code: 3, userInfo: [
          NSLocalizedDescriptionKey: "D-FINE input/output names do not match the pinned graph contract.",
          "inputNames": inputNames,
          "outputNames": outputNames
        ])
      }

      self.environment = env
      self.session = loaded
      self.loadedModelPath = modelURL.path

      var result = try diagnostics(for: loaded, cached: false)
      result["sha256"] = digest
      result["providerOrder"] = ["CoreML", "CPU fallback"]
      result["modelCacheDirectory"] = cacheDirectory
      return result
    }
  }

  private func diagnostics(for session: ORTSession, cached: Bool) throws -> [String: Any] {
    [
      "ready": true,
      "cachedSession": cached,
      "inputNames": try session.inputNames(),
      "outputNames": try session.outputNames(),
      "inputShape": [1, 3, 640, 640],
      "inputType": "float32",
      "outputsValidated": true,
      "inferenceEnabled": false,
      "note": "Session initialization proof only; no camera frames are submitted."
    ]
  }
}
