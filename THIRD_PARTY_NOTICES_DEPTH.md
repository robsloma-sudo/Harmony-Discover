# Third-party notices: browser depth estimation

Harmony Discover's optional browser depth-preview worker uses the following third-party components:

- **Transformers.js 4.3.2** — Apache License 2.0. Loaded by the browser worker from jsDelivr.
- **Depth Anything V2 Small ONNX** (`onnx-community/depth-anything-v2-small-ONNX`) — Apache License 2.0. Model weights are downloaded by the browser from Hugging Face on first use and cached according to browser policy.
- **ONNX Runtime Web** — MIT License; used as the inference runtime through Transformers.js.

The model is Depth Anything V2 Small. The Small checkpoint is Apache-2.0; the Base, Large, and Giant checkpoints have different non-commercial licensing and are not used here.

References:
- Transformers.js package: https://www.npmjs.com/package/@huggingface/transformers
- Depth Anything V2 Small ONNX model card: https://huggingface.co/onnx-community/depth-anything-v2-small-ONNX
- Depth Anything V2 upstream project and license: https://github.com/DepthAnything/Depth-Anything-V2

The output is **relative inverse depth**, not calibrated metric distance. It must not be described as metres, LiDAR, or world-anchored 3D tracking.
