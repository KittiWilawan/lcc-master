require 'fileutils'
root = File.expand_path('../../..', __dir__)
assets = File.join(root, 'android/app/src/main/assets')
resources = File.join(__dir__, 'Resources')
FileUtils.mkdir_p(resources)
files = %w[monitoring/pose_landmarker_full.task enrollment/face_landmarker.task enrollment/security/sface.onnx enrollment/model.json]
files.each { |name| FileUtils.cp(File.join(assets, name), resources) }
FileUtils.cp(File.join(root, 'src/config/faceScan.json'), resources)

Pod::Spec.new do |s|
  s.name = 'LookLanVision'
  s.version = '1.0.0'
  s.summary = 'On-device vision for LookLanCare'
  s.license = 'MIT'
  s.author = 'LookLanCare'
  s.homepage = 'https://github.com/expo/expo'
  s.source = { :path => '.' }
  s.platform = :ios, '16.0'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'MediaPipeTasksVision', '0.10.21'
  s.dependency 'onnxruntime-objc', '1.24.3'
  s.source_files = '*.{swift,h,m}'
  s.resource_bundles = { 'LookLanModels' => ['Resources/*'] }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
