Pod::Spec.new do |s|
  s.name           = 'DiscoverARKit'
  s.version        = '0.1.0'
  s.summary        = 'Native ARKit capability diagnostics for Harmony Discover.'
  s.description    = 'A local Expo module that reports runtime ARKit tracking, depth and mesh capabilities.'
  s.author         = 'Harmony Discover'
  s.homepage       = 'https://github.com/robsloma-sudo/Harmony-Discover'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/robsloma-sudo/Harmony-Discover.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
