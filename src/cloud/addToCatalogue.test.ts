import { applyPulledDiveSites, createDiveCenter, createDiveSite, listDiveSites, type PulledSite } from '../db/catalogue';
import { type Suggestion } from '../domain/suggest';
import { type DiveSite } from '../domain/types';
import { countryFor } from '../platform/geocode';
import { addCenter, addSite, findSiteTwins, TWIN_CHECK_TIMEOUT_MS } from './addToCatalogue';
import { similarSites } from './similarSites';

// The collaborators are mocked at the boundaries the form's own test mocks them at, for the same
// reasons: `db` and the network are not this file's. What is asserted here is the orchestration —
// what is asked, in what order, and what is written with what — and `nearMatches` is left REAL
// because what counts as a near-match is what the first tests are about.
jest.mock('../db/client', () => ({ db: {} }));
jest.mock('./supabase', () => ({ cloud: { configured: true } }));
jest.mock('../db/catalogue', () => ({
  applyPulledDiveSites: jest.fn(),
  createDiveSite: jest.fn(),
  createDiveCenter: jest.fn(),
  listDiveSites: jest.fn(),
}));
jest.mock('./similarSites', () => ({ similarSites: jest.fn() }));
jest.mock('../platform/geocode', () => ({ countryFor: jest.fn() }));

const listSites = jest.mocked(listDiveSites);
const storeSites = jest.mocked(applyPulledDiveSites);
const askServer = jest.mocked(similarSites);
const makeSite = jest.mocked(createDiveSite);
const makeCenter = jest.mocked(createDiveCenter);
const country = jest.mocked(countryFor);

function site(id: string, name: string, over: Partial<DiveSite> = {}): DiveSite {
  return {
    id,
    name,
    country: null,
    latitude: null,
    longitude: null,
    status: 'active',
    mergedInto: null,
    ...over,
  } as unknown as DiveSite;
}

/** A whole row the server sent, as `similarSites` hands it back for storing. */
function pulled(id: string, name: string): PulledSite {
  return { id, name } as unknown as PulledSite;
}

/** The server's answer: the matches, and the rows whole — every match storable unless told. */
function answer(matches: Suggestion[], rows: PulledSite[] = matches.map((m) => pulled(m.id ?? '', m.value))) {
  return { matches, rows };
}

const NO_FACTS = { entry: null, salinity: null, waterBody: null };

beforeEach(() => {
  jest.resetAllMocks();
  makeSite.mockResolvedValue({ id: 'new-site' } as unknown as DiveSite);
  makeCenter.mockResolvedValue({ id: 'new-center' } as never);
  country.mockResolvedValue(null);
});

