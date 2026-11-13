import { requireNativeModule } from "expo-modules-core";

type DfineNativeRuntimeResult = {
  ready?: boolean;
  cachedSession?: boolean;
  sha256?: string;
  runtimeVersion?: string;
  inputNames?: string[];
  outputNames?: string[];
  providerOrder?: string[];
  modelCacheDirectory?: string;
  inferenceSucceeded?: boolean;
  inputShape?: number[];
  outputShapes?: Record<string, number[]>;
  inferenceMs?: number;
  [key: string]: unknown;
};

type DiscoverARKitResearchModule = {
  downloadAndInitializeDfineNativeRuntime(): Promise<DfineNativeRuntimeResult>;
  runDfineNativeSmokeTest(): Promise<DfineNativeRuntimeResult>;
};

function researchModule(): DiscoverARKitResearchModule {
  return requireNativeModule<DiscoverARKitResearchModule>("DiscoverARKit");
}

/** Explicit research-only device test; never invoked by the live scanner. */
export function downloadAndInitializeDfineNativeRuntime(): Promise<DfineNativeRuntimeResult> {
  return researchModule().downloadAndInitializeDfineNativeRuntime();
}

/** Runs one synthetic zero-tensor inference after native initialization. */
export function runDfineNativeSmokeTest(): Promise<DfineNativeRuntimeResult> {
  return researchModule().runDfineNativeSmokeTest();
}
