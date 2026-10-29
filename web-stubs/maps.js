// Web stand-in for react-native-maps (native only): a grey box where the map would be.
const React = require('react');
const { View, Text } = require('react-native');
const MapView = React.forwardRef(({ style }, _ref) =>
  React.createElement(View, { style: [{ backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center', minHeight: 160 }, style] },
    React.createElement(Text, { style: { color: '#6b7280' } }, 'Map is shown in the mobile app')));
const Nothing = () => null;
module.exports = { __esModule: true, default: MapView, Marker: Nothing, Polyline: Nothing, Circle: Nothing, Callout: Nothing, PROVIDER_GOOGLE: 'google', PROVIDER_DEFAULT: null };
