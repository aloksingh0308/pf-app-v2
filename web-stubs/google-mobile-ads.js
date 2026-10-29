// Web stand-in for react-native-google-mobile-ads (native only): no ads in the browser.
const noop = () => {};
const fakeAd = () => ({ addAdEventListener: () => noop, load: noop, show: () => Promise.resolve(), loaded: false });
module.exports = {
  BannerAd: () => null,
  BannerAdSize: new Proxy({}, { get: (_t, key) => String(key) }),
  TestIds: { BANNER: '', INTERSTITIAL: '', REWARDED: '', APP_OPEN: '' },
  AdEventType: { LOADED: 'loaded', CLOSED: 'closed', ERROR: 'error', OPENED: 'opened', CLICKED: 'clicked' },
  RewardedAdEventType: { LOADED: 'rewarded_loaded', EARNED_REWARD: 'rewarded_earned_reward' },
  InterstitialAd: { createForAdRequest: fakeAd },
  RewardedAd: { createForAdRequest: fakeAd },
  default: () => ({ initialize: () => Promise.resolve([]), setRequestConfiguration: () => Promise.resolve() }),
};
