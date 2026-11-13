Pod::Spec.new do |s|
  s.name           = 'DiscoverARKit'
  s.version        = '0.1.0'
  s.summary        = 'Native ARKit tracking, depth, and background liquid analysis for Harmony Discover.'
  s.description    = 'A local Expo module for ARKit tracking, depth capabilities, and background bottle liquid-level analysis.'
  s.author         = 'Harmony Discover'
  s.homepage       = 'https://github.com/robsloma-sudo/Harmony-Discover'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/robsloma-sudo/Harmony-Discover.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # Research spike only: native D-FINE inference with CPU + CoreML execution providers.
  s.dependency 'onnxruntime-objc', '1.32.0'
  s.source_files = '**/*.{h,m,mm,swift}'
end