describe('findSiteTwins', () => {
  it("joins the device's exact folded match and the server's near matches, device first, no duplicates", async () => {
    const onDevice = [site('s-local', 'Kotelna'), site('s-other', 'Zátoka')];
    // The read before the server's rows are written, then the read back after it.
    listSites.mockResolvedValueOnce(onDevice).mockResolvedValueOnce([...onDevice, site('s-far', 'Kotelna 2')]);
    askServer.mockResolvedValue(
      answer([
        { value: 'Kotelna', id: 's-local' },
        { value: 'Kotelna 2', id: 's-far' },
      ]),
    );

    const twins = await findSiteTwins('kotelna', [], { latitude: 49.75, longitude: 14.36 });

    expect(askServer).toHaveBeenCalledWith(expect.anything(), 'kotelna', [], 49.75, 14.36);
    expect(twins.map((s) => s.id)).toEqual(['s-local', 's-far']);
  });

  it('asks the server with no point when there is none', async () => {
    listSites.mockResolvedValue([]);
    askServer.mockResolvedValue(answer([]));

    await findSiteTwins('Kotelna', [], null);

    expect(askServer).toHaveBeenCalledWith(expect.anything(), 'Kotelna', [], null, null);
  });

  it('answers [] when the device read throws', async () => {
    listSites.mockRejectedValue(new Error('disk'));
    askServer.mockResolvedValue(answer([{ value: 'Kotelna', id: 's-far' }]));

    await expect(findSiteTwins('Kotelna', [], null)).resolves.toEqual([]);
  });

  // *Use this site* on a match's page pairs the dive with it, so the match has to be a site the
  // phone holds: the server's rows are written first, the way live search writes its answers.
  it('writes the server’s rows to the device before offering them', async () => {
    listSites.mockResolvedValueOnce([]).mockResolvedValueOnce([site('s-far', 'Kotelna 2')]);
    askServer.mockResolvedValue(answer([{ value: 'Kotelna 2', id: 's-far' }]));

    const twins = await findSiteTwins('kotelna', [], null);

    expect(storeSites).toHaveBeenCalledWith(expect.anything(), [pulled('s-far', 'Kotelna 2')]);
    // Read back after the write, so what is offered is what the phone holds.
    expect(listSites).toHaveBeenCalledTimes(2);
    expect(storeSites.mock.invocationCallOrder[0]).toBeLessThan(listSites.mock.invocationCallOrder[1] ?? 0);
    expect(twins.map((s) => s.id)).toEqual(['s-far']);
  });

  // `applyPulledRows` lands a row only where it may safely replace what is here; the read back is
  // what says whether the phone holds it.
  it('does not offer a written match the phone still does not hold', async () => {
    listSites.mockResolvedValue([]);
    askServer.mockResolvedValue(answer([{ value: 'Kotelna 2', id: 's-far' }]));

    const twins = await findSiteTwins('kotelna', [], null);

    expect(storeSites).toHaveBeenCalled();
    expect(twins).toEqual([]);
  });

  it('offers only what the phone held when the read back fails', async () => {
    listSites.mockResolvedValueOnce([site('s-local', 'Kotelna')]).mockRejectedValueOnce(new Error('disk'));
    askServer.mockResolvedValue(
      answer([
        { value: 'Kotelna', id: 's-local' },
        { value: 'Kotelna 2', id: 's-far' },
      ]),
    );

    const twins = await findSiteTwins('kotelna', [], null);

    expect(twins.map((s) => s.id)).toEqual(['s-local']);
  });

  // The create page shows each match's country and how far it is, so a diver can judge it there
  // (owner's call, PR #35): both are the phone's own row's — the row a tap opens.
  it('carries the phone’s row’s country and position with each match', async () => {
    const local = site('s-local', 'Kotelna', { country: 'CZ', latitude: 49.75, longitude: 14.36 });
    listSites
      .mockResolvedValueOnce([local])
      .mockResolvedValueOnce([local, site('s-far', 'Kotelna 2', { country: '', latitude: 49.8, longitude: null })]);
    askServer.mockResolvedValue(answer([{ value: 'Kotelna 2', id: 's-far' }]));

    const twins = await findSiteTwins('kotelna', [], null);

    expect(twins).toEqual([
      {
        value: 'Kotelna',
        id: 's-local',
        country: 'CZ',
        point: { latitude: 49.75, longitude: 14.36 },
        relation: { kind: 'sameName' },
      },
      // An empty country is none, and half a position is no position.
      { value: 'Kotelna 2', id: 's-far', country: null, point: null, relation: { kind: 'similar' } },
    ]);
  });

  // #31: the device's exact check reads a row's other names too, and the match says how the two
  // relate — read off the phone's own row, the one a tap opens — so the page can word it.
  it('offers a site whose other name is the name typed, saying how they relate', async () => {
    listSites.mockResolvedValue([
      site('s-stone', 'Stone Gate', { altNames: ['Kamena Vrata'] }),
      site('s-other', 'Silfra'),
    ]);
    askServer.mockResolvedValue(answer([]));

    const twins = await findSiteTwins('Kamena vrata', [], null);

    expect(twins).toEqual([
      {
        value: 'Stone Gate',
        id: 's-stone',
        country: null,
        point: null,
        relation: { kind: 'otherName', alias: 'Kamena Vrata', name: 'Stone Gate' },
      },
    ]);
  });

  // The other way round, at sea: an other name typed is the name of a site the phone holds, and no
  // server answers — so it is the device's own check that has to be handed the other names.
  it('offers a site the phone holds whose name is an other name typed', async () => {
    listSites.mockResolvedValue([site('s-kamena', 'Kamena vrata'), site('s-other', 'Silfra')]);
    askServer.mockResolvedValue(answer([]));

    const twins = await findSiteTwins('Stone Gate', ['Kamena vrata'], null);

    expect(twins.map((twin) => [twin.id, twin.relation])).toEqual([
      ['s-kamena', { kind: 'otherName', alias: 'Kamena vrata', name: 'Stone Gate' }],
    ]);
  });

  // ...and on the server's half: the other names go with the question, and the row the server finds
  // by one of them is offered once the phone holds it.
  it('asks the server with the other names as well', async () => {
    listSites.mockResolvedValueOnce([]).mockResolvedValueOnce([site('s-kamena', 'Kamena vrata')]);
    askServer.mockResolvedValue(answer([{ value: 'Kamena vrata', id: 's-kamena' }]));

    const twins = await findSiteTwins('Stone Gate', ['Kamena vrata'], { latitude: 43.06, longitude: 16.18 });

    expect(askServer).toHaveBeenCalledWith(expect.anything(), 'Stone Gate', ['Kamena vrata'], 43.06, 16.18);
    expect(twins.map((twin) => [twin.id, twin.relation])).toEqual([
      ['s-kamena', { kind: 'otherName', alias: 'Kamena vrata', name: 'Stone Gate' }],
    ]);
  });

  it('does not offer a server match whose row could not be stored, unless the phone already holds it', async () => {
    listSites.mockResolvedValue([site('s-local', 'Kotelna')]);
    askServer.mockResolvedValue(
      answer(
        [
          { value: 'Kotelna', id: 's-local' },
          { value: 'Kotelna 2', id: 's-unreadable' },
        ],
        [],
      ),
    );

    const twins = await findSiteTwins('kotelna', [], null);

    expect(storeSites).not.toHaveBeenCalled();
    expect(twins.map((s) => s.id)).toEqual(['s-local']);
  });

  it('offers only what the phone held when the write refuses', async () => {
    listSites.mockResolvedValue([site('s-local', 'Kotelna')]);
    askServer.mockResolvedValue(
      answer([
        { value: 'Kotelna', id: 's-local' },
        { value: 'Kotelna 2', id: 's-far' },
      ]),
    );
    storeSites.mockRejectedValue(new Error('disk full'));

    const twins = await findSiteTwins('kotelna', [], null);

    expect(twins.map((s) => s.id)).toEqual(['s-local']);
  });

  // Weak signal: the request is out and nothing comes back. The Supabase client sets no fetch
  // timeout, so without a bound of its own Save would read *Saving…* for as long as the OS lets a
  // socket hang — and every site on a dive is now made through this check.
  describe('when the server never answers', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('answers the device’s matches once TWIN_CHECK_TIMEOUT_MS has passed', async () => {
      listSites.mockResolvedValue([site('s-local', 'Kotelna')]);
      askServer.mockReturnValue(new Promise(() => {}));

      let answer: Suggestion[] | undefined;
      void findSiteTwins('kotelna', [], null).then((found) => {
        answer = found;
      });

      await jest.advanceTimersByTimeAsync(TWIN_CHECK_TIMEOUT_MS - 1);
      expect(answer).toBeUndefined();
      await jest.advanceTimersByTimeAsync(1);
      expect(answer?.map((s) => s.id)).toEqual(['s-local']);
    });
  });
});

