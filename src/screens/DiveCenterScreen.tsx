import { router, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DiveRow } from '../components/DiveRow';
import { MapCard } from '../components/MapCard';
import { useDiveCenters } from '../db/useDiveCenters';
import { useDives } from '../db/useDives';
import { useDiveSampleShapes } from '../db/useDiveSampleShapes';
import { useUnitSystem } from '../db/useUnitSystem';
import { divesWithCenter } from '../domain/centerDives';
import { catalogueUnreadable, logbookUnreadable } from '../domain/logbook';
import { logbookStats } from '../domain/logbookStats';
import { pointOf, waterTempRange } from '../domain/mapSites';
import { formatCoordinates, formatPlaceTokens, formatSiteSummary, unnamedCenter } from '../format/display';
import { t, useT } from '../i18n';
import { backToCenters } from '../navigation/leaveScreen';
import { openAddressInMaps } from '../platform/mapsLink';
import { mailtoUrl, openContactUrl, telUrl } from '../platform/openContact';
import { isOpenableWebsite, openWebsite } from '../platform/openWebsite';
import { showOnMap } from '../platform/showOnMap';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenBottomInset, screenTopInset, type Styles } from '../theme/styles';

/**
 * **One dive centre's own page** (`/center/[id]`, M3c) — the screen `dive_centers` never had.
 *
 * Nothing in `src/` read that table on screen before this milestone: a diver could add a centre
 * from the dive form (§2.3, M2o), watch `usePendingChanges` count it, watch it sync, and never
 * see it again anywhere in the app. §6 has held `name`, `country`, `website`, `location` since
 * M2a with no reader, which makes this closer to a defect than to a feature.
 *
 * ── What it shows, and what makes it worth opening for the common centre ──────────────────
 *
 * §2.3 is explicit that **a centre inherits its name alone**: the dive form's pin is where the
 * diver got into the water, so writing it to a centre would file a dive site as the shop's
 * address, and there is no country either, because §2.3 derives a country from a pin and from
 * nothing else. Since issue #19 the *New dive centre* page lets a diver give one a position
 * (*Use current position*, and the country that comes with it) and a website, but only by asking —
 * both are optional — **so the ordinary centre in this app is still mostly nulls**, and a page that
 * only knew how to display catalogue facts would be an empty screen for most centres a diver
 * creates.
 *
 * What makes it worth opening anyway is the half the catalogue does not hold: **the diver's own
 * dives with them**. That is a question nothing else in the app answers — the logbook groups by
 * trip (`tripKeyOf`, which reads the centre but never lists by it), the Map groups by site, and
 * Stats counts the logbook — so a centre with nothing but a name still opens on `3 dives ·
 * deepest 18.2 m · 18–24 °C` over the three rows themselves. The catalogue's own facts are a
 * cluster that is simply absent when the row carries none, exactly as an unrecorded field is
 * absent on a dive's detail (§1: a sparse row is normal, not broken).
 *
 * ── Which dives count ─────────────────────────────────────────────────────────────────────
 *
 * `divesWithCenter` (domain/centerDives.ts) owns it, and its docblock carries the whole rule and
 * why it is not `siteIdentityOf`. Two consequences are visible here: a dive that carries a
 * `center_id` is decided by that id alone, so this page never claims another centre's dives; and
 * §2.4's planned dives are excluded, so a page opened from a *plan* with this centre reads
 * `0 dives` — which is the same answer the Map's site sheet gives a planned dive, for the same
 * reason, rather than an inconsistency introduced here.
 *
 * ── The three states, kept apart ──────────────────────────────────────────────────────────
 *
 * A centre this device does not hold, a catalogue that could not be read, and a catalogue that
 * has not answered yet are three different things and each gets its own branch — §10's "a screen
 * with no answer must not state one", which `DiveDetailScreen`'s own not-found branch records at
 * length: `useLiveQuery` hands back `[]` on the renders before its query returns, so *"Centre not
 * found"* said unconditionally would be a claim about the database that nothing has yet asked it.
 *
 * `db/catalogue.ts`'s `pickable` is what decides whether a centre is here at all: live, and
 * `status = 'active'`. So a centre an admin merged away is **not found** rather than shown beside
 * its survivor — and nothing on this screen reads `merged_into`, because M2r repoints the dives
 * themselves on the pull that delivers the merge (§5, and `domain/merges.ts` owns the rule).
 */

