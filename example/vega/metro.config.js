const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

module.exports = mergeConfig(defaultConfig, {
  resolver: {
    // `m4s` is a fragmented-MP4 media segment and not in metro's default
    // assetExts; without it, requiring a segment is parsed as JavaScript.
    assetExts: [...defaultConfig.resolver.assetExts, 'm4s'],
  },
});
