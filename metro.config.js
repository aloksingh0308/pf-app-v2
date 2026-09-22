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

module.exports = config;
