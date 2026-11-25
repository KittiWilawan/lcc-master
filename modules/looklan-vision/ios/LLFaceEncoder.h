#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@interface LLFaceEncoder : NSObject
- (nullable instancetype)initWithModel:(NSString *)path error:(NSError **)error;
- (nullable NSData *)encode:(NSMutableData *)pixels side:(NSInteger)side input:(NSString *)name error:(NSError **)error;
@end
NS_ASSUME_NONNULL_END
