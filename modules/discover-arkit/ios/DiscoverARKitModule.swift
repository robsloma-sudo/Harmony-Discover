import ExpoModulesCore
import ARKit
import SceneKit
import Vision
import CoreImage
import UIKit
import CoreVideo
import ImageIO

private struct SendablePixelBuffer: @unchecked Sendable {
  let value: CVPixelBuffer
}

public class DiscoverARKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DiscoverARKit")

    AsyncFunction("getCapabilities") { () -> [String: Any] in
      let worldTracking = ARWorldTrackingConfiguration.isSupported
      var sceneDepth = false
      var smoothedSceneDepth = false
      var meshReconstruction = false

      if #available(iOS 14.0, *) {
        sceneDepth = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        smoothedSceneDepth = ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth)
      }
      if #available(iOS 13.4, *) {
        meshReconstruction = ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
      }

      let device = UIDevice.current
      return [
        "platform": "ios",
        "systemVersion": device.systemVersion,
        "model": device.model,
        "machineIdentifier": Self.machineIdentifier(),
        "worldTrackingSupported": worldTracking,
        "sceneDepthSupported": sceneDepth,
        "smoothedSceneDepthSupported": smoothedSceneDepth,
        "meshReconstructionSupported": meshReconstruction,
        "trackingState": "not_started",
        "liDARAssumed": false
      ]
    }

    AsyncFunction("analyzeLiquidLevels") { (imageBase64: String, boxes: [[String: Double]], promise: Promise) in
      DispatchQueue.global(qos: .utility).async {
        promise.resolve(Self.analyzeLiquidLevels(imageBase64, boxes: boxes))
      }
    }

    View(DiscoverARView.self) {
      Events("onTrackingUpdate", "onARReady", "onARError", "onVisualCandidates", "onRecognitionUpdate", "onDepthEstimate", "onCameraPose", "onDepthStatus", "onCapturedImage", "onFrame")
      Prop("active") { (view: DiscoverARView, active: Bool) in
        view.setActive(active)
      }
      Prop("recognitionEnabled") { (view: DiscoverARView, enabled: Bool) in
        view.setRecognitionEnabled(enabled)
      }
      Prop("captureRequestId") { (view: DiscoverARView, requestId: Int) in
        view.captureFrame(requestId)
      }
      Prop("trackingSeeds") { (view: DiscoverARView, seeds: [[String: Any]]) in
        view.setTrackingSeeds(seeds)
      }
      AsyncFunction("pause") { (view: DiscoverARView) in
        view.setActive(false)
      }
      AsyncFunction("resume") { (view: DiscoverARView) in
        view.setActive(true)
      }
    }
  }


  /// Decodes a camera JPEG and measures liquid-interface candidates off the
  /// main thread. Boxes are normalized top-left image coordinates. This
  /// method is intentionally local-only and returns no image or label data.
  private static func analyzeLiquidLevels(_ imageBase64: String, boxes: [[String: Double]]) -> [[String: Any]] {
    let startedAt = CFAbsoluteTimeGetCurrent()
    guard let data = Data(base64Encoded: imageBase64),
          let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return [] }
    let width = image.width
    let height = image.height
    guard width >= 32, height >= 32 else { return [] }
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let rendered = pixels.withUnsafeMutableBytes { raw -> Bool in
      guard let base = raw.baseAddress,
            let context = CGContext(data: base, width: width, height: height, bitsPerComponent: 8,
              bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
      context.interpolationQuality = .low
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard rendered else { return [] }

    func luma(_ x: Int, _ y: Int) -> Double {
      let px = min(width - 1, max(0, x))
      let py = min(height - 1, max(0, y))
      let offset = (py * width + px) * 4
      return 0.2126 * Double(pixels[offset]) + 0.7152 * Double(pixels[offset + 1]) + 0.0722 * Double(pixels[offset + 2])
    }
    func mean(_ x: Int, _ start: Int, _ end: Int) -> Double {
      if end < start { return luma(x, start) }
      var sum = 0.0
      var count = 0
      for y in start...end { sum += luma(x, y); count += 1 }
      return count > 0 ? sum / Double(count) : 0
    }
    func median(_ values: [Double]) -> Double {
      let sorted = values.sorted()
      guard !sorted.isEmpty else { return 0 }
      return sorted[sorted.count / 2]
    }

    var output: [[String: Any]] = []
    for box in boxes {
      guard let trackValue = box["trackId"], let xValue = box["x"], let yValue = box["y"],
            let widthValue = box["width"], let heightValue = box["height"],
            trackValue.isFinite, xValue.isFinite, yValue.isFinite, widthValue.isFinite, heightValue.isFinite,
            widthValue > 0, heightValue > 0 else { continue }
      let left = max(0, Int(floor(xValue * Double(width))))
      let right = min(width, Int(ceil((xValue + widthValue) * Double(width))))
      let top = max(0, Int(floor(yValue * Double(height))))
      let bottom = min(height, Int(ceil((yValue + heightValue) * Double(height))))
      let cropWidth = right - left
      let cropHeight = bottom - top
      guard cropWidth >= 24, cropHeight >= 48 else { continue }

      // Fast optical observability gate: do not report fill for severe glare,
      // near-black/opaque crops, or effectively flat imagery.
      var optical: [Double] = []
      var clipped = 0
      var deepShadows = 0
      var opticalSum = 0.0
      var opticalSumSquares = 0.0
      for row in 0..<13 {
        let y = min(bottom - 1, top + Int((Double(row) + 0.5) / 13.0 * Double(cropHeight)))
        for column in 0..<7 {
          let x = min(right - 1, left + Int((0.18 + Double(column) * 0.64 / 6.0) * Double(cropWidth)))
          let value = luma(x, y)
          optical.append(value)
          opticalSum += value
          opticalSumSquares += value * value
          if value <= 12 { deepShadows += 1 }
          let offset = (y * width + x) * 4
          if min(pixels[offset], min(pixels[offset + 1], pixels[offset + 2])) >= 248 { clipped += 1 }
        }
      }
      guard optical.count >= 40 else { continue }
      let range = (optical.max() ?? 0) - (optical.min() ?? 0)
      let average = opticalSum / Double(optical.count)
      let variance = max(0, opticalSumSquares / Double(optical.count) - average * average)
      let clippedFraction = Double(clipped) / Double(optical.count)
      let deepShadowFraction = Double(deepShadows) / Double(optical.count)
      guard clippedFraction < 0.42, deepShadowFraction < 0.82,
            average > 9, range >= 5, sqrt(variance) >= 2.5 else { continue }
      let opticalScore = max(0, min(1,
        (1 - clippedFraction * 1.8) *
        (1 - deepShadowFraction * 0.8) *
        (0.55 + min(1, range / 55.0) * 0.45)
      ))
      guard opticalScore >= 0.55 else { continue }

      let columnFractions: [Double] = [0.18, 0.29, 0.40, 0.50, 0.60, 0.71, 0.82]
      var columns: [Int] = []
      columns.reserveCapacity(columnFractions.count)
      for fraction in columnFractions {
        let offset = Int(fraction * Double(cropWidth - 1))
        columns.append(left + offset)
      }
      let firstY = top + max(4, Int(Double(cropHeight) * 0.08))
      let lastY = bottom - max(4, Int(Double(cropHeight) * 0.04))
      guard lastY > firstY else { continue }

      // Printed label bands have sustained high cross-column texture. Mask
      // those rows. Hand/glass occlusion that is not separable is rejected by
      // the multi-column support and temporal-consensus gates.
      var occludedRows = Set<Int>()
      let occlusionStartY = top + Int(Double(cropHeight) * 0.06)
      let occlusionEndY = bottom - Int(Double(cropHeight) * 0.06)
      var occlusionY = occlusionStartY
      while occlusionY < occlusionEndY {
        var samples: [Double] = []
        samples.reserveCapacity(9)
        for sampleIndex in 0..<9 {
          let sampleFraction = 0.18 + (Double(sampleIndex) * 0.64 / 8.0)
          let sampleX = left + Int(sampleFraction * Double(cropWidth - 1))
          samples.append(luma(sampleX, occlusionY))
        }
        var sampleSum = 0.0
        for sample in samples {
          sampleSum += sample
        }
        let sampleCount = Double(samples.count)
        let sampleAverage = sampleSum / sampleCount
        var squaredDeviationSum = 0.0
        for sample in samples {
          let deviation = sample - sampleAverage
          squaredDeviationSum += deviation * deviation
        }
        let variance = squaredDeviationSum / sampleCount
        if sqrt(variance) >= 34 {
          occludedRows.insert(occlusionY)
          occludedRows.insert(min(bottom - 1, occlusionY + 1))
        }
        occlusionY += 2
      }

      var bestY = -1
      var bestContrast = 0.0
      var bestSupport = 0.0
      for y in firstY...lastY where !occludedRows.contains(y) {
        var deltas: [Double] = []
        deltas.reserveCapacity(columns.count)
        for column in columns {
          let aboveMean = mean(column, y - 3, y - 1)
          let belowMean = mean(column, y + 1, y + 3)
          let delta = abs(aboveMean - belowMean)
          deltas.append(delta)
        }
        let supported = deltas.reduce(0) { count, delta in count + (delta >= 18 ? 1 : 0) }
        let support = Double(supported) / Double(columns.count)
        let contrast = median(deltas)
        if support >= 0.71 && contrast * support > bestContrast * bestSupport {
          bestY = y
          bestContrast = contrast
          bestSupport = support
        }
      }
      guard bestY >= 0, bestContrast >= 18, bestSupport >= 0.71 else { continue }

      let radius = max(4, Int(Double(cropHeight) * 0.12))
      var columnSamples: [(x: Int, y: Int)] = []
      for x in columns {
        var strongestY = -1
        var strongestContrast = 0.0
        for y in max(firstY, bestY - radius)...min(lastY, bestY + radius) where !occludedRows.contains(y) {
          let contrast = abs(mean(x, y - 3, y - 1) - mean(x, y + 1, y + 3))
          if contrast > strongestContrast { strongestContrast = contrast; strongestY = y }
        }
        if strongestY >= 0 && strongestContrast >= 18 { columnSamples.append((x, strongestY)) }
      }
      guard columnSamples.count >= 4 else { continue }
      let heights = columnSamples.map { $0.y }.sorted()
      let medianY = heights[heights.count / 2]
      let spread = Double(heights.last! - heights.first!) / Double(cropHeight)
      let spatial = columnSamples.sorted { $0.x < $1.x }
      let center = spatial.count >= 5 ? spatial.dropFirst(2).dropLast(2).map { Double($0.y) } : heights.map(Double.init)
      let edges = spatial.count >= 5
        ? [Double(spatial[0].y), Double(spatial[1].y), Double(spatial[spatial.count - 2].y), Double(spatial[spatial.count - 1].y)]
        : heights.map(Double.init)
      let centerMean = center.reduce(0, +) / Double(max(1, center.count))
      let edgeMean = edges.reduce(0, +) / Double(max(1, edges.count))
      let curvature = (centerMean - edgeMean) / Double(cropHeight)
      let shape = spread <= 0.025 ? "flat" : (spread <= 0.14 && abs(curvature) >= 0.008 ? "curved" : "irregular")
      guard shape != "irregular" else { continue }
      let confidence = min(1, max(0, (bestContrast / 45.0) * bestSupport))
      output.append([
        "trackId": Int(trackValue),
        "normalizedHeight": min(1, max(0, Double(bottom - medianY) / Double(cropHeight))),
        "confidence": confidence,
        "boundaryShape": shape,
        "opticalScore": opticalScore,
        "processingMs": 0
      ])
    }
    let elapsedMs = (CFAbsoluteTimeGetCurrent() - startedAt) * 1000
    return output.map { item in
      var value = item
      value["processingMs"] = elapsedMs
      return value
    }
  }

  private static func machineIdentifier() -> String {
    var systemInfo = utsname()
    uname(&systemInfo)
    return withUnsafePointer(to: &systemInfo.machine) {
      $0.withMemoryRebound(to: CChar.self, capacity: 1) {
        String(validatingUTF8: $0) ?? "unknown"
      }
    }
  }
}

