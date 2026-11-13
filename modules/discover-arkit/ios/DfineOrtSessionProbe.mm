#import "DfineOrtSessionProbe.h"
#import <onnxruntime.h>

@implementation DfineOrtSessionProbe

static dispatch_queue_t DfineSessionQueue;
static ORTEnv *DfineEnvironment;
static ORTSession *DfineSession;
static NSString *DfineLoadedModelPath;

+ (void)initialize {
  if (self == [DfineOrtSessionProbe class]) {
    DfineSessionQueue = dispatch_queue_create("com.harmony.discover.dfine-ort-session", DISPATCH_QUEUE_SERIAL);
  }
}

+ (NSDictionary<NSString *, id> *)initializeModelAtPath:(NSString *)modelPath
                                         cacheDirectory:(NSString *)cacheDirectory
                                                  error:(NSError **)error {
  __block NSDictionary<NSString *, id> *result = nil;
  __block NSError *operationError = nil;

  dispatch_sync(DfineSessionQueue, ^{
    @autoreleasepool {
      if (DfineSession && [DfineLoadedModelPath isEqualToString:modelPath]) {
        result = @{
          @"ready": @YES,
          @"cachedSession": @YES,
          @"inputNames": [DfineSession inputNamesWithError:&operationError] ?: @[],
          @"outputNames": [DfineSession outputNamesWithError:&operationError] ?: @[],
          @"inferenceEnabled": @NO,
          @"note": @"Session initialization proof only; no camera frames are submitted."
        };
        return;
      }

      NSError *localError = nil;
      ORTEnv *environment = [[ORTEnv alloc] initWithLoggingLevel:ORTLoggingLevelWarning error:&localError];
      if (!environment || localError) {
        operationError = localError ?: [NSError errorWithDomain:@"DfineOrtSessionProbe" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Could not create ONNX Runtime environment."}];
        return;
      }

      ORTSessionOptions *options = [[ORTSessionOptions alloc] initWithError:&localError];
      if (!options || localError) {
        operationError = localError;
        return;
      }

      [options setGraphOptimizationLevel:ORTGraphOptimizationLevelAll error:&localError];
      if (localError) {
        operationError = localError;
        return;
      }

      NSDictionary<NSString *, NSString *> *providerOptions = @{
        @"ModelFormat": @"MLProgram",
        @"MLComputeUnits": @"ALL",
        @"RequireStaticInputShapes": @"1",
        @"EnableOnSubgraphs": @"0",
        @"ModelCacheDirectory": cacheDirectory
      };
      if (![options appendExecutionProvider:@"CoreML" providerOptions:providerOptions error:&localError] || localError) {
        operationError = localError ?: [NSError errorWithDomain:@"DfineOrtSessionProbe" code:2 userInfo:@{NSLocalizedDescriptionKey: @"Could not register the CoreML execution provider."}];
        return;
      }

      ORTSession *session = [[ORTSession alloc] initWithEnv:environment modelPath:modelPath sessionOptions:options error:&localError];
      if (!session || localError) {
        operationError = localError ?: [NSError errorWithDomain:@"DfineOrtSessionProbe" code:3 userInfo:@{NSLocalizedDescriptionKey: @"Could not initialize the D-FINE ONNX session."}];
        return;
      }

      NSArray<NSString *> *inputNames = [session inputNamesWithError:&localError];
      NSArray<NSString *> *outputNames = [session outputNamesWithError:&localError];
      if (localError) {
        operationError = localError;
        return;
      }

      NSSet<NSString *> *expectedOutputs = [NSSet setWithArray:@[@"labels", @"boxes", @"scores", @"masks"]];
      if (![inputNames isEqualToArray:@[@"input"]] || ![NSSet setWithArray:outputNames].isEqualToSet:expectedOutputs) {
        operationError = [NSError errorWithDomain:@"DfineOrtSessionProbe" code:4 userInfo:@{
          NSLocalizedDescriptionKey: @"D-FINE input/output names do not match the pinned graph contract.",
          @"inputNames": inputNames ?: @[],
          @"outputNames": outputNames ?: @[]
        }];
        return;
      }

      DfineEnvironment = environment;
      DfineSession = session;
      DfineLoadedModelPath = [modelPath copy];
      result = @{
        @"ready": @YES,
        @"cachedSession": @NO,
        @"inputNames": inputNames,
        @"outputNames": outputNames,
        @"inputShape": @[@1, @3, @640, @640],
        @"inputType": @"float32",
        @"outputsValidated": @YES,
        @"inferenceEnabled": @NO,
        @"providerOrder": @[@"CoreML", @"CPU fallback"],
        @"modelCacheDirectory": cacheDirectory,
        @"note": @"Session initialization proof only; no camera frames are submitted."
      };
    }
  });

  if (operationError && error) {
    *error = operationError;
  }
  return result;
}

@end
