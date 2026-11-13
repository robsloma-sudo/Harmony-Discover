#import "DfineOrtSessionProbe.h"
#import <onnxruntime.h>
#import <QuartzCore/QuartzCore.h>

static dispatch_queue_t DfineSessionQueue;
static ORTEnv *DfineEnvironment;
static ORTSession *DfineSession;
static NSString *DfineLoadedModelPath;

@implementation DfineOrtSessionProbe

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
      if (![inputNames isEqualToArray:@[@"input"]] || ![[NSSet setWithArray:outputNames] isEqualToSet:expectedOutputs]) {
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


+ (NSDictionary<NSString *, id> *)runSmokeTestWithError:(NSError **)error {
  __block NSDictionary<NSString *, id> *result = nil;
  __block NSError *operationError = nil;

  dispatch_sync(DfineSessionQueue, ^{
    @autoreleasepool {
      if (!DfineSession) {
        operationError = [NSError errorWithDomain:@"DfineOrtSessionProbe" code:5 userInfo:@{
          NSLocalizedDescriptionKey: @"D-FINE session has not been initialized."
        }];
        return;
      }

      const NSUInteger elementCount = 3 * 640 * 640;
      NSMutableData *inputData = [NSMutableData dataWithLength:elementCount * sizeof(float)];
      ORTValue *inputValue = [[ORTValue alloc] initWithTensorData:inputData
                                                      elementType:ORTTensorElementDataTypeFloat
                                                            shape:@[@1, @3, @640, @640]
                                                            error:&operationError];
      if (!inputValue || operationError) return;

      CFTimeInterval startedAt = CACurrentMediaTime();
      NSDictionary<NSString *, ORTValue *> *outputs = [DfineSession runWithInputs:@{@"input": inputValue}
                                                                       outputNames:[NSSet setWithArray:@[@"labels", @"boxes", @"scores", @"masks"]]
                                                                        runOptions:nil
                                                                             error:&operationError];
      if (!outputs || operationError) return;
      double elapsedMs = (CACurrentMediaTime() - startedAt) * 1000.0;

      NSMutableDictionary<NSString *, NSArray<NSNumber *> *> *shapes = [NSMutableDictionary dictionary];
      for (NSString *name in @[@"labels", @"boxes", @"scores", @"masks"]) {
        ORTValue *value = outputs[name];
        if (!value) {
          operationError = [NSError errorWithDomain:@"DfineOrtSessionProbe" code:6 userInfo:@{
            NSLocalizedDescriptionKey: [NSString stringWithFormat:@"D-FINE inference did not return %@.", name]
          }];
          return;
        }
        ORTTensorTypeAndShapeInfo *info = [value tensorTypeAndShapeInfoWithError:&operationError];
        if (!info || operationError) return;
        shapes[name] = info.shape;
      }

      NSDictionary<NSString *, NSArray<NSNumber *> *> *expected = @{
        @"labels": @[@1, @300],
        @"boxes": @[@1, @300, @4],
        @"scores": @[@1, @300],
        @"masks": @[@1, @300, @160, @160]
      };
      if (![shapes isEqualToDictionary:expected]) {
        operationError = [NSError errorWithDomain:@"DfineOrtSessionProbe" code:7 userInfo:@{
          NSLocalizedDescriptionKey: @"D-FINE output tensor shapes do not match the pinned model contract.",
          @"actualShapes": shapes,
          @"expectedShapes": expected
        }];
        return;
      }

      result = @{
        @"inferenceSucceeded": @YES,
        @"inputShape": @[@1, @3, @640, @640],
        @"outputShapes": shapes,
        @"inferenceMs": @(elapsedMs),
        @"inputKind": @"deterministic zero tensor",
        @"note": @"Synthetic smoke test only; not a bottle-recognition or camera-performance test."
      };
    }
  });

  if (operationError && error) *error = operationError;
  return result;
}

@end
