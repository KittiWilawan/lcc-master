import ExpoModulesCore
import MediaPipeTasksVision
import UIKit

private enum ScanFailure: Error { case resources, image, quality, points }
private struct Rules: Decodable {
  struct Security: Decodable {
    struct Identity: Decodable { let size: Int; let template: [[Double]]; let landmarkGroups: [[Int]]; let input: String }
    let identity: Identity
  }
  struct Quality: Decodable { let minBrightness: Double; let maxBrightness: Double; let minSharpness: Double }
  let security: Security
  let quality: Quality
}

private final class LocalModels {
  let faces: FaceLandmarker
  let poses: PoseLandmarker
  let encoder: LLFaceEncoder
  let rules: Rules
  init() throws {
    guard let url = Bundle(for: LookLanVisionModule.self).url(forResource: "LookLanModels", withExtension: "bundle"),
          let bundle = Bundle(url: url) else { throw ScanFailure.resources }
    func asset(_ name: String, _ ext: String) throws -> URL {
      guard let file = bundle.url(forResource: name, withExtension: ext) else { throw ScanFailure.resources }
      return file
    }
    rules = try JSONDecoder().decode(Rules.self, from: Data(contentsOf: asset("faceScan","json")))
    let fo = FaceLandmarkerOptions()
    fo.baseOptions.modelAssetPath = try asset("face_landmarker","task").path
    fo.numFaces = 6
    faces = try FaceLandmarker(options: fo)
    let po = PoseLandmarkerOptions()
    po.baseOptions.modelAssetPath = try asset("pose_landmarker_full","task").path
    po.numPoses = 6
    poses = try PoseLandmarker(options: po)
    encoder = try LLFaceEncoder(model: asset("sface","onnx").path)
  }

  func inspect(_ encoded: String, includeBodies: Bool, useFaces: Bool) throws -> [String:Any] {
    guard let data = Data(base64Encoded: encoded), let image = UIImage(data: data), let cg = image.cgImage else { throw ScanFailure.image }
    let source = try MPImage(uiImage: image)
    var result: [String:Any] = [:]
    if includeBodies {
      result["poses"] = try poses.detect(image: source).landmarks.map { person in
        person.map { [$0.x, $0.y, $0.z, $0.visibility?.floatValue ?? 0] }
      }
    }
    if useFaces {
      let detected = try faces.detect(image: source).faceLandmarks
      result["faces"] = detected.map { face -> [String:Any] in
        let xs = face.map { CGFloat($0.x) }, ys = face.map { CGFloat($0.y) }
        let x = xs.min() ?? 0, y = ys.min() ?? 0
        var row: [String:Any] = ["left":x,"top":y,"width":(xs.max() ?? x)-x,"height":(ys.max() ?? y)-y,"confidence":1.0]
        do {
          let (vector, issue) = try vectorFor(cg, face)
          row["vector"] = vector
          if let issue { row["issue"] = issue }
        } catch { row["issue"] = "blur" }
        return row
      }
    }
    return result
  }

  private func vectorFor(_ cg: CGImage, _ face: [NormalizedLandmark]) throws -> ([Float],String?) {
    let cfg = rules.security.identity
    let anchors = try cfg.landmarkGroups.map { group -> CGPoint in
      guard !group.isEmpty, group.allSatisfy({face.indices.contains($0)}) else { throw ScanFailure.points }
      return CGPoint(x: group.reduce(0.0) { $0 + Double(face[$1].x) } * Double(cg.width)/Double(group.count),
                     y: group.reduce(0.0) { $0 + Double(face[$1].y) } * Double(cg.height)/Double(group.count))
    }
    let target = cfg.template.map { CGPoint(x:$0[0],y:$0[1]) }
    func center(_ p: [CGPoint]) -> CGPoint { CGPoint(x: p.map(\.x).reduce(0,+)/CGFloat(p.count), y: p.map(\.y).reduce(0,+)/CGFloat(p.count)) }
    let s = center(anchors), t = center(target)
    var dot: CGFloat = 0, cross: CGFloat = 0, norm: CGFloat = 0
    for (p,q) in zip(anchors,target) {
      let x=p.x-s.x, y=p.y-s.y, u=q.x-t.x, v=q.y-t.y
      dot += x*u+y*v; cross += x*v-y*u; norm += x*x+y*y
    }
    guard norm > 0 else { throw ScanFailure.points }
    let a=dot/norm, b=cross/norm, side=cfg.size, pixels=side*side
    guard let ctx=CGContext(data:nil,width:side,height:side,bitsPerComponent:8,bytesPerRow:side*4,
              space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { throw ScanFailure.image }
    ctx.translateBy(x:0,y:CGFloat(side)); ctx.scaleBy(x:1,y:-1)
    ctx.concatenate(CGAffineTransform(a:a,b:b,c:-b,d:a,tx:t.x-a*s.x+b*s.y,ty:t.y-b*s.x-a*s.y))
    ctx.translateBy(x:0,y:CGFloat(cg.height)); ctx.scaleBy(x:1,y:-1)
    ctx.draw(cg,in:CGRect(x:0,y:0,width:cg.width,height:cg.height))
    guard let ptr=ctx.data?.assumingMemoryBound(to:UInt8.self) else { throw ScanFailure.image }
    var channels=[Float](repeating:0,count:pixels*3), lum=[Double](repeating:0,count:pixels)
    for i in 0..<pixels {
      for c in 0..<3 { channels[c*pixels+i] = Float(ptr[4*i+c]) }
      lum[i] = (Double(ptr[4*i])+Double(ptr[4*i+1])+Double(ptr[4*i+2]))/3
    }
    let brightness=lum.reduce(0,+)/Double(pixels)
    var energy=0.0
    for y in 1..<(side-1) { for x in 1..<(side-1) {
      let i=y*side+x, lap=4*lum[i]-lum[i-1]-lum[i+1]-lum[i-side]-lum[i+side]
      energy += lap*lap
    } }
    if brightness < rules.quality.minBrightness { return ([],"dark") }
    if brightness > rules.quality.maxBrightness { return ([],"bright") }
    if energy/Double((side-2)*(side-2)) < rules.quality.minSharpness { return ([],"blur") }
    let bytes=channels.withUnsafeBytes { NSMutableData(bytes:$0.baseAddress,length:$0.count) }
    let data=try encoder.encode(bytes, side:side, input:cfg.input)
    let vector=data.withUnsafeBytes { Array($0.bindMemory(to:Float.self)) }
    let length=sqrt(vector.reduce(0){ $0+$1*$1 })
    guard length.isFinite && length > 0 else { throw ScanFailure.quality }
    return (vector.map{$0/length},nil)
  }
}

public class LookLanVisionModule: Module {
  private var models: LocalModels?
  private let inference = DispatchQueue(label:"looklancare.vision")
  public func definition() -> ModuleDefinition {
    Name("LookLanVision")
    AsyncFunction("inspect") { (encoded: String, bodies: Bool, faces: Bool) -> [String:Any] in
      let engine = try self.models ?? LocalModels()
      self.models = engine
      return try engine.inspect(encoded, includeBodies:bodies, useFaces:faces)
    }.runOnQueue(inference)
  }
}
