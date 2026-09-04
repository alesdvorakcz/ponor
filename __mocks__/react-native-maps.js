// Manual Jest mock for the native `react-native-maps` package.
//
// **Why it has to exist at all.** The real module is native on both counts: `MapView` and every
// overlay reach `requireNativeComponent`, and `src/specs/*` call `codegenNativeComponent` /
// `codegenNativeCommands` at MODULE SCOPE. Under Jest neither resolves to anything renderable,
// so a screen that imports the package cannot be mounted — which would leave the Map tab as the
// one screen in this app with no test at all.
//
// **What it is NOT, and this is the part worth reading before trusting a green suite.** A mocked
// map draws nothing, measures nothing and reports no gestures. Everything the real component
// decides is absent here: whether a marker is legible over water, whether its tap target is the
// 48 dp §0.5 requires, whether the region actually frames the pins, whether Apple's cartography
// renders at all. `components/DiveMap.tsx`'s own docblock lists which claims this file's tests
// carry and which only a simulator can settle — read it rather than counting tests.
//
// What it DOES buy is the half the app owns: the props Ponor hands the library. `MapView` and
// `Marker` render as ordinary views with their props intact, so a test can assert the region
// computed for a logbook, the coordinate under each pin, the badge inside it, and that pressing
// one selects the right site. Those are our rules; the rest is Apple's.
//
// Modelled on `__mocks__/expo-sqlite.js` next door — a manual mock for a node_modules package,
// picked up automatically with no `jest.mock()` call at any call site. Do not grow it into a
// pretend map: a fake that answers layout questions would be a fake that answers them wrongly,
// and the simulator pass is what those questions have.
const React = require('react');
const { View } = require('react-native');

// `testID`/`accessibilityLabel` and children pass straight through, so the rendered tree carries
// whatever the app put on them. The map itself is a plain container; each marker is a plain view
// wrapping whatever the app drew inside it, with `onPress` left exactly as handed in.
const MapView = React.forwardRef(function MapView(props, ref) {
  return React.createElement(View, { ...props, ref });
});

function Marker(props) {
  return React.createElement(View, props);
}

module.exports = {
  __esModule: true,
  default: MapView,
  MapView,
  Marker,
  MapMarker: Marker,
  PROVIDER_DEFAULT: undefined,
  PROVIDER_GOOGLE: 'google',
};