describe('addSite', () => {
  it('stamps the country before the insert', async () => {
    country.mockResolvedValue('HR');

    const id = await addSite({ name: 'Kotelna', latitude: 45.1, longitude: 14.2, ...NO_FACTS });

    expect(country).toHaveBeenCalledWith(45.1, 14.2);
    expect(makeSite).toHaveBeenCalledTimes(1);
    expect(makeSite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'Kotelna', country: 'HR' }));
    expect(id).toBe('new-site');
  });

  it('without a pin creates with country null', async () => {
    await addSite({ name: 'Kotelna', latitude: null, longitude: null, ...NO_FACTS });

    expect(makeSite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ country: null }));
  });

  it('rejects when the write fails', async () => {
    makeSite.mockRejectedValue(new Error('disk'));

    await expect(addSite({ name: 'Kotelna', latitude: null, longitude: null, ...NO_FACTS })).rejects.toThrow('disk');
  });

  // The create page has already asked about the position it shows; asking again on Save cost a
  // second geocode — up to four more seconds of *Saving…* offline — for the answer on screen.
  it('takes a country already looked up for the same point, and asks nothing', async () => {
    await addSite(
      { name: 'Kotelna', latitude: 45.1, longitude: 14.2, ...NO_FACTS },
      { latitude: 45.1, longitude: 14.2, country: 'HR' },
    );

    expect(country).not.toHaveBeenCalled();
    expect(makeSite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ country: 'HR' }));
  });

  // `null` is an answer too: the page shows `—`, and the row is saved as shown.
  it('takes a known "no country" for the same point as it is', async () => {
    country.mockResolvedValue('HR');

    await addSite(
      { name: 'Kotelna', latitude: 45.1, longitude: 14.2, ...NO_FACTS },
      { latitude: 45.1, longitude: 14.2, country: null },
    );

    expect(country).not.toHaveBeenCalled();
    expect(makeSite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ country: null }));
  });

  it('asks for itself when the known answer is about another point', async () => {
    country.mockResolvedValue('SI');

    await addSite(
      { name: 'Kotelna', latitude: 45.1, longitude: 14.2, ...NO_FACTS },
      { latitude: 46.0, longitude: 14.5, country: 'HR' },
    );

    expect(country).toHaveBeenCalledWith(45.1, 14.2);
    expect(makeSite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ country: 'SI' }));
  });

  // Issue #31: what the create page asks beyond the three a dive hands on travels beside them
  // (`NewSiteDetails` — `NewSiteFacts` stays the three site defaults) and lands in the row.
  it('carries a site’s details into the row it makes', async () => {
    await addSite({
      name: 'Vrak Teti',
      latitude: null,
      longitude: null,
      ...NO_FACTS,
      description: 'A steamer on the southern spur.',
      siteTypes: ['wreck'],
      suitableFor: 'advanced',
      maxDepthM: 34,
      wreckName: 'Teti',
      wreckSunkYear: 1930,
      altNames: ['Teti wreck'],
    });

    expect(makeSite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        description: 'A steamer on the southern spur.',
        siteTypes: ['wreck'],
        suitableFor: 'advanced',
        maxDepthM: 34,
        wreckName: 'Teti',
        wreckSunkYear: 1930,
        altNames: ['Teti wreck'],
      }),
    );
  });
});

