const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Inline requires: defers evaluation of each module until it is first used.
// This is the single biggest win for Android startup time — the JS engine
// doesn't have to parse/execute every imported module before the first screen
// is rendered. Facebook reported ~25% startup improvement with this on large apps.
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
};

// Web only: react-native-image-viewing ships ImageItem as .ios/.android files with no
// plain version, so the web bundle can't resolve it — use the Android one (plain RN).
// Native-only modules are swapped for small no-op stand-ins in web-stubs/ (no ads, maps
// shown as a placeholder) so the app can be run in a browser for testing.
const WEB_STUBS = {
  'react-native-google-mobile-ads': 'google-mobile-ads.js',
  'react-native-maps': 'maps.js',
  'react-native-fbsdk-next': 'fbsdk-next.js',
  'react-native-play-install-referrer': 'play-install-referrer.js',
};
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBS[moduleName]) {
    return { type: 'sourceFile', filePath: require('path').join(__dirname, 'web-stubs', WEB_STUBS[moduleName]) };
  }
  if (platform === 'web' && moduleName === './components/ImageItem/ImageItem' && context.originModulePath.includes('react-native-image-viewing')) {
    return context.resolveRequest(context, './components/ImageItem/ImageItem.android', platform);
  }
  return defaultResolveRequest ? defaultResolveRequest(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
