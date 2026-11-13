const { withPodfile } = require('@expo/config-plugins');

const MARKER = '# Harmony Discover: ONNX Runtime quoted-framework-header runtime workaround';

module.exports = function withOnnxRuntimeQuotedHeaderWorkaround(config) {
  return withPodfile(config, (config) => {
    let podfile = config.modResults.contents;

    if (podfile.includes(MARKER)) {
      return config;
    }

    const postInstall = 'post_install do |installer|';
    if (!podfile.includes(postInstall)) {
      throw new Error('Harmony Discover ONNX Runtime workaround could not find the Podfile post_install hook.');
    }

    const workaround = [
      MARKER,
      "  onnxruntime_objc_target = installer.pods_project.targets.find { |target| target.name == 'onnxruntime-objc' }",
      "  raise 'Expected CocoaPods target onnxruntime-objc was not generated.' unless onnxruntime_objc_target",
      '',
      '  onnxruntime_objc_target.build_configurations.each do |build_config|',
      "    build_config.build_settings['CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER'] = 'NO'",
      '  end',
      '',
    ].join('\\n');

    podfile = podfile.replace(postInstall, postInstall + '\\n' + workaround);
    config.modResults.contents = podfile;
    return config;
  });
};