/** What this page calls the centre it is showing — its name, or `unnamedCenter`.
 *
 * **A deliberate near-duplicate of `diveSiteLabel`, and of `MapScreen`'s own `siteLabel`, and
 * §4.1 requires it to say so.** `diveSiteLabel` answers "what is this DIVE called" and falls
 * through the dive's site and then its centre; `siteLabel` answers it for a catalogue *site*
 * row; this answers it for a catalogue *centre* row, which has only a name to lose. The words
 * for having none are `format/display.ts`'s, never a literal here, because a heading a screen
 * reader announces as nothing is worse than one it announces as unnamed. */
function centerLabel(center: { name: string | null }): string {
  return center.name ?? unnamedCenter();
}

/**
 * The way out, in §0.6's one treatment for leaving — mono, muted, small, and never competing
 * with the content beside it (`backControl`, theme/styles.ts, shared with the dive detail's back
 * and the form's `‹ Cancel`).
 *
 * Rendered on **every** branch, the not-found one included, for `DiveDetailScreen`'s own stated
 * reason: a page reached by an unknown id is more of a dead end than a real one, not less.
 * `backToCenters` (navigation/leaveScreen.ts) owns where it lands.
 *
 * **It says *Back*, not *‹ Centres*** (M3k). M3c's own report noticed that this label names the
 * fallback however the page was reached, and filed it as consistent with the dive detail rather
 * than as a defect — so the same wrong claim was made on a second page, and then on a third when
 * M3f built the site's. **A way out names a destination only when the screen has exactly one way
 * in**; this page has three (the directory, a mark on the Map's centres layer, and a dive's own
 * *Centre* row), and the directory in `backToCenters` is a fallback for a cold deep link rather
 * than a promise the control may make.
 */
function BackButton({ styles }: { styles: Styles }) {
  return (
    <Pressable
      style={styles.detailBack}
      onPress={backToCenters}
      accessibilityRole="button"
      accessibilityLabel={t('back.anyLabel')}
    >
      <Text style={styles.detailBackLabel}>{t('back.any')}</Text>
    </Pressable>
  );
}

/** One catalogue fact, in the row grammar §0.6 gives every label-and-value pair in the app
 * (`formField`/`formFieldRow`/`formFieldLabel`, read exactly as Settings and the Stats tab read
 * them). Not a new vocabulary for one screen. */
function FactRow({
  label,
  value,
  mono = false,
  styles,
}: {
  label: string;
  value: string;
  mono?: boolean;
  styles: Styles;
}) {
  return (
    <View style={styles.formField}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        <Text style={mono ? styles.centerFactFigure : styles.centerFactValue}>{value}</Text>
      </View>
    </View>
  );
}

interface DiveCenterScreenProps {
  /** Overrides the route's own `id` param, on `DiveDetailScreen`'s precedent — the routed case
   * (`/center/[id]`) passes none and reads `useLocalSearchParams()`. */
  id?: string;
}

