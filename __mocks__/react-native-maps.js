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
//
// **The one thing this stand-in models rather than passes through is WHERE THE CAMERA IS**, added
// in M3l for the refit and deliberately kept to bookkeeping. It is not a layout answer and could
// not become one: the camera is wherever the app last put it (`animateToRegion`) or wherever the
// map last reported it settled (`onRegionChangeComplete`), and both of those are the app's own
// side of the boundary — one is a command this repo issues, the other a callback this repo wires.
// It is exposed as `__camera` on the rendered view, spelled so that nobody mistakes it for a prop
// of the real `MapView`, and it starts at `initialRegion`, which is exactly what the real map
// opens on.
//
// **What it still refuses to be:** a map. It does not animate, so a test sees the destination the
// instant it is asked for rather than 400 ms of flight; it does not fire `onRegionChangeComplete`
// after a programmatic move, which a real `MKMapView` does; and it knows nothing about pixels, so
// "is this mark visible" remains a question only the simulator can answer. `MapScreen` does not
// lean on the callback a real map would send after its own move — it records the destination when
// it issues the command — which is why leaving that out costs nothing here.
const MapView = React.forwardRef(function MapView(props, ref) {
  // **`initialRegion` is read once and every later value of it is ignored** — the real prop's
  // whole nature, and the fact the M3l defect was made of, so a stand-in that re-read it on every
  // render would quietly make a broken screen look fixed.
  const opened = React.useRef(props.initialRegion);
  const [camera, setCamera] = React.useState(null);
  // The duration is dropped rather than forwarded to `setCamera`: nothing here animates, and a
  // React setter reads a second argument as nothing at all — so passing it on would be a line
  // that looks like it does something.
  React.useImperativeHandle(ref, () => ({ animateToRegion: (region) => setCamera(region) }), []);
  const settled = (region, details) => {
    setCamera(region);
    if (props.onRegionChangeComplete) props.onRegionChangeComplete(region, details);
  };
  return React.createElement(View, {
    ...props,
    onRegionChangeComplete: settled,
    __camera: camera ?? opened.current,
  });
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
