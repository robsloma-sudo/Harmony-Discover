import ExpoModulesCore
import ARKit
import SceneKit
import Vision
import CoreImage
import UIKit

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

    View(DiscoverARView.self) {
      Events("onTrackingUpdate", "onARReady", "onARError", "onVisualCandidates", "onRecognitionUpdate", "onDepthEstimate", "onDepthStatus", "onCapturedImage", "onFrame", "onSpatialAnchorStatus")
      Prop("active") { (view: DiscoverARView, active: Bool) in
        view.setActive(active)
      }
      Prop("recognitionEnabled") { (view: DiscoverARView, enabled: Bool) in
        view.setRecognitionEnabled(enabled)
      }
      Prop("captureRequestId") { (view: DiscoverARView, requestId: Int) in
        view.captureFrame(requestId)
      }
      Prop("spatialAnchors") { (view: DiscoverARView, candidates: [[String: Any]]) in
        view.updateSpatialAnchors(candidates)
      }
      AsyncFunction("pause") { (view: DiscoverARView) in
        view.setActive(false)
      }
      AsyncFunction("resume") { (view: DiscoverARView) in
        view.setActive(true)
      }
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
  // Preserve the requested active state across temporary native-view detachment.
  // Expo/React may keep the prop value unchanged when the view is reattached.
  private var shouldBeActive = false
  private var isRecognitionEnabled = false
  private var lastTrackingState = ""

  let onTrackingUpdate = EventDispatcher()
  let onARReady = EventDispatcher()
  let onARError = EventDispatcher()
  let onVisualCandidates = EventDispatcher()
  let onRecognitionUpdate = EventDispatcher()
  let onDepthEstimate = EventDispatcher()
  let onDepthStatus = EventDispatcher()
  let onCapturedImage = EventDispatcher()
  let onFrame = EventDispatcher()
  let onSpatialAnchorStatus = EventDispatcher()
  private var lastCaptureRequestId = 0
  private var spatialAnchors: [String: ARAnchor] = [:]
  private var spatialAnchorStates: [String: String] = [:]
  private var pendingCaptureRequestId: Int?
  private var lastCloudFrameTime: TimeInterval = 0
  private let visionQueue = DispatchQueue(label: "com.harmony.discover.vision", qos: .userInitiated)
  private let visionFrameGate = DispatchSemaphore(value: 1)
  private var lastVisionFrameTime: TimeInterval = 0
  private var lastDepthFrameTime: TimeInterval = 0
  private var nextCandidateTrackID = 1
  private var previousCandidates: [(id: Int, rect: CGRect, confidence: CGFloat)] = []
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
      // Pause the hardware session without forgetting that the React prop still
      // wants this surface active. The same prop may not be re-sent on reattach.
      stopSession(reason: "view_detached")
    } else if shouldBeActive {
      startSession()
    }
  }

  func setRecognitionEnabled(_ enabled: Bool) {
    guard enabled != isRecognitionEnabled else { return }
    isRecognitionEnabled = enabled
    if !enabled {
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

    // ARKit removes session anchors on reset; clear our lookup tables too, or
    // the next update may incorrectly believe stale anchors are still installed.
    spatialAnchors.removeAll()
    spatialAnchorStates.removeAll()
    onSpatialAnchorStatus(["activeCount": 0])
    sceneView.session.run(Self.makeConfiguration(), options: [.resetTracking, .removeExistingAnchors])
    onARReady(["state": "starting"])
  }

  /// Adds small world-anchored point markers; these are not bottle meshes.
  func updateSpatialAnchors(_ candidates: [[String: Any]]) {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in self?.updateSpatialAnchors(candidates) }
      return
    }
    guard isActive else { return }
    var seen = Set<String>()
    for candidate in candidates {
      guard let trackID = candidate["physicalObjectId"] as? String,
            let x = candidate["x"] as? Double,
            let y = candidate["y"] as? Double,
            let z = candidate["z"] as? Double,
            let state = candidate["state"] as? String,
            ["confirmed", "potential", "occluded"].contains(state) else { continue }
      seen.insert(trackID)
      let previous = spatialAnchors[trackID]
      let oldPoint = previous.map { SIMD3<Float>($0.transform.columns.3.x, $0.transform.columns.3.y, $0.transform.columns.3.z) }
      let newPoint = SIMD3<Float>(Float(x), Float(y), Float(z))
      let moved = oldPoint.map { simd_distance($0, newPoint) > 0.025 } ?? true
      guard moved || spatialAnchorStates[trackID] != state else { continue }
      if let previous { sceneView.session.remove(anchor: previous) }
      var transform = matrix_identity_float4x4
      transform.columns.3 = SIMD4<Float>(Float(x), Float(y), Float(z), 1)
      let anchor = ARAnchor(name: "discover-" + state + "-" + trackID, transform: transform)
      spatialAnchors[trackID] = anchor
      spatialAnchorStates[trackID] = state
      sceneView.session.add(anchor: anchor)
    }
    let removed = spatialAnchors.keys.filter { !seen.contains($0) }
    for trackID in removed {
      if let anchor = spatialAnchors.removeValue(forKey: trackID) {
        sceneView.session.remove(anchor: anchor)
      }
      spatialAnchorStates.removeValue(forKey: trackID)
    }
    onSpatialAnchorStatus(["activeCount": spatialAnchors.count])
  }

  public func renderer(_ renderer: SCNSceneRenderer, nodeFor anchor: ARAnchor) -> SCNNode? {
    guard let name = anchor.name, name.hasPrefix("discover-") else { return nil }
    let parts = name.split(separator: "-", maxSplits: 2).map(String.init)
    guard parts.count == 3 else { return nil }
    let color: UIColor = parts[1] == "confirmed"
      ? UIColor(red: 0.20, green: 1.0, blue: 0.55, alpha: 0.95)
      : UIColor(red: 1.0, green: 0.22, blue: 0.24, alpha: 0.95)
    let sphere = SCNSphere(radius: 0.025)
    sphere.firstMaterial?.diffuse.contents = color
    sphere.firstMaterial?.emission.contents = color
    sphere.firstMaterial?.lightingModel = .constant
    return SCNNode(geometry: sphere)
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
    let pixelBuffer = frame.capturedImage
    CVPixelBufferRetain(pixelBuffer)
    let timestamp = frame.timestamp
    let orientation = Self.imageOrientation(for: sceneView.window?.windowScene?.interfaceOrientation ?? .portrait)
    visionQueue.async { [weak self] in
      defer { CVPixelBufferRelease(pixelBuffer) }
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
    // Keep metric depth flowing at 2 Hz, and emit an exact matching depth/pose
    // sample whenever a cloud bottle-read frame is scheduled.
    let recognitionDue = isRecognitionEnabled && now - lastVisionFrameTime >= 0.50
    let shouldSendCloudFrame = recognitionDue && now - lastCloudFrameTime >= 2.5
    if now - lastDepthFrameTime >= 0.50 || shouldSendCloudFrame {
      lastDepthFrameTime = now
      emitDepthFrame(frame)
    }
    guard isRecognitionEnabled else { return }
    // Run local OCR/barcode/classification at 2 Hz; cloud bottle identification remains paced at 2.5 seconds.
    guard recognitionDue else { return }
    lastVisionFrameTime = now
    if shouldSendCloudFrame { lastCloudFrameTime = now }
    let pixelBuffer = frame.capturedImage
    guard visionFrameGate.wait(timeout: .now()) == .success else { return }
    CVPixelBufferRetain(pixelBuffer)
    let rawWidth = CVPixelBufferGetWidth(pixelBuffer)
    let rawHeight = CVPixelBufferGetHeight(pixelBuffer)
    let orientation = Self.imageOrientation(for: sceneView.window?.windowScene?.interfaceOrientation ?? .portrait)
    let swapsDimensions = orientation == .right || orientation == .left
    let imageWidth = swapsDimensions ? rawHeight : rawWidth
    let imageHeight = swapsDimensions ? rawWidth : rawHeight

    visionQueue.async { [weak self] in
      defer {
        CVPixelBufferRelease(pixelBuffer)
        self?.visionFrameGate.signal()
      }
      guard let self else { return }
      let textRequest = VNRecognizeTextRequest()
      textRequest.recognitionLevel = .fast
      textRequest.usesLanguageCorrection = false
      textRequest.minimumTextHeight = 0.012

      let barcodeRequest = VNDetectBarcodesRequest()
      barcodeRequest.symbologies = [.ean13, .ean8, .upce, .code128, .code39, .qr]

      let classifyRequest = VNClassifyImageRequest()
      classifyRequest.imageCropAndScaleOption = .centerCrop
      var cloudFrameBase64: String? = nil
      if shouldSendCloudFrame {
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
          guard let self, self.isActive else { return }
          self.onFrame(["imageBase64": cloudFrameBase64, "timestamp": now])
        }
      }
      do {
        try VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation)
          .perform([textRequest, barcodeRequest, classifyRequest])

        // Vision boxes use a bottom-left origin; convert to top-left normalized image coordinates.
        func topLeftBox(_ r: CGRect) -> [String: Double] {
          ["x0": Double(r.minX), "y0": Double(1 - r.maxY), "x1": Double(r.maxX), "y1": Double(1 - r.minY)]
        }

        let textItems: [[String: Any]] = (textRequest.results ?? []).compactMap { observation -> [String: Any]? in
          guard let candidate = observation.topCandidates(1).first, candidate.confidence >= 0.25 else { return nil }
          let string = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
          guard !string.isEmpty else { return nil }
          return ["text": string, "confidence": Double(candidate.confidence), "box": topLeftBox(observation.boundingBox)]
        }.prefix(18).map { $0 }
        let recognizedText = textItems.compactMap { $0["text"] as? String }

        let barcodeItems: [[String: Any]] = (barcodeRequest.results ?? []).compactMap { observation -> [String: Any]? in
          guard let value = observation.payloadStringValue, !value.isEmpty else { return nil }
          return ["value": value, "symbology": observation.symbology.rawValue, "box": topLeftBox(observation.boundingBox)]
        }.prefix(8).map { $0 }
        // Keep the legacy payload shape for existing listeners.
        let barcodes = barcodeItems.map { item -> [String: String] in
          ["value": item["value"] as? String ?? "", "symbology": item["symbology"] as? String ?? ""]
        }

        let classifications = (classifyRequest.results ?? []).prefix(6).map { item in
          ["identifier": item.identifier, "confidence": String(format: "%.3f", item.confidence)]
        }

        DispatchQueue.main.async { [weak self] in
          guard let self, self.isActive else { return }
          self.onRecognitionUpdate([
            "text": recognizedText,
            "barcodes": barcodes,
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

  /// Emits sampled metric depth. Zero represents an invalid sample.
  private func emitDepthFrame(_ frame: ARFrame) {
    guard #available(iOS 14.0, *) else { onDepthStatus(["status": "ios_depth_api_unavailable"]); return }
    guard let depthData = frame.smoothedSceneDepth ?? frame.sceneDepth else { onDepthStatus(["status": "waiting_for_lidar_depth"]); return }
    let depthMap = depthData.depthMap
    let confidenceMap = depthData.confidenceMap
    let rawWidth = CVPixelBufferGetWidth(depthMap)
    let rawHeight = CVPixelBufferGetHeight(depthMap)
    guard rawWidth > 0, rawHeight > 0 else { return }
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
    guard let depthBase = CVPixelBufferGetBaseAddress(depthMap), let confidenceBase = CVPixelBufferGetBaseAddress(confidenceMap) else { return }
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
    // Pixel axes in the upright, rotated depth grid are not always aligned
    // with ARKit camera X/Y. Map image rays back into the native camera basis.
    let cameraRayBasis: [Double]
    switch orientation {
    case .right: cameraRayBasis = [0, 1, 1, 0]
    case .left: cameraRayBasis = [0, -1, -1, 0]
    case .down: cameraRayBasis = [-1, 0, 0, 1]
    default: cameraRayBasis = [1, 0, 0, -1]
    }
    let transform = frame.camera.transform
    let transformValues = (0..<4).flatMap { column in (0..<4).map { row in Double(transform[column, row]) } }
    let payload: [String: Any] = ["width": outputWidth, "height": outputHeight, "sourceWidth": sourceWidth, "sourceHeight": sourceHeight, "depthMeters": meters, "confidence": confidence, "cameraIntrinsics": intrinsicsValues, "cameraRayBasis": cameraRayBasis, "cameraTransform": transformValues, "timestamp": frame.timestamp, "unit": "meters", "source": frame.smoothedSceneDepth == nil ? "sceneDepth" : "smoothedSceneDepth", "imageOrientation": orientation.rawValue]
    DispatchQueue.main.async { [weak self] in guard let self, self.isActive else { return }; self.onDepthEstimate(payload); self.onDepthStatus(["status": "live_metric_depth"]) }
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
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.previousCandidates.removeAll()
      self.rectangleOverlay.path = nil
      self.lastVisionFrameTime = 0
      self.lastDepthFrameTime = 0
      self.onVisualCandidates(["count": 0, "candidates": []])
      self.onDepthStatus(["status": "session_interrupted"])
      self.onTrackingUpdate(["state": "interrupted", "reason": "system_interruption"])
    }
  }

  public func sessionInterruptionEnded(_ session: ARSession) {
    DispatchQueue.main.async { [weak self] in
      guard let self, self.isActive else { return }
      // ARKit removes anchors during reset; clear our identity-to-anchor maps
      // before restarting so a reused physical ID cannot point at a stale node.
      self.spatialAnchors.removeAll()
      self.spatialAnchorStates.removeAll()
      self.onSpatialAnchorStatus(["activeCount": 0])
      self.sceneView.session.run(Self.makeConfiguration(), options: [.resetTracking, .removeExistingAnchors])
      self.onARReady(["state": "starting"])
    }
  }
}

extension DiscoverARView: ARSCNViewDelegate {}