/// Camera + world-tracking diagnostic surface. It intentionally does not claim
/// bottle detection or draw fabricated object contours. Those require a
/// separately validated vision/geometry pipeline.
public final class DiscoverARView: ExpoView, ARSessionDelegate {
  private var isActive = false
  private var shouldBeActive = false
  private var isRecognitionEnabled = false
  private var recognitionGeneration = 0
  private var lastTrackingState = ""

  let onTrackingUpdate = EventDispatcher()
  let onARReady = EventDispatcher()
  let onARError = EventDispatcher()
  let onVisualCandidates = EventDispatcher()
  let onRecognitionUpdate = EventDispatcher()
  let onDepthEstimate = EventDispatcher()
  let onCameraPose = EventDispatcher()
  let onDepthStatus = EventDispatcher()
  let onCapturedImage = EventDispatcher()
  let onFrame = EventDispatcher()
  private var lastCaptureRequestId = 0
  private var pendingCaptureRequestId: Int?
  private var lastCloudFrameTime: TimeInterval = 0
  private let visionQueue = DispatchQueue(label: "com.harmony.discover.vision", qos: .userInitiated)
  private let visionFrameGate = DispatchSemaphore(value: 1)
  private let localTrackingFrameGate = DispatchSemaphore(value: 1)
  private var lastVisionFrameTime: TimeInterval = 0
  private var lastDepthFrameTime: TimeInterval = 0
  private var lastCameraPoseTime: TimeInterval = 0
  private var nextCandidateTrackID = 1
  private var previousCandidates: [(id: Int, rect: CGRect, confidence: CGFloat)] = []
  private struct RetainedTrackingFrame {
    let pixelBuffer: SendablePixelBuffer
    let orientation: CGImagePropertyOrientation
    let generation: Int
  }
  // Accessed only on visionQueue; capped to four source frames.
  private var retainedTrackingFrames: [TimeInterval: RetainedTrackingFrame] = [:]
  private var activeTrackingRequests: [Int: VNTrackObjectRequest] = [:]
  private var localTrackingSequenceHandler = VNSequenceRequestHandler()
  private var trackingMisses: [Int: Int] = [:]
  private var lastLocalTrackingFrameTime: TimeInterval = 0
  private let rectangleOverlay = CAShapeLayer()

