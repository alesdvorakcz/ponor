import { applyPulledDiveSites, createDiveCenter, createDiveSite, listDiveSites } from '../db/catalogue';
import { db } from '../db/client';
import { type NewSiteFacts } from '../domain/diveFormSchema';
import { pointOf, type MapPoint } from '../domain/mapSites';
import { nearMatches, twinRelation, type Suggestion, type TwinRelation } from '../domain/suggest';
import { type Agency, type DiveSite, type Service } from '../domain/types';
import { countryFor, countryForAddress } from '../platform/geocode';
import { withTimeout } from '../platform/withTimeout';
import { similarSites } from './similarSites';
import { cloud } from './supabase';

/**
 * **The catalogue's writes and its duplicate check, owned in one place** — they lived inside
 * `DiveFormScreen` until the *New dive site* / *New dive centre* pages needed the same three
 * things without a dive form around them. Those pages are their callers, so "what a new row
 * holds" has one author.
 *
 * Every rule about what a row holds is still elsewhere: `siteFactsFrom` (domain/diveFormSchema.ts)
 * decides what a dive may tell a community record, `platform/geocode.ts` infers the country from
 * a pin and from nothing else (§2.3), and `db/catalogue.ts` writes the row — dirty, with a
 * client-generated UUIDv7, `status` active, and `created_by` left to `push_changes`, which stamps
 * `auth.uid()` and ignores whatever a client sent (§5, §6, §7).
 */

/**
 * **How long Save waits for the server's half of §2.3's check before going on without it.**
 *
 * `GEOCODE_TIMEOUT_MS`' four seconds, for that constant's reason: one round trip that has either
 * happened or is not going to, asked while the diver watches *Saving…*. Its own name because it
 * bounds a different question, and the two may part company. The Supabase client sets no fetch
 * timeout, so without this a request on weak signal holds Save for as long as the OS lets a
 * socket hang — and since issue #19 every site on a dive is made through this check, so that
 * would be logging itself held up (§1).
 */
export const TWIN_CHECK_TIMEOUT_MS = 4_000;

/**
 * **One of §2.3's near-matches, as the create page offers it** — the name and id a pick needs, and
 * the two facts that let a diver judge it without leaving the page: its country and where it is
 * (owner's call on PR #35, *"so he can check if it's really a duplicate"*). Both are the phone's own
 * row's, because the phone's row is what a tap opens and what the dive is then paired with.
 *
 * `relation` is how the match relates to the site being made (`twinRelation`, #31) — the same name,
 * another name for it, or only similar — read off that same row, so the page words each finding as
 * what it is and folds no name itself.
 */
export interface SiteTwin extends Suggestion {
  id: string;
  country: string | null;
  point: MapPoint | null;
  relation: TwinRelation;
}

/**
 * What a new centre holds. Issue #31's facts are optional, so a caller that has none — the create
 * page always has them, blank or not — writes the row as before; the table's own defaults (`null`,
 * `[]`) stand in for what is left out.
 */
export interface NewCenterInput {
  name: string;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  openingHours?: string | null;
  description?: string | null;
  services?: Service[];
  agencies?: Agency[];
}

/**
 * **What a new site holds beyond the three a dive hands it** (issue #31) — the create page's
 * description, its *The site* group's type, level, depth and wreck, and its other names.
 *
 * Its own type rather than more keys on `NewSiteFacts`, which cannot grow: `domain/siteDefaults.ts`
 * ties that type's keys, less the name and the pin, to exactly the three site defaults a site hands
 * a dive (§2.1), and none of these is one. So `addSite` takes the two together.
 */
export type NewSiteDetails = Partial<
  Pick<DiveSite, 'description' | 'siteTypes' | 'suitableFor' | 'maxDepthM' | 'altitudeM' | 'wreckName' | 'wreckSunkYear' | 'altNames'>
>;

/**
 * **§2.3's fuzzy check, run between the diver asking and the row existing** — *"before saving a
 * new entry, a fuzzy check suggests near-matches: **Did you mean Shark Point?**"* (M2p).
 *
 * Both sources, asked together (§5's "offline dedupe" and §2.3's fuzzy check are the same
 * question asked of two catalogues). `nearMatches` (domain/suggest.ts) owns what counts as one
 * and in what order; this owns only that both are asked and that the row's own pin and other
 * names go with the question — a name check across the whole world and a name check within the
 * function's own radius are different questions, and since #31 the check runs both ways: the name
 * against existing other names, and the other names (`altNames`, the list Save will write) against
 * existing names.
 *
 * `Promise.all`, so a device that is online pays one round trip rather than a round trip after a
 * database read; and `listDiveSites` reads the same `pickable` rows autocomplete would offer, so
 * a duplicate an admin has already merged away is never offered back as the survivor's rival.
 *
 * **It never throws, and `[]` means both "none" and "could not ask".** §1 in the direction this
 * whole feature has to hold in: the check is a by-product of the by-product. `similarSites`
 * already answers `[]` for every way of failing to reach a server; the `catch` covers the one
 * that is local, the device's own catalogue read, and gives the answer a diver at sea gets
 * anyway. Anything that escaped would strand the row mid-gesture with nothing on screen.
 *
 * **And it always comes back.** A server that never answers is the one failure `similarSites`
 * cannot turn into `[]`, so its half is raced against `TWIN_CHECK_TIMEOUT_MS`; out of time, the
 * device's matches stand alone — the answer a diver out of signal gets anyway.
 *
 * **It offers only sites the phone holds.** A match opens that site's page, whose *Use this site*
 * pairs the dive with it — a page that would read *Site not found* for a row the phone lacks, and a
 * dive paired with such a site shows no country, gets no site defaults and is missing from the
 * picker's *Dived here* until some later sync. So the server's rows are written
 * to the device's catalogue first (`applyPulledDiveSites`, as live search writes its answers —
 * clean, never over a local edit), the catalogue is read again, and a server match is offered only
 * when its row is on the phone in that read. A write — or a read back — that refuses leaves the
 * matches the phone already held.
 *
 * **Each match carries the phone's row's country, position and relation** (`SiteTwin`), from that
 * same read: the row a tap on it opens, and the one the dive is paired with.
 */
