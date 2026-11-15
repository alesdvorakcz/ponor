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

function site(id: string, name: string): DiveSite {
  return { id, name, status: 'active', mergedInto: null } as unknown as DiveSite;
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
    listSites.mockResolvedValue([site('s-local', 'Kotelna'), site('s-other', 'Zátoka')]);
    askServer.mockResolvedValue(
      answer([
        { value: 'Kotelna', id: 's-local' },
        { value: 'Kotelna 2', id: 's-far' },
      ]),
    );

    const twins = await findSiteTwins('kotelna', { latitude: 49.75, longitude: 14.36 });

    expect(askServer).toHaveBeenCalledWith(expect.anything(), 'kotelna', 49.75, 14.36);
    expect(twins.map((s) => s.id)).toEqual(['s-local', 's-far']);
  });

  it('asks the server with no point when there is none', async () => {
    listSites.mockResolvedValue([]);
    askServer.mockResolvedValue(answer([]));

    await findSiteTwins('Kotelna', null);

    expect(askServer).toHaveBeenCalledWith(expect.anything(), 'Kotelna', null, null);
  });

  it('answers [] when the device read throws', async () => {
    listSites.mockRejectedValue(new Error('disk'));
    askServer.mockResolvedValue(answer([{ value: 'Kotelna', id: 's-far' }]));

    await expect(findSiteTwins('Kotelna', null)).resolves.toEqual([]);
  });

  // A tap on a match pairs the dive with it, so the match has to be a site the phone holds: the
  // server's rows are written first, the way live search writes its answers.
  it('writes the server’s rows to the device before offering them', async () => {
    listSites.mockResolvedValue([]);
    askServer.mockResolvedValue(answer([{ value: 'Kotelna 2', id: 's-far' }]));

    const twins = await findSiteTwins('kotelna', null);

    expect(storeSites).toHaveBeenCalledWith(expect.anything(), [pulled('s-far', 'Kotelna 2')]);
    expect(twins.map((s) => s.id)).toEqual(['s-far']);
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

    const twins = await findSiteTwins('kotelna', null);

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

    const twins = await findSiteTwins('kotelna', null);

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
      void findSiteTwins('kotelna', null).then((found) => {
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
});
