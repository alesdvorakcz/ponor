import { createDiveCenter, createDiveSite, listDiveSites } from '../db/catalogue';
import { type DiveSite } from '../domain/types';
import { countryFor } from '../platform/geocode';
import { addCenter, addSite, findSiteTwins } from './addToCatalogue';
import { similarSites } from './similarSites';

// The collaborators are mocked at the boundaries the form's own test mocks them at, for the same
// reasons: `db` and the network are not this file's. What is asserted here is the orchestration —
// what is asked, in what order, and what is written with what — and `nearMatches` is left REAL
// because what counts as a near-match is what the first tests are about.
jest.mock('../db/client', () => ({ db: {} }));
jest.mock('./supabase', () => ({ cloud: { configured: true } }));
jest.mock('../db/catalogue', () => ({
  createDiveSite: jest.fn(),
  createDiveCenter: jest.fn(),
  listDiveSites: jest.fn(),
}));
jest.mock('./similarSites', () => ({ similarSites: jest.fn() }));
jest.mock('../platform/geocode', () => ({ countryFor: jest.fn() }));

const listSites = jest.mocked(listDiveSites);
const askServer = jest.mocked(similarSites);
const makeSite = jest.mocked(createDiveSite);
const makeCenter = jest.mocked(createDiveCenter);
const country = jest.mocked(countryFor);

function site(id: string, name: string): DiveSite {
  return { id, name, status: 'active', mergedInto: null } as unknown as DiveSite;
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
    askServer.mockResolvedValue([
      { value: 'Kotelna', id: 's-local' },
      { value: 'Kotelna 2', id: 's-far' },
    ]);

    const twins = await findSiteTwins('kotelna', { latitude: 49.75, longitude: 14.36 });

    expect(askServer).toHaveBeenCalledWith(expect.anything(), 'kotelna', 49.75, 14.36);
    expect(twins.map((s) => s.id)).toEqual(['s-local', 's-far']);
  });

  it('asks the server with no point when there is none', async () => {
    listSites.mockResolvedValue([]);
    askServer.mockResolvedValue([]);

    await findSiteTwins('Kotelna', null);

    expect(askServer).toHaveBeenCalledWith(expect.anything(), 'Kotelna', null, null);
  });

  it('answers [] when the device read throws', async () => {
    listSites.mockRejectedValue(new Error('disk'));
    askServer.mockResolvedValue([{ value: 'Kotelna', id: 's-far' }]);

    await expect(findSiteTwins('Kotelna', null)).resolves.toEqual([]);
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
});
