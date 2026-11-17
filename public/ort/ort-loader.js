import * as ort from './ort.wasm.bundle.min.mjs';

// Loaded as a standalone browser ES module, outside Metro's dependency graph.
window.__discoverOrtRuntime = ort;
