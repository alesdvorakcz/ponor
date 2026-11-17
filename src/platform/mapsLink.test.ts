import { mapsSearchUrl, mapsUrl } from './mapsLink';

// The dive detail's "Show on map" card (issue #3) hands a position to the device's own maps.
// Each platform has its own way of being asked, and a wrong one is not an error anywhere — the
// press just opens nothing, or opens the right app on the wrong place — so each URL is pinned
// as a literal rather than rebuilt here from the same pieces the function uses.
const blueHole = { latitude: 43.0378, longitude: 16.1489 };

describe('mapsUrl', () => {
  it('asks Apple Maps for the point on iOS, named', () => {
    expect(mapsUrl(blueHole, 'Blue Hole', 'ios')).toBe('https://maps.apple.com/?ll=43.0378,16.1489&q=Blue%20Hole');
  });

  it('asks for a geo: point on Android, with the name as its label', () => {
    expect(mapsUrl(blueHole, 'Blue Hole', 'android')).toBe('geo:43.0378,16.1489?q=43.0378,16.1489(Blue%20Hole)');
  });

  it('opens OpenStreetMap on the web, which needs no key and no account', () => {
    expect(mapsUrl(blueHole, 'Blue Hole', 'web')).toBe(
      'https://www.openstreetmap.org/?mlat=43.0378&mlon=16.1489#map=15/43.0378/16.1489',
    );
  });

  // A site name is the diver's own text, and Czech puts characters in it a URL cannot carry
  // raw; `&` in a name would otherwise end the query and drop the rest of it.
  it('encodes a name a URL cannot carry as typed', () => {
    expect(mapsUrl(blueHole, 'Lom & Kovářov', 'ios')).toBe(
      'https://maps.apple.com/?ll=43.0378,16.1489&q=Lom%20%26%20Kov%C3%A1%C5%99ov',
    );
  });

  // West and south are negative, and the sign is the whole difference between two oceans.
  it('keeps the sign of a western, southern point', () => {
    expect(mapsUrl({ latitude: -8.4095, longitude: -115.1889 }, 'Reef', 'ios')).toBe(
      'https://maps.apple.com/?ll=-8.4095,-115.1889&q=Reef',
    );
  });
});

describe('mapsSearchUrl', () => {
  it('asks each platform’s maps to search for the text', () => {
    expect(mapsSearchUrl('Otok Vis, Kut 12', 'ios')).toBe('https://maps.apple.com/?q=Otok%20Vis%2C%20Kut%2012');
    expect(mapsSearchUrl('Otok Vis, Kut 12', 'android')).toBe('geo:0,0?q=Otok%20Vis%2C%20Kut%2012');
    expect(mapsSearchUrl(' Otok Vis, Kut 12 ', 'web')).toBe(
      'https://www.openstreetmap.org/search?query=Otok%20Vis%2C%20Kut%2012',
    );
  });

  it('encodes an & so it cannot end the query', () => {
    expect(mapsSearchUrl('Bar & Grill', 'ios')).toBe('https://maps.apple.com/?q=Bar%20%26%20Grill');
  });
});
