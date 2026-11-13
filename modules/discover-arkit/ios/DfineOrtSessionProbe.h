#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface DfineOrtSessionProbe : NSObject

/// Loads and retains one CoreML-first ONNX Runtime session for the pinned D-FINE graph.
/// CPU remains the fallback execution provider.
+ (nullable NSDictionary<NSString *, id> *)initializeModelAtPath:(NSString *)modelPath
                                                  cacheDirectory:(NSString *)cacheDirectory
                                                           error:(NSError * _Nullable * _Nullable)error
    NS_SWIFT_NAME(initializeModel(atPath:cacheDirectory:));

@end

NS_ASSUME_NONNULL_END
