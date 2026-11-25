#import "LLFaceEncoder.h"
#import <onnxruntime-objc/onnxruntime.h>

@implementation LLFaceEncoder {
  ORTEnv *_env;
  ORTSession *_session;
  NSString *_output;
}
- (instancetype)initWithModel:(NSString *)path error:(NSError **)error {
  if ((self = [super init])) {
    _env = [[ORTEnv alloc] initWithLoggingLevel:ORTLoggingLevelWarning error:error];
    if (!_env) return nil;
    ORTSessionOptions *options = [[ORTSessionOptions alloc] initWithError:error];
    if (!options || ![options setIntraOpNumThreads:1 error:error]) return nil;
    _session = [[ORTSession alloc] initWithEnv:_env modelPath:path sessionOptions:options error:error];
    if (!_session) return nil;
    _output = [[_session outputNamesWithError:error] firstObject];
    if (!_output) return nil;
  }
  return self;
}
- (NSData *)encode:(NSMutableData *)pixels side:(NSInteger)side input:(NSString *)name error:(NSError **)error {
  ORTValue *tensor = [[ORTValue alloc] initWithTensorData:pixels elementType:ORTTensorElementDataTypeFloat
                         shape:@[@1,@3,@(side),@(side)] error:error];
  if (!tensor) return nil;
  NSDictionary *result = [_session runWithInputs:@{name:tensor} outputNames:[NSSet setWithObject:_output] runOptions:nil error:error];
  return [[result[_output] tensorDataWithError:error] copy];
}
@end
