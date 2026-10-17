const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Android 16 (targetSdk 36) turns predictive back on by default: the system stops sending the
 * back button to Activity.onBackPressed, which is what React Native 0.79 relies on — so every
 * back press closed the app instead of going to the previous screen (and our BackHandler
 * listeners, e.g. order success → Home, never ran). Opting out restores normal back handling.
 * Remove once React Native handles OnBackInvokedCallback itself.
 */
module.exports = function withLegacyBackHandling(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (application) application.$['android:enableOnBackInvokedCallback'] = 'false';
    return cfg;
  });
};