export default function DiveCenterScreen({ id: idProp }: DiveCenterScreenProps = {}) {
  // The subscription that repaints this screen when the diver changes the language (src/i18n) —
  // a screen root, so nothing above it re-renders on its own.
  useT();
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const units = useUnitSystem();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = idProp ?? routeId;

  const catalogue = useDiveCenters();
  const { dives, numbers, resolved: logbookResolved, error: logbookError } = useDives();
  // Task 6's row sparkline map — its own hook, read alongside `useDives()` with neither of its
  // own `resolved`/`error` consulted: a failed sample-series read must not blank this screen
  // the way a failed DIVES read does.
  const { shapes } = useDiveSampleShapes();

  const center = catalogue.centers.find((row) => row.id === id);

  if (center === undefined) {
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        <BackButton styles={styles} />
        <View style={styles.centerFill}>
          {/* Three states, one branch each. A failed read must never read as "not found", and
              a read that has not answered says nothing at all — the frame is drawn, and the
              sentence arrives under it when there is one (§10, `DiveDetailScreen`). */}
          {catalogue.error !== undefined && <Text style={styles.messageText}>{catalogueUnreadable()}</Text>}
          {catalogue.error === undefined && catalogue.resolved && (
            <Text style={styles.messageText}>{t('centre.notFound')}</Text>
          )}
        </View>
      </View>
    );
  }

  const myDives = divesWithCenter(dives, center);
  const website = center.website;
  // Every fact is absent on most centres this app creates (§2.3), so a cluster is drawn only when
  // the catalogue actually knows something for it — the same rule the dive detail applies to its
  // own clusters, rather than a heading standing over nothing. Text is shown as it was typed and
  // blank text is nothing.
  const filled = (value: string | null): string | null => (value !== null && value.trim() !== '' ? value : null);
  const description = filled(center.description);
  const address = filled(center.address);
  const phone = filled(center.phone);
  const email = filled(center.email);
  const hours = filled(center.openingHours);
  const siteWeb = filled(website);
  const country = filled(center.country);
  // What a press may hand to the outside world is decided by `platform/openContact.ts` and
  // `openWebsite.ts` alone; a value they refuse is shown as text with nothing to press.
  const telHref = telUrl(phone);
  const mailHref = mailtoUrl(email);
  const hasContact = [address, phone, email, hours, siteWeb, country].some((value) => value !== null);
  const services = formatPlaceTokens('services', center.services);
  const agencies = formatPlaceTokens('agencies', center.agencies);

  /**
   * What the page says about the diver's own dives with this centre, or nothing at all while
   * the logbook has not answered.
   *
   * `formatSiteSummary` (format/display.ts) is reused rather than reimplemented: it is §3's
   * *depth/temp* pair said about a set of dives, which is exactly this question asked of a shop
   * instead of a rock, and `logbookStats` and `waterTempRange` are the same two owners the Map
   * tab's site sheet asks. **It always states the count, `0 dives` included**, which is what a
   * page opened to ask "what did I do with this centre" has to answer even when the answer is
   * none — and is the one place this page deliberately differs from `formatCenterRow`, where a
   * nought would be noise on every row of a community directory.
   */
  const summary = logbookError || !logbookResolved
    ? null
    : formatSiteSummary(logbookStats(myDives), waterTempRange(myDives), units);

  // §2.3 gives a centre no position of its own, so the card is drawn only for one somebody placed:
  // a catalogue that surveyed it, or a diver pressing *Use current position* on the create page —
  // the same reason the Map tab draws so few of them.
  const point = pointOf(center);
  const coordinates = formatCoordinates(center.latitude, center.longitude);

  const header = (
    <View>
      <Text style={styles.centerHeading}>{centerLabel(center)}</Text>
      {summary !== null && <Text style={styles.centerSummary}>{summary}</Text>}
      {/* The one failure that has to be said here: the centre is on screen and readable, and it
          is the logbook underneath it that could not be opened — `logbookUnreadable()`
          (domain/logbook.ts), the same sentence four other screens say about the same event. */}
      {logbookError !== undefined && <Text style={styles.centerSummary}>{logbookUnreadable()}</Text>}
      {/* The description (#31) comes first, under the page's own lines; newlines kept, no cut. */}
      {description !== null && <Text style={styles.centerDescription}>{description}</Text>}
      {/* **"Show on map"** (issue #21) — the dive detail's card, under the description where the
          design canvas draws it, and only for a centre with a position a map can show (`pointOf`).
          It opens Ponor's map pointed at this centre (`platform/showOnMap.ts`), its outlined mark inverted. */}
      {point !== null && coordinates !== null && (
        <MapCard
          styles={styles}
          scheme={scheme}
          coordinates={coordinates}
          onPress={() => showOnMap({ kind: 'center', id: center.id, overItsPage: true }, point, centerLabel(center))}
        />
      )}
      {hasContact && (
        <View>
          <Text style={styles.centerSectionTitle}>{t('place.contact')}</Text>
          {/* Each of the three links is a press only when its text passed its owner's test; a
              phone of "ask at the bar" is a fact to read, and nothing is handed to `openURL`
              that was built from text that failed. */}
          {address !== null && (
            <LinkRow
              label={t('field.address')}
              value={address}
              onOpen={() => openAddressInMaps(address)}
              announce={t('centre.showAddress', { address })}
              styles={styles}
            />
          )}
          {phone !== null && (
            <LinkRow
              label={t('field.phone')}
              value={phone}
              onOpen={telHref === null ? null : () => void openContactUrl(telHref)}
              announce={t('centre.call', { phone })}
              mono
              styles={styles}
            />
          )}
          {email !== null && (
            <LinkRow
              label={t('field.email')}
              value={email}
              onOpen={mailHref === null ? null : () => void openContactUrl(mailHref)}
              announce={t('centre.mail', { email })}
              styles={styles}
            />
          )}
          {hours !== null && <FactRow label={t('field.openingHours')} value={hours} styles={styles} />}
          {siteWeb !== null && (
            <LinkRow
              label={t('field.website')}
              value={siteWeb}
              onOpen={isOpenableWebsite(siteWeb) ? () => void openWebsite(siteWeb) : null}
              announce={t('common.open', { name: siteWeb })}
              styles={styles}
            />
          )}
          {country !== null && <FactRow label={t('field.country')} value={country} styles={styles} />}
        </View>
      )}
      {(services !== null || agencies !== null) && (
        <View>
          <Text style={styles.centerSectionTitle}>{t('place.services')}</Text>
          {services !== null && <FactRow label={t('field.services')} value={services} styles={styles} />}
          {agencies !== null && <FactRow label={t('field.agenciesShort')} value={agencies} styles={styles} />}
        </View>
      )}
      {myDives.length > 0 && <Text style={styles.centerSectionTitle}>{t('place.yourDives')}</Text>}
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
      <BackButton styles={styles} />
      <FlatList
        style={styles.centerScroll}
        data={myDives}
        keyExtractor={(dive) => dive.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <DiveRow
            dive={item}
            number={numbers.get(item.id)}
            points={shapes.get(item.id)}
            scheme={scheme}
            units={units}
            onPress={(diveId) => router.push(`/dive/${diveId}`)}
          />
        )}
        // The device's own clearance rather than a constant (`screenBottomInset`, theme/
        // styles.ts): this screen is pushed OVER the tab bar, so its list runs to the bottom of
        // the display and the last dive would otherwise scroll under the Liquid Glass.
        contentContainerStyle={[styles.centerContent, { paddingBottom: screenBottomInset(insets.bottom) }]}
      />
    </View>
  );
}


