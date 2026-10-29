// Web stand-in for react-native-fbsdk-next (native only).
const noop = () => {};
module.exports = { Settings: { setAppID: noop, setClientToken: noop, initializeSDK: noop, setAdvertiserTrackingEnabled: () => Promise.resolve(false) }, AppEventsLogger: { logEvent: noop, logPurchase: noop } };
