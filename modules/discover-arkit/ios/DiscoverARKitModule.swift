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
  private let sceneView = ARSCNView(frame: .zero)
  private var isActive = false
  private var lastTrackingState = ""

  let onTrackingUpdate = EventDispatcher()
  let onARReady = EventDispatcher()
  let onARError = EventDispatcher()
  let onVisualCandidates = EventDispatcher()
  private let visionQueue = DispatchQueue(label: "com.harmony.discover.vision", qos: .userInitiated)
  private let visionFrameGate = DispatchSemaphore(value: 1)
  private var lastVisionFrameTime: TimeInterval = 0
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

    let configuration = ARWorldTrackingConfiguration()
    configuration.worldAlignment = .gravity
    if #available(iOS 14.0, *) {
      if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
        configuration.frameSemantics.insert(.sceneDepth)
      }
    }
    sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    onARReady(["state": "starting"])
  }

  public func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard isActive else { return }
    let now = frame.timestamp
    guard now - lastVisionFrameTime >= 0.25 else { return }
    lastVisionFrameTime = now
    let pixelBuffer = frame.capturedImage
    let imageWidth = CVPixelBufferGetWidth(pixelBuffer)
    let imageHeight = CVPixelBufferGetHeight(pixelBuffer)

    guard visionFrameGate.wait(timeout: .now()) == .success else { return }
    visionQueue.async { [weak self] in
      defer { self?.visionFrameGate.signal() }
      guard let self else { return }
      let request = VNDetectRectanglesRequest()
      request.maximumObservations = 8
      request.minimumConfidence = 0.55
      request.minimumSize = 0.04
      request.minimumAspectRatio = 0.12
      request.maximumAspectRatio = 0.98
      request.quadratureTolerance = 25
      do {
        try VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .right).perform([request])
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
          self.drawCandidates(observations, imageWidth: imageWidth, imageHeight: imageHeight)
          self.onVisualCandidates(["count": observations.count, "candidates": observations])
        }
      } catch {
        DispatchQueue.main.async { [weak self] in
          self?.onARError(["message": "Live visual analysis failed: \(error.localizedDescription)"])
        }
      }
    }
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
    onTrackingUpdate(["state": state, "reason": reason])
  }

  public func session(_ session: ARSession, didFailWithError error: Error) {
    onARError(["message": error.localizedDescription])
  }

  public func sessionWasInterrupted(_ session: ARSession) {
    onTrackingUpdate(["state": "interrupted", "reason": "system_interruption"])
  }

  public func sessionInterruptionEnded(_ session: ARSession) {
    if isActive {
      sceneView.session.run(ARWorldTrackingConfiguration(), options: [.resetTracking, .removeExistingAnchors])
    }
  }
}

extension DiscoverARView: ARSCNViewDelegate {}