/**
 * A fact that may also be a control — the website, the address, the number, the email.
 *
 * The caller decides whether the text is something the app will hand to the outside world
 * (`platform/openWebsite.ts`, `openContact.ts`, `mapsLink.ts`: §4.1's owners of that) and passes
 * `onOpen` only if it is. **`null` is a plain `FactRow`**: a bare `aquasplit.hr`, a phone of
 * "ask at the bar" is shown and not pressable, because a row that looked pressable and did
 * nothing is the dead control §0.6 objects to four separate times, and guessing a scheme on
 * another diver's behalf invents a fact about somebody else's shop.
 *
 * A pressable row carries no extra mark: how a row says it can be pressed is open issue #5, and
 * the website row never had one. It announces what a press will do (`Call +385 21 555 0123`,
 * `Open <address>`) rather than the text alone — §0.6's rule for every navigation row on
 * Settings, where "a row announced as a bare name says nothing about where a tap would land".
 */
function LinkRow({
  label,
  value,
  onOpen,
  announce,
  mono = false,
  styles,
}: {
  label: string;
  value: string;
  onOpen: (() => void) | null;
  announce: string;
  mono?: boolean;
  styles: Styles;
}) {
  if (onOpen === null) return <FactRow label={label} value={value} mono={mono} styles={styles} />;
  return (
    <Pressable style={styles.formField} onPress={onOpen} accessibilityRole="link" accessibilityLabel={announce}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        <Text style={mono ? styles.centerFactFigure : styles.centerFactValue}>{value}</Text>
      </View>
    </Pressable>
  );
}