describe('addCenter', () => {
  it('derives the country from its own pin and keeps the website', async () => {
    country.mockResolvedValue('EG');

    const id = await addCenter({ name: 'Blue Hole Divers', latitude: 28.57, longitude: 34.54, website: 'https://example.test' });

    expect(country).toHaveBeenCalledWith(28.57, 34.54);
    expect(makeCenter).toHaveBeenCalledWith(expect.anything(), {
      name: 'Blue Hole Divers',
      latitude: 28.57,
      longitude: 34.54,
      website: 'https://example.test',
      country: 'EG',
    });
    expect(id).toBe('new-center');
  });

  it('has no country without a pin', async () => {
    await addCenter({ name: 'Shop', latitude: null, longitude: null, website: null });

    expect(makeCenter).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ country: null }));
  });

  it('takes a country already looked up for its own pin, and asks nothing', async () => {
    await addCenter(
      { name: 'Blue Hole Divers', latitude: 28.57, longitude: 34.54, website: null },
      { latitude: 28.57, longitude: 34.54, country: 'EG' },
    );

    expect(country).not.toHaveBeenCalled();
    expect(makeCenter).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ country: 'EG' }));
  });

  it('asks for itself when the known answer is about another point', async () => {
    country.mockResolvedValue('EG');

    await addCenter(
      { name: 'Blue Hole Divers', latitude: 28.57, longitude: 34.54, website: null },
      { latitude: 27.9, longitude: 34.3, country: 'XX' },
    );

    expect(country).toHaveBeenCalledWith(28.57, 34.54);
    expect(makeCenter).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ country: 'EG' }));
  });

  it('carries a centre’s contact and services into the row it makes', async () => {
    await addCenter({
      name: 'Nautica Vis',
      latitude: null,
      longitude: null,
      website: 'https://nautica-vis.example',
      address: 'Otok Vis, Kut 12',
      phone: '+385 21 555 0123',
      email: 'dive@nautica-vis.example',
      openingHours: 'Daily 8–18, closed Nov–Mar',
      description: 'Family centre in Kut bay.',
      services: ['air', 'nitrox'],
      agencies: ['padi', 'other'],
    });

    expect(makeCenter).toHaveBeenCalledWith(expect.anything(), {
      name: 'Nautica Vis',
      latitude: null,
      longitude: null,
      website: 'https://nautica-vis.example',
      address: 'Otok Vis, Kut 12',
      phone: '+385 21 555 0123',
      email: 'dive@nautica-vis.example',
      openingHours: 'Daily 8–18, closed Nov–Mar',
      description: 'Family centre in Kut bay.',
      services: ['air', 'nitrox'],
      agencies: ['padi', 'other'],
      country: null,
    });
  });
});