  private lazy var sceneView: ARSCNView = {
    let view = ARSCNView(frame: .zero)
    view.automaticallyUpdatesLighting = true
    view.delegate = self
    view.session.delegate = self
    view.backgroundColor = .black
    addSubview(view)
    // Generic rectangle proposals are not bottle detections. Do not draw them
    // as object contours until a bottle-instance segmentation model is active.
    return view
  }()

  public override func layoutSubviews() {
    super.layoutSubviews()
    sceneView.frame = bounds
    rectangleOverlay.frame = sceneView.bounds
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      stopSession(reason: "view_detached")
    } else if shouldBeActive {
      startSession()
    }
  }

  func setRecognitionEnabled(_ enabled: Bool) {
    guard enabled != isRecognitionEnabled else { return }
    isRecognitionEnabled = enabled
    recognitionGeneration += 1
    lastVisionFrameTime = 0
    lastCloudFrameTime = 0
    lastDepthFrameTime = 0
    if !enabled {
      previousCandidates.removeAll()
      lastLocalTrackingFrameTime = 0
      visionQueue.async { [weak self] in self?.clearLocalTrackingState() }
      onVisualCandidates(["count": 0, "candidates": []])
    }
  }

  func setActive(_ active: Bool) {
    shouldBeActive = active
    if active {
      startSession()
    } else {
      stopSession(reason: "view_inactive")
    }
  }

  private func stopSession(reason: String) {
    guard isActive else { return }
    isActive = false
    recognitionGeneration += 1
    visionQueue.async { [weak self] in self?.clearLocalTrackingState() }
    rectangleOverlay.path = nil
    previousCandidates.removeAll()
    sceneView.session.pause()
    lastTrackingState = "paused"
    onVisualCandidates(["count": 0, "candidates": []])
    onTrackingUpdate(["state": "paused", "reason": reason])
  }

  private func startSession() {
    guard !isActive, window != nil, shouldBeActive else { return }
    guard ARWorldTrackingConfiguration.isSupported else {
      onARError(["message": "ARKit world tracking is not supported on this device."])
      return
    }
    isActive = true
    sceneView.session.run(Self.makeConfiguration(), options: [.resetTracking, .removeExistingAnchors])
    onARReady(["state": "starting"])
  }

  /// Captures the current ARKit camera image from the same session used for tracking.
  func captureFrame(_ requestId: Int) {
    guard requestId > 0, requestId != lastCaptureRequestId else { return }
    guard isActive else {
      onARError(["message": "The shared AR camera is paused."])
      return
    }
    guard let frame = sceneView.session.currentFrame else {
      // ARKit can mount before its first camera frame. Keep the shutter request
      // pending and fulfill it from the first session update instead of failing.
      pendingCaptureRequestId = requestId
      return
    }
    lastCaptureRequestId = requestId
    pendingCaptureRequestId = nil
    let pixelBufferBox = SendablePixelBuffer(value: frame.capturedImage)
    let timestamp = frame.timestamp
    let orientation = Self.imageOrientation(for: sceneView.window?.windowScene?.interfaceOrientation ?? .portrait)
    visionQueue.async { [weak self, pixelBufferBox] in
      let pixelBuffer = pixelBufferBox.value
      let image = CIImage(cvPixelBuffer: pixelBuffer).oriented(orientation)
      let context = CIContext()
      guard let cgImage = context.createCGImage(image, from: image.extent),
            let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.88) else {
        DispatchQueue.main.async { [weak self] in
          self?.onARError(["message": "Could not encode the current AR camera frame."])
        }
        return
      }
      let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("discover-camera-\(UUID().uuidString).jpg")
      do {
        try jpeg.write(to: url, options: .atomic)
        DispatchQueue.main.async { [weak self] in
          guard let self else { return }
          self.onCapturedImage([
            "uri": url.absoluteString,
            "width": cgImage.width,
            "height": cgImage.height,
            "timestamp": timestamp
          ])
        }
      } catch {
        DispatchQueue.main.async { [weak self] in
          self?.onARError(["message": "Could not save the captured camera frame: \(error.localizedDescription)"])
        }
      }
    }
  }

  public func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard isActive else { return }
    if let pendingRequest = pendingCaptureRequestId {
      captureFrame(pendingRequest)
    }
    let now = frame.timestamp
    if isRecognitionEnabled && now - lastLocalTrackingFrameTime >= 0.10 {
      lastLocalTrackingFrameTime = now
      if localTrackingFrameGate.wait(timeout: .now()) == .success {
        processLocalTrackingFrame(frame, generation: recognitionGeneration)
      }
    }
    // Camera pose is lightweight and independent of depth sampling / cloud recognition.
    // 30 Hz keeps world-anchored boxes attached during normal hand movement.
    if now - lastCameraPoseTime >= (1.0 / 30.0) {
      lastCameraPoseTime = now
      emitCameraPose(frame)
    }
    if now - lastDepthFrameTime >= 0.50 {
      lastDepthFrameTime = now
      _ = emitDepthFrame(frame)
    }
    guard isRecognitionEnabled else { return }
    // Run local OCR/barcode/classification at 2 Hz; cloud bottle identification remains paced at 2.5 seconds.
    guard now - lastVisionFrameTime >= 0.50 else { return }
    lastVisionFrameTime = now
    let shouldSendCloudFrame = now - lastCloudFrameTime >= 2.5
    if shouldSendCloudFrame { lastCloudFrameTime = now }
    let generation = recognitionGeneration
    // Pair metric depth with this exact ARFrame; periodic depth events are not precise enough.
    let synchronizedDepth = shouldSendCloudFrame ? emitDepthFrame(frame) : nil
    let pixelBufferBox = SendablePixelBuffer(value: frame.capturedImage)
    let pixelBuffer = pixelBufferBox.value
    guard visionFrameGate.wait(timeout: .now()) == .success else { return }
    let rawWidth = CVPixelBufferGetWidth(pixelBuffer)
    let rawHeight = CVPixelBufferGetHeight(pixelBuffer)
    let orientation = Self.imageOrientation(for: sceneView.window?.windowScene?.interfaceOrientation ?? .portrait)
    let swapsDimensions = orientation == .right || orientation == .left
    let imageWidth = swapsDimensions ? rawHeight : rawWidth
    let imageHeight = swapsDimensions ? rawWidth : rawHeight

    visionQueue.async { [weak self, pixelBufferBox, synchronizedDepth] in
      defer { self?.visionFrameGate.signal() }
      guard let self else { return }
      let pixelBuffer = pixelBufferBox.value
      let textRequest = VNRecognizeTextRequest()
      textRequest.recognitionLevel = .fast
      textRequest.usesLanguageCorrection = false
      textRequest.minimumTextHeight = 0.012

      let barcodeRequest = VNDetectBarcodesRequest()
      barcodeRequest.symbologies = [.ean13, .ean8, .upce, .code128, .code39, .qr]

      let classifyRequest = VNClassifyImageRequest()
      var cloudFrameBase64: String? = nil
      if shouldSendCloudFrame {
        CVPixelBufferRetain(pixelBuffer)
        retainedTrackingFrames[now] = RetainedTrackingFrame(
          pixelBuffer: pixelBufferBox, orientation: orientation, generation: generation
        )
        for key in retainedTrackingFrames.keys.sorted().dropLast(4) {
          if let old = retainedTrackingFrames.removeValue(forKey: key) {
            CVPixelBufferRelease(old.pixelBuffer.value)
          }
        }
        let image = CIImage(cvPixelBuffer: pixelBuffer).oriented(orientation)
        let scale = min(1.0, 960.0 / max(image.extent.width, image.extent.height))
        let resized = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let context = CIContext()
        if let cgImage = context.createCGImage(resized, from: resized.extent),
           let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.62) {
          cloudFrameBase64 = jpeg.base64EncodedString()
        }
      }
      if let cloudFrameBase64 {
        DispatchQueue.main.async { [weak self] in
          guard let self, self.isActive, self.isRecognitionEnabled, self.recognitionGeneration == generation else { return }
          var event: [String: Any] = ["imageBase64": cloudFrameBase64, "timestamp": now]
          if let synchronizedDepth { event["depthEstimate"] = synchronizedDepth }
          self.onFrame(event)
        }
      }
      do {
        try VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation)
          .perform([textRequest, barcodeRequest, classifyRequest])

        // Vision uses a bottom-left normalized origin. Convert to top-left
        // coordinates matching the bottle reader and overlay coordinate contract.
        func topLeftBox(_ rect: CGRect) -> [String: Double] {
          ["x0": Double(rect.minX), "y0": Double(1 - rect.maxY),
           "x1": Double(rect.maxX), "y1": Double(1 - rect.minY)]
        }

        let textItems: [[String: Any]] = (textRequest.results ?? []).compactMap { observation -> [String: Any]? in
          guard let candidate = observation.topCandidates(1).first, candidate.confidence >= 0.25 else { return nil }
          let value = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
          guard !value.isEmpty else { return nil }
          return ["text": value, "confidence": Double(candidate.confidence),
                  "box": topLeftBox(observation.boundingBox)]
        }.prefix(18).map { $0 }
        let recognizedText = textItems.compactMap { $0["text"] as? String }

        let barcodeItems: [[String: Any]] = (barcodeRequest.results ?? []).compactMap { observation -> [String: Any]? in
          guard let value = observation.payloadStringValue, !value.isEmpty else { return nil }
          return ["value": value, "symbology": observation.symbology.rawValue,
                  "box": topLeftBox(observation.boundingBox)]
        }.prefix(8).map { $0 }
        // Keep the legacy barcode payload shape intact for existing listeners.
        let barcodes = barcodeItems.map { item -> [String: String] in
          ["value": item["value"] as? String ?? "",
           "symbology": item["symbology"] as? String ?? ""]
        }

        let classifications = (classifyRequest.results ?? []).prefix(6).map { item in
          ["identifier": item.identifier, "confidence": String(format: "%.3f", item.confidence)]
        }

        DispatchQueue.main.async { [weak self] in
          guard let self, self.isActive, self.isRecognitionEnabled, self.recognitionGeneration == generation else { return }
          self.onRecognitionUpdate([
            "text": Array(recognizedText),
            "barcodes": Array(barcodes),
            "textItems": textItems,
            "barcodeItems": barcodeItems,
            "imageWidth": imageWidth,
            "imageHeight": imageHeight,
            "classifications": classifications,
            "frameTimestamp": now
          ])
        }
      } catch {
        DispatchQueue.main.async { [weak self] in
          self?.onARError(["message": "Live visual analysis failed: \(error.localizedDescription)"])
        }
      }
    }
  }

  /// Emits only the camera pose and projection intrinsics for smooth world-anchor reprojection.
  /// This avoids shipping depth arrays on every camera frame.
  private func emitCameraPose(_ frame: ARFrame) {
    let orientation = Self.imageOrientation(for: sceneView.window?.windowScene?.interfaceOrientation ?? .portrait)
    let rawWidth = Double(CVPixelBufferGetWidth(frame.capturedImage))
    let rawHeight = Double(CVPixelBufferGetHeight(frame.capturedImage))
    let rotates = orientation == .right || orientation == .left
    let width = rotates ? rawHeight : rawWidth
    let height = rotates ? rawWidth : rawHeight
    let rawK = frame.camera.intrinsics
    let fx = Double(rawK[0, 0]), fy = Double(rawK[1, 1])
    let cx = Double(rawK[2, 0]), cy = Double(rawK[2, 1])
    let fxOriented: Double, fyOriented: Double, cxOriented: Double, cyOriented: Double
    switch orientation {
    case .right:
      fxOriented = fy; fyOriented = fx
      cxOriented = rawHeight - cy; cyOriented = cx
    case .left:
      fxOriented = fy; fyOriented = fx
      cxOriented = cy; cyOriented = rawWidth - cx
    case .down:
      fxOriented = fx; fyOriented = fy
      cxOriented = rawWidth - cx; cyOriented = rawHeight - cy
    default:
      fxOriented = fx; fyOriented = fy
      cxOriented = cx; cyOriented = cy
    }
    let intrinsics = [
      fxOriented, 0, cxOriented,
      0, fyOriented, cyOriented,
      0, 0, 1
    ]
    let transform = frame.camera.transform
    let transformValues = (0..<4).flatMap { column in (0..<4).map { row in Double(transform[column, row]) } }
    let payload: [String: Any] = [
      "width": width, "height": height,
      "cameraIntrinsics": intrinsics,
      "cameraTransform": transformValues,
      "timestamp": frame.timestamp,
      "imageOrientation": orientation.rawValue
    ]
    DispatchQueue.main.async { [weak self] in
      guard let self, self.isActive else { return }
      self.onCameraPose(payload)
    }
  }

  /// Emits sampled metric depth. Zero represents an invalid sample.
  private func emitDepthFrame(_ frame: ARFrame) -> [String: Any]? {
    guard #available(iOS 14.0, *) else { onDepthStatus(["status": "ios_depth_api_unavailable"]); return nil }
    guard let depthData = frame.smoothedSceneDepth ?? frame.sceneDepth else { onDepthStatus(["status": "waiting_for_lidar_depth"]); return nil }
    let depthMap = depthData.depthMap
    guard let confidenceMap = depthData.confidenceMap else {
      onDepthStatus(["status": "depth_pixel_buffer_unavailable"])
      return nil
    }
    let rawWidth = CVPixelBufferGetWidth(depthMap)
    let rawHeight = CVPixelBufferGetHeight(depthMap)
    guard rawWidth > 0, rawHeight > 0 else { return nil }
    let orientation = Self.imageOrientation(for: sceneView.window?.windowScene?.interfaceOrientation ?? .portrait)
    let rotates = orientation == .right || orientation == .left
    // Rotate the depth/confidence grids into the same upright image orientation
    // used by the bottle-read JPEG before projecting image-space boxes.
    let sourceWidth = rotates ? rawHeight : rawWidth
    let sourceHeight = rotates ? rawWidth : rawHeight
    let outputWidth = 64
    let outputHeight = max(1, Int((Double(sourceHeight) / Double(sourceWidth) * Double(outputWidth)).rounded()))
    CVPixelBufferLockBaseAddress(depthMap, .readOnly)
    CVPixelBufferLockBaseAddress(confidenceMap, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(confidenceMap, .readOnly); CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }
    guard let depthBase = CVPixelBufferGetBaseAddress(depthMap), let confidenceBase = CVPixelBufferGetBaseAddress(confidenceMap) else { return nil }
    let depthValues = depthBase.assumingMemoryBound(to: Float32.self)
    let confidenceValues = confidenceBase.assumingMemoryBound(to: UInt8.self)
    let depthStride = CVPixelBufferGetBytesPerRow(depthMap) / MemoryLayout<Float32>.size
    let confidenceStride = CVPixelBufferGetBytesPerRow(confidenceMap)
    var meters: [Double] = []; var confidence: [Int] = []
    meters.reserveCapacity(outputWidth * outputHeight); confidence.reserveCapacity(outputWidth * outputHeight)
    for y in 0..<outputHeight {
      let orientedY = min(sourceHeight - 1, y * sourceHeight / outputHeight)
      for x in 0..<outputWidth {
        let orientedX = min(sourceWidth - 1, x * sourceWidth / outputWidth)
        let raw: (x: Int, y: Int)
        switch orientation {
        case .right: raw = (orientedY, rawHeight - 1 - orientedX)
        case .left: raw = (rawWidth - 1 - orientedY, orientedX)
        case .down: raw = (rawWidth - 1 - orientedX, rawHeight - 1 - orientedY)
        default: raw = (orientedX, orientedY)
        }
        let value = depthValues[raw.y * depthStride + raw.x]
        meters.append(value.isFinite && value > 0 ? Double(value) : 0)
        confidence.append(Int(confidenceValues[raw.y * confidenceStride + raw.x]))
      }
    }

    // ARCamera intrinsics are expressed in captured-image pixels. Scale them
    // into the depth grid, rotate them with that grid, then scale to our
    // compact output grid so normalized bottle boxes unproject correctly.
    let cameraImageWidth = Double(CVPixelBufferGetWidth(frame.capturedImage))
    let cameraImageHeight = Double(CVPixelBufferGetHeight(frame.capturedImage))
    let sx = Double(rawWidth) / max(1, cameraImageWidth)
    let sy = Double(rawHeight) / max(1, cameraImageHeight)
    let rawK = frame.camera.intrinsics
    let fxRaw = Double(rawK[0, 0]) * sx
    let fyRaw = Double(rawK[1, 1]) * sy
    let cxRaw = Double(rawK[2, 0]) * sx
    let cyRaw = Double(rawK[2, 1]) * sy
    let fxOriented: Double, fyOriented: Double, cxOriented: Double, cyOriented: Double
    switch orientation {
    case .right:
      fxOriented = fyRaw; fyOriented = fxRaw
      cxOriented = Double(rawHeight) - cyRaw; cyOriented = cxRaw
    case .left:
      fxOriented = fyRaw; fyOriented = fxRaw
      cxOriented = cyRaw; cyOriented = Double(rawWidth) - cxRaw
    case .down:
      fxOriented = fxRaw; fyOriented = fyRaw
      cxOriented = Double(rawWidth) - cxRaw; cyOriented = Double(rawHeight) - cyRaw
    default:
      fxOriented = fxRaw; fyOriented = fyRaw
      cxOriented = cxRaw; cyOriented = cyRaw
    }
    let scaleX = Double(outputWidth) / Double(sourceWidth)
    let scaleY = Double(outputHeight) / Double(sourceHeight)
    let intrinsicsValues = [
      fxOriented * scaleX, 0, cxOriented * scaleX,
      0, fyOriented * scaleY, cyOriented * scaleY,
      0, 0, 1
    ]
    let transform = frame.camera.transform
    let transformValues = (0..<4).flatMap { column in (0..<4).map { row in Double(transform[column, row]) } }
    let payload: [String: Any] = ["width": outputWidth, "height": outputHeight, "sourceWidth": sourceWidth, "sourceHeight": sourceHeight, "depthMeters": meters, "confidence": confidence, "cameraIntrinsics": intrinsicsValues, "cameraTransform": transformValues, "timestamp": frame.timestamp, "unit": "meters", "source": frame.smoothedSceneDepth == nil ? "sceneDepth" : "smoothedSceneDepth", "imageOrientation": orientation.rawValue]
    DispatchQueue.main.async { [weak self] in guard let self, self.isActive else { return }; self.onDepthEstimate(payload); self.onDepthStatus(["status": "live_metric_depth"]) }
    return payload
  }
  /// Clears retained source images and active Vision requests. Must run on visionQueue.
  private func clearLocalTrackingState() {
    for frame in retainedTrackingFrames.values {
      CVPixelBufferRelease(frame.pixelBuffer.value)
    }
    retainedTrackingFrames.removeAll()
    activeTrackingRequests.removeAll()
    localTrackingSequenceHandler = VNSequenceRequestHandler()
    trackingMisses.removeAll()
  }

  /// Seeds Vision tracking from cloud boxes on the exact ARFrame that produced them.
  func setTrackingSeeds(_ seeds: [[String: Any]]) {
    visionQueue.async { [weak self] in
      guard let self, self.isActive, self.isRecognitionEnabled else { return }
      for seed in seeds {
        guard let rawID = seed["trackId"] as? NSNumber,
              let timestamp = seed["sourceTimestamp"] as? NSNumber,
              let x = seed["x"] as? NSNumber, let y = seed["y"] as? NSNumber,
              let width = seed["width"] as? NSNumber, let height = seed["height"] as? NSNumber,
              let confidence = seed["confidence"] as? NSNumber,
              confidence.doubleValue >= 0.55 else { continue }
        let trackID = rawID.intValue
        let rect = CGRect(x: x.doubleValue, y: y.doubleValue, width: width.doubleValue, height: height.doubleValue)
        guard trackID > 0, rect.minX >= 0, rect.minY >= 0,
              rect.width > 0.02, rect.height > 0.02,
              rect.maxX <= 1.001, rect.maxY <= 1.001 else { continue }
        guard let frameKey = self.retainedTrackingFrames.keys.min(by: {
          abs($0 - timestamp.doubleValue) < abs($1 - timestamp.doubleValue)
        }), abs(frameKey - timestamp.doubleValue) <= 0.025,
          let source = self.retainedTrackingFrames[frameKey],
          source.generation == self.recognitionGeneration else { continue }

        let visionRect = CGRect(x: rect.minX, y: 1 - rect.maxY, width: rect.width, height: rect.height)
        let observation = VNDetectedObjectObservation(boundingBox: visionRect)
        let request = VNTrackObjectRequest(detectedObjectObservation: observation)
        request.trackingLevel = .accurate
        do {
          try self.localTrackingSequenceHandler.perform(
            [request], on: source.pixelBuffer.value, orientation: source.orientation
          )
          if let seeded = request.results?.first as? VNDetectedObjectObservation {
            request.inputObservation = seeded
            self.activeTrackingRequests[trackID] = request
            self.trackingMisses[trackID] = 0
          }
        } catch {
          self.activeTrackingRequests.removeValue(forKey: trackID)
          self.trackingMisses.removeValue(forKey: trackID)
        }
      }
      let newest = self.retainedTrackingFrames.keys.max() ?? 0
      let stale = self.retainedTrackingFrames.keys.filter { $0 < newest - 8.0 }
      for key in stale {
        if let old = self.retainedTrackingFrames.removeValue(forKey: key) {
          CVPixelBufferRelease(old.pixelBuffer.value)
        }
      }
    }
  }

  /// Propagates bottle boxes at up to 10 Hz between cloud recognition passes.
  private func processLocalTrackingFrame(_ frame: ARFrame, generation: Int) {
    let pixelBufferBox = SendablePixelBuffer(value: frame.capturedImage)
    let timestamp = frame.timestamp
    let orientation = Self.imageOrientation(for: sceneView.window?.windowScene?.interfaceOrientation ?? .portrait)
    visionQueue.async { [weak self, pixelBufferBox] in
      defer { self?.localTrackingFrameGate.signal() }
      guard let self, self.isActive, self.isRecognitionEnabled,
            self.recognitionGeneration == generation,
            !self.activeTrackingRequests.isEmpty else { return }
      var output: [[String: Double]] = []
      for (trackID, request) in Array(self.activeTrackingRequests) {
        do {
          try self.localTrackingSequenceHandler.perform(
            [request], on: pixelBufferBox.value, orientation: orientation
          )
          guard let observation = request.results?.first as? VNDetectedObjectObservation,
                observation.confidence >= 0.25 else {
            let misses = (self.trackingMisses[trackID] ?? 0) + 1
            self.trackingMisses[trackID] = misses
            if misses >= 6 {
              self.activeTrackingRequests.removeValue(forKey: trackID)
              self.trackingMisses.removeValue(forKey: trackID)
            }
            continue
          }
          request.inputObservation = observation
          self.trackingMisses[trackID] = 0
          let box = observation.boundingBox
          output.append([
            "trackId": Double(trackID), "timestamp": timestamp,
            "x": Double(box.minX), "y": Double(1 - box.maxY),
            "width": Double(box.width), "height": Double(box.height),
            "confidence": Double(observation.confidence)
          ])
        } catch {
          let misses = (self.trackingMisses[trackID] ?? 0) + 1
          self.trackingMisses[trackID] = misses
          if misses >= 6 {
            self.activeTrackingRequests.removeValue(forKey: trackID)
            self.trackingMisses.removeValue(forKey: trackID)
          }
        }
      }
      DispatchQueue.main.async { [weak self] in
        guard let self, self.isActive, self.isRecognitionEnabled,
              self.recognitionGeneration == generation else { return }
        self.onVisualCandidates([
          "count": output.count, "timestamp": timestamp,
          "source": "local", "candidates": output
        ])
      }
    }
  }

  private func associateCandidates(_ observations: [[String: Double]]) -> [[String: Double]] {
    let incoming: [(rect: CGRect, confidence: CGFloat)] = observations.compactMap { item in
      guard let x = item["x"], let y = item["y"], let w = item["width"],
            let h = item["height"], let confidence = item["confidence"] else { return nil }
      return (CGRect(x: CGFloat(x), y: CGFloat(y), width: CGFloat(w), height: CGFloat(h)), CGFloat(confidence))
    }
    var usedPrevious = Set<Int>()
    var next: [(id: Int, rect: CGRect, confidence: CGFloat)] = []
    var output: [[String: Double]] = []

    for candidate in incoming {
      var bestIndex: Int?
      var bestOverlap: CGFloat = 0
      for (index, previous) in previousCandidates.enumerated() where !usedPrevious.contains(index) {
        let overlap = Self.intersectionOverUnion(candidate.rect, previous.rect)
        if overlap > bestOverlap {
          bestOverlap = overlap
          bestIndex = index
        }
      }
      let trackID: Int
      let smoothedRect: CGRect
      if let bestIndex, bestOverlap >= 0.18 {
        usedPrevious.insert(bestIndex)
        let previous = previousCandidates[bestIndex]
        trackID = previous.id
        smoothedRect = CGRect(
          x: previous.rect.minX * 0.62 + candidate.rect.minX * 0.38,
          y: previous.rect.minY * 0.62 + candidate.rect.minY * 0.38,
          width: previous.rect.width * 0.62 + candidate.rect.width * 0.38,
          height: previous.rect.height * 0.62 + candidate.rect.height * 0.38
        )
      } else {
        trackID = nextCandidateTrackID
        nextCandidateTrackID += 1
        smoothedRect = candidate.rect
      }
      next.append((trackID, smoothedRect, candidate.confidence))
      output.append([
        "trackId": Double(trackID),
        "x": Double(smoothedRect.minX),
        "y": Double(smoothedRect.minY),
        "width": Double(smoothedRect.width),
        "height": Double(smoothedRect.height),
        "confidence": Double(candidate.confidence)
      ])
    }
    previousCandidates = next
    return output
  }

  private static func intersectionOverUnion(_ a: CGRect, _ b: CGRect) -> CGFloat {
    let intersection = a.intersection(b)
    guard !intersection.isNull, intersection.width > 0, intersection.height > 0 else { return 0 }
    let intersectionArea = intersection.width * intersection.height
    let unionArea = a.width * a.height + b.width * b.height - intersectionArea
    return unionArea > 0 ? intersectionArea / unionArea : 0
  }

  private func drawCandidates(_ candidates: [[String: Double]], imageWidth: Int, imageHeight: Int) {
    let viewSize = sceneView.bounds.size
    guard viewSize.width > 0, viewSize.height > 0, imageWidth > 0, imageHeight > 0 else { return }
    let scale = max(viewSize.width / CGFloat(imageWidth), viewSize.height / CGFloat(imageHeight))
    let renderedWidth = CGFloat(imageWidth) * scale
    let renderedHeight = CGFloat(imageHeight) * scale
    let offsetX = (viewSize.width - renderedWidth) / 2
    let offsetY = (viewSize.height - renderedHeight) / 2
    let path = UIBezierPath()
    for candidate in candidates {
      guard let x = candidate["x"], let y = candidate["y"],
            let width = candidate["width"], let height = candidate["height"] else { continue }
      let rect = CGRect(
        x: offsetX + CGFloat(x) * renderedWidth,
        y: offsetY + CGFloat(y) * renderedHeight,
        width: CGFloat(width) * renderedWidth,
        height: CGFloat(height) * renderedHeight
      )
      path.append(UIBezierPath(roundedRect: rect, cornerRadius: 5))
    }
    rectangleOverlay.path = path.cgPath
  }

  public func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    let state: String
    let reason: String
    switch camera.trackingState {
    case .normal:
      state = "normal"
      reason = ""
    case .notAvailable:
      state = "not_available"
      reason = ""
    case .limited(let limitedReason):
      state = "limited"
      switch limitedReason {
      case .initializing: reason = "initializing"
      case .excessiveMotion: reason = "excessive_motion"
      case .insufficientFeatures: reason = "insufficient_features"
      case .relocalizing: reason = "relocalizing"
      @unknown default: reason = "unknown"
      }
    }
    let signature = state + ":" + reason
    guard signature != lastTrackingState else { return }
    lastTrackingState = signature
    if state != "normal" {
      recognitionGeneration += 1
      visionQueue.async { [weak self] in self?.clearLocalTrackingState() }
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.rectangleOverlay.path = nil
        self.previousCandidates.removeAll()
        self.onVisualCandidates(["count": 0, "candidates": []])
      }
    }
    onTrackingUpdate(["state": state, "reason": reason])
  }

  public func session(_ session: ARSession, didFailWithError error: Error) {
    onARError(["message": error.localizedDescription])
  }

  private static func makeConfiguration() -> ARWorldTrackingConfiguration {
    let configuration = ARWorldTrackingConfiguration()
    configuration.worldAlignment = .gravity
    if #available(iOS 14.0, *) {
      if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) { configuration.frameSemantics.insert(.sceneDepth) }
      if ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) { configuration.frameSemantics.insert(.smoothedSceneDepth) }
    }
    return configuration
  }

  private static func imageOrientation(for orientation: UIInterfaceOrientation) -> CGImagePropertyOrientation {
    switch orientation {
    case .portrait: return .right
    case .portraitUpsideDown: return .left
    case .landscapeLeft: return .up
    case .landscapeRight: return .down
    default: return .right
    }
  }

  public func sessionWasInterrupted(_ session: ARSession) {
    recognitionGeneration += 1
    visionQueue.async { [weak self] in self?.clearLocalTrackingState() }
    DispatchQueue.main.async { [weak self] in
      self?.onVisualCandidates(["count": 0, "source": "local", "candidates": []])
    }
    onTrackingUpdate(["state": "interrupted", "reason": "system_interruption"])
  }

  public func sessionInterruptionEnded(_ session: ARSession) {
    if isActive {
      // Let ARKit relocalize against its existing world map. Resetting tracking
      // here would destroy the coordinate frame that bottle anchors depend on.
      sceneView.session.run(Self.makeConfiguration(), options: [])
      onTrackingUpdate(["state": "limited", "reason": "relocalizing"])
    }
  }
}

extension DiscoverARView: ARSCNViewDelegate {}