export async function findSiteTwins(name: string, altNames: readonly string[], at: MapPoint | null): Promise<SiteTwin[]> {
  try {
    const [onDevice, answer] = await Promise.all([
      listDiveSites(db),
      withTimeout(
        similarSites(cloud, name, altNames, at?.latitude ?? null, at?.longitude ?? null),
        TWIN_CHECK_TIMEOUT_MS,
      ),
    ]);
    let onPhone: readonly DiveSite[] = onDevice;
    if (answer !== null && answer.rows.length > 0) {
      try {
        await applyPulledDiveSites(db, answer.rows);
        onPhone = await listDiveSites(db);
      } catch {
        // Not written, or not read back: only the matches already on the phone are offered.
      }
    }
    const held = new Map(onPhone.map((site) => [site.id, site]));
    const fromServer = (answer?.matches ?? []).filter((match) => match.id !== null && held.has(match.id));
    return nearMatches(name, altNames, onDevice, fromServer).flatMap((match) => {
      const site = match.id === null ? undefined : held.get(match.id);
      if (site === undefined) return [];
      const country = site.country !== null && site.country !== '' ? site.country : null;
      const relation = twinRelation({ name, altNames }, site);
      return [{ value: match.value, id: site.id, country, point: pointOf(site), relation }];
    });
  } catch {
    return [];
  }
}

/**
 * **A country already looked up, and the point it is the answer for** — the create page's
 * *Country* row, which asked `countryFor` about the position on screen before Save was pressed.
 * Handed to `addSite` / `addCenter` so Save does not ask the geocoder the same question twice:
 * offline, that was up to `GEOCODE_TIMEOUT_MS` more of *Saving…* for an answer already on screen.
 * `country: null` is an answer too — the row then reads `—`, and is saved as it reads.
 */
export interface KnownCountry {
  latitude: number;
  longitude: number;
  country: string | null;
}

/**
 * The row's country: `known`'s answer when it is about **this very point**, `countryFor`'s
 * otherwise. The point travels with the answer and is checked here, so an answer about a position
 * since replaced can never be written to the row that replaced it, whoever hands it over.
 */
function countryAt(latitude: number | null, longitude: number | null, known: KnownCountry | undefined): Promise<string | null> {
  if (known !== undefined && known.latitude === latitude && known.longitude === longitude) {
    return Promise.resolve(known.country);
  }
  return countryFor(latitude, longitude);
}

/**
 * Makes the site and answers with its id — what a dive's `site_id` is then set to (§6's
 * pairing). A write failure **rejects**: the caller is the one that can say so on screen.
 * `NewSiteDetails` lands in the row as handed over; `createDiveSite` rounds the wreck's year, an
 * INTEGER column, as it rounds every one.
 */
export async function addSite(facts: NewSiteFacts & NewSiteDetails, known?: KnownCountry): Promise<string> {
  // Country is inferred from the row's own pin (§2.3), so this is awaited before the insert
  // rather than patched in afterwards: a second write would restamp `updated_at` on a row the
  // first one just created, which §7's last-push-wins is keyed on. It is bounded and it answers
  // `null` for every failure, so a site created on a boat with no signal is created — without a
  // country, and with the pin that is the evidence for one.
  const country = await countryAt(facts.latitude, facts.longitude, known);
  const created = await createDiveSite(db, { ...facts, country });
  return created.id;
}

/**
 * **A country already looked up from an address, and the address it is the answer for** — the
 * centre's create page asks `countryForAddress` when the diver leaves the Address box. Checked
 * against the trimmed address at Save, so an answer about text since edited is never written.
 */
export interface KnownAddressCountry {
  address: string;
  country: string | null;
}

function countryAtAddress(address: string | null | undefined, known: KnownAddressCountry | undefined): Promise<string | null> {
  const trimmed = address?.trim() ?? '';
  if (trimmed === '') return Promise.resolve(null);
  if (known !== undefined && known.address === trimmed) return Promise.resolve(known.country);
  return countryForAddress(trimmed);
}

function hasPin(input: NewCenterInput): boolean {
  return input.latitude !== null && input.longitude !== null;
}

/**
 * Makes the centre and answers with its id; a write failure rejects, as `addSite`'s does.
 *
 * **The country comes from the centre's own pin and from nothing else** (§2.3), so a centre with
 * no pin has none — in particular it never borrows the dive's or the site's: the dive's pin is
 * where the diver entered the water, not the shop, so a centre's position starts empty
 * (`NewPlaceScreen`). A missing pin skips the geocoder altogether rather than asking it a
 * question with no point.
 *
 * **The one exception is the address** (issue #31, §10): a centre with an address and no pin takes
 * the country of the address — `fromAddress`'s answer when it is about this very address, the
 * geocoder's otherwise. A pin, when there is one, wins and the address is not asked; no pin is
 * ever made from an address.
 */
export async function addCenter(input: NewCenterInput, known?: KnownCountry, fromAddress?: KnownAddressCountry): Promise<string> {
  const country = hasPin(input) ? await countryAt(input.latitude, input.longitude, known) : await countryAtAddress(input.address, fromAddress);
  const created = await createDiveCenter(db, { ...input, country });
  return created.id;
}
