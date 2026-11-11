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
      Events("onTrackingUpdate", "onARReady", "onARError", "onVisualCandidates")
      Prop("active") { (view: DiscoverARView, active: Bool) in
        view.setActive(active)
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
  private var lastTrackingState = ""

  let onTrackingUpdate = EventDispatcher()
  let onARReady = EventDispatcher()
  let onARError = EventDispatcher()
  let onVisualCandidates = EventDispatcher()
  private let visionQueue = DispatchQueue(label: "com.harmony.discover.vision", qos: .userInitiated)
  private let visionFrameGate = DispatchSemaphore(value: 1)
  private var lastVisionFrameTime: TimeInterval = 0
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
    rectangleOverlay.strokeColor = UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 0.98).cgColor
    rectangleOverlay.fillColor = UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 0.07).cgColor
    rectangleOverlay.lineWidth = 2.0
    rectangleOverlay.lineJoin = .round
    view.layer.addSublayer(rectangleOverlay)
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
      setActive(false)
    }
  }

  func setActive(_ active: Bool) {
    guard active != isActive else { return }
    isActive = active
    if !active {
      rectangleOverlay.path = nil
      previousCandidates.removeAll()
      sceneView.session.pause()
      lastTrackingState = "paused"
      onTrackingUpdate(["state": "paused", "reason": "view_inactive"])
      return
    }

    guard ARWorldTrackingConfiguration.isSupported else {
      onARError(["message": "ARKit world tracking is not supported on this device."])
      isActive = false
      return
    }

    sceneView.session.run(Self.makeConfiguration(), options: [.resetTracking, .removeExistingAnchors])
    onARReady(["state": "starting"])
  }

  public func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard isActive else { return }
    let now = frame.timestamp
    guard now - lastVisionFrameTime >= 0.25 else { return }
    lastVisionFrameTime = now
    let pixelBuffer = frame.capturedImage
    let rawWidth = CVPixelBufferGetWidth(pixelBuffer)
    let rawHeight = CVPixelBufferGetHeight(pixelBuffer)
    let orientation = Self.imageOrientation(for: sceneView.window?.windowScene?.interfaceOrientation ?? .portrait)
    let swapsDimensions = orientation == .right || orientation == .left
    let imageWidth = swapsDimensions ? rawHeight : rawWidth
    let imageHeight = swapsDimensions ? rawWidth : rawHeight

    guard visionFrameGate.wait(timeout: .now()) == .success else { return }
    CVPixelBufferRetain(pixelBuffer)
    visionQueue.async { [weak self] in
      defer {
        CVPixelBufferRelease(pixelBuffer)
        self?.visionFrameGate.signal()
      }
      guard let self else { return }
      let request = VNDetectRectanglesRequest()
      request.maximumObservations = 8
      request.minimumConfidence = 0.55
      request.minimumSize = 0.04
      request.minimumAspectRatio = 0.12
      request.maximumAspectRatio = 0.98
      request.quadratureTolerance = 25
      do {
        try VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation).perform([request])
        let observations = (request.results ?? []).map { observation -> [String: Double] in
          let box = observation.boundingBox
          return [
            "x": Double(box.minX),
            "y": Double(1.0 - box.maxY),
            "width": Double(box.width),
            "height": Double(box.height),
            "confidence": Double(observation.confidence)
          ]
        }
        DispatchQueue.main.async { [weak self] in
          guard let self, self.isActive else { return }
          let tracked = self.associateCandidates(observations)
          self.drawCandidates(tracked, imageWidth: imageWidth, imageHeight: imageHeight)
          self.onVisualCandidates(["count": tracked.count, "candidates": tracked])
        }
      } catch {
        DispatchQueue.main.async { [weak self] in
          self?.onARError(["message": "Live visual analysis failed: \(error.localizedDescription)"])
        }
      }
    }
  }

  private func associateCandidates(_ observations: [[String: Double]]) -> [[String: Double]] {
    let incoming: [(rect: CGRect, confidence: CGFloat)] = observations.compactMap { item in
      guard let x = item["x"], let y = item["y"], let w = item["width"],
            let h = item["height"], let confidence = item["confidence"] else { return nil }
      return (CGRect(x: x, y: y, width: w, height: h), CGFloat(confidence))
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
    if #available(iOS 14.0, *),
       ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
      configuration.frameSemantics.insert(.sceneDepth)
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
    onTrackingUpdate(["state": "interrupted", "reason": "system_interruption"])
  }

  public func sessionInterruptionEnded(_ session: ARSession) {
    if isActive {
      sceneView.session.run(Self.makeConfiguration(), options: [.resetTracking, .removeExistingAnchors])
    }
  }
}

extension DiscoverARView: ARSCNViewDelegate {}
