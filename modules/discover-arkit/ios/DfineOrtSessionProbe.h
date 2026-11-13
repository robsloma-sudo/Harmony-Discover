#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface DfineOrtSessionProbe : NSObject

/// Loads and retains one CoreML-first ONNX Runtime session for the pinned D-FINE graph.
/// CPU remains the fallback execution provider.
+ (nullable NSDictionary<NSString *, id> *)initializeModelAtPath:(NSString *)modelPath
                                                  cacheDirectory:(NSString *)cacheDirectory
                                                           error:(NSError * _Nullable * _Nullable)error
    NS_SWIFT_NAME(initializeModel(atPath:cacheDirectory:));

/// Runs one deterministic zero-input inference and reports the exact output shapes and elapsed time.
+ (nullable NSDictionary<NSString *, id> *)runSmokeTestWithError:(NSError * _Nullable * _Nullable)error
    NS_SWIFT_NAME(runSmokeTest());

@end

NS_ASSUME_NONNULL_END
