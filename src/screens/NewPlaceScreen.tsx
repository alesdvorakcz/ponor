import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { KeyboardAvoidingView, Platform, Pressable, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EntryIcon } from '../components/EntryIcon';
import { FieldNote } from '../components/FieldNote';
import { FormField } from '../components/FormField';
import { FormGroup } from '../components/FormGroup';
import { RevealingScrollView } from '../components/FormReveal';
import { OptionChips } from '../components/OptionChips';
import { symbolName, type PlatformSymbol } from '../components/symbolName';
import { TokenChips } from '../components/TokenChips';
import { addCenter, addSite, findSiteTwins, type KnownAddressCountry, type KnownCountry, type SiteTwin } from '../cloud/addToCatalogue';
import { useAuthSession } from '../cloud/useAuthSession';
import { useUnitSystem } from '../db/useUnitSystem';
import { toFormNumber } from '../domain/diveFormSchema';
import { type MapPoint } from '../domain/mapSites';
import { type PlaceKind } from '../domain/placePicker';
import { cleanAltNames } from '../domain/search';
import {
  AGENCY_VALUES,
  ENTRY_VALUES,
  SALINITY_VALUES,
  SERVICE_VALUES,
  SITE_TYPE_VALUES,
  SUITABLE_FOR_VALUES,
  WATER_BODY_VALUES,
  type Agency,
  type Entry,
  type Salinity,
  type Service,
  type SiteType,
  type SuitableFor,
  type WaterBody,
} from '../domain/types';
import {
  formatCoordinates,
  formatEntry,
  formatPlaceToken,
  formatSalinity,
  formatSiteTwinMeta,
  formatSuitableFor,
  formatWaterBody,
  METADATA_SEPARATOR,
  NO_FIGURE,
} from '../format/display';
import { positionRefusalSentence } from '../format/positionRefusal';
import { storedValueFor, unitLabel } from '../format/units';
import { useKeyboardShown } from '../hooks/useKeyboardShown';
import { t, useT } from '../i18n';
import { completePlacePick, firstParam, placePickRequest, type PlacePick } from '../navigation/placePick';
import { countryFor, countryForAddress } from '../platform/geocode';
import { currentPosition } from '../platform/location';
import { resolveScheme } from '../theme/resolve';
import { liftedBottomInset, makeStyles, screenTopInset, type Styles } from '../theme/styles';

/** The position card's glyph, monochrome, through `symbolName` like every other in the app. Exported
 * so `symbolName.test.tsx` can pin its Android and web names. */
export const CURRENT_POSITION_GLYPH: PlatformSymbol = { ios: 'location', android: 'near_me' };

/** Where the new place is, and whose answer that is: the dive's own pin, or the phone's, asked for. */
type Position = MapPoint & { from: 'dive' | 'phone' };

/** *from this dive* while a value is still the one the dive handed the page; nothing once it is not. */
function fromDive<T>(value: T | null, dives: T | null | undefined): string | undefined {
  return value !== null && value === dives ? t('newPlace.fromThisDive') : undefined;
}

/** A typed line as the row stores it: trimmed, and `null` once nothing is left (§1: a sparse row
 * is normal). */
function textOrNull(text: string): string | null {
  const kept = text.trim();
  return kept === '' ? null : kept;
}

/** The page's four groups (#31) — a site's two, then a centre's two. */
type PlaceGroup = 'site' | 'otherNames' | 'contact' | 'services';

/**
 * §2.3's answer, worded by how the match relates to the site being made (`match.relation`,
 * `twinRelation`'s — the page folds no name itself): the same name is not a question (*“Lom
 * Leštinka” is already a site.*), nor is another name for it (#31: *“Kamena vrata” is another name
 * for Stone Gate.*); anything else is *Did you mean …?*. Each is the one tap that opens the existing
 * row.
 */
function matchSentence(match: SiteTwin): string {
  switch (match.relation.kind) {
    case 'sameName':
      return t('newPlace.sameName', { name: match.value });
    case 'otherName':
      return t('newPlace.otherName', { alias: match.relation.alias, name: match.relation.name });
    case 'similar':
      return t('form.didYouMean', { name: match.value });
  }
}

/**
 * A near-match's own page, opened over this one with the form's token as `pick`, so the page can
 * offer *Use this site* (`DiveSiteScreen`). Checked by typed routes.
 */
function twinHref(id: string, token: string): Href {
  return { pathname: '/site/[id]', params: { id, pick: token } };
}

/**
 * **New dive site / New dive centre** (`/site/new`, `/center/new`; issue #19) — pushed from the
 * picker's *Create “…”* row with the form's token and the typed name. The site-picker design's
 * *Creating* is the description this follows.
 *
 * ── What a new row starts with ────────────────────────────────────────────────────────────
 *
 * The typed name; for a site, the dive's own pin, salinity, water body and entry, each marked *from
 * this dive* until the diver changes it (§2.3: a site inherits them, never `max_depth_m`); for a
 * centre, the name alone and an empty position — the dive's pin is where the diver entered the
 * water, not the shop. **Never the phone's position unasked**: *Use current position* is the one
 * thing that asks, through `currentPosition`, the stored-pin request (100 m rule), because this one
 * is stored. *Country* is `countryFor`'s answer for the position on screen, for the diver to read
 * — and, once it has come back, the one stored: Save hands it to `addSite`/`addCenter` with the
 * point it is for, so the geocoder is asked once. Saved before it answers, the row's country is
 * theirs to derive from the row's own pin, as it always was.
 *
 * ── What else a place says (issue #31, the canvas's round 3) ──────────────────────────────
 *
 * The **description** is an ordinary row straight under the name — and, for a centre, under its
 * **address**, which sits directly under the name — because it is what a diver opens a place to
 * learn; it is public, and the row says so (*everyone can read it*). The rest sit in §2.2's
 * collapsed groups below *Country*: a site's *The site* (the dive's three, then its types, the
 * level it suits, its own depth, and a wreck's name and year only while *Wreck* is a type) and
 * *Other names*; a centre's *Contact* (its website among them) and *Services*. Each closed group
 * says what it holds. **A group opens when it holds a value** — no data, closed; data carried,
 * open — which on a page that starts empty means *The site* when the dive handed it water or an
 * entry; the header has it from there. Unlike the dive form's, these are not remembered: the page
 * is opened per place, and nothing about one place says how the next is filled. A closed group
 * still saves what it holds.
 *
 * ── Saving, once ──────────────────────────────────────────────────────────────────────────
 *
 * A site asks §2.3's question first (`findSiteTwins`, with the other names as Save will write them —
 * #31's check runs both ways); its matches stand above the button, each worded by how it relates,
 * with its country and how far it is from the position on screen, and the button becomes *Save as a new
 * site anyway*. **A tap on a match opens that site's own page** (owner's call on PR #35: *"so he can
 * check if it's really a duplicate"*), whose *Use this site* picks it through the same
 * `completePlacePick` and closes all three pages; `‹ Back` there returns here exactly as it was left. A centre
 * saves straight away. The row is then written, handed to the form two screens down and both pages
 * close (`completePlacePick(…, 2)`) — or, for a token the registry lost to a reload, the row is
 * written and this page just goes back. A failed write says so and changes nothing on the dive.
 *
 * Three refs keep each press to one outcome (Review Focus 1, 2): `inFlight` shuts Save from the
 * moment it is pressed — before any re-render could disable it — until a question or a failure hands
 * it back; `leaving` lets exactly one way off happen (`‹ Back`, opening a match, or a save that went
 * through) and is released when the page is focused again, since a match's page comes back here, as
 * the picker releases its own for *Create*; `alive` drops any answer that lands after the page has
 * closed. A write already out when
 * the page closes still makes its row — it is the diver's own place, and the picker underneath lists
 * it — but nothing reaches the form.
 *
 * **What is saved is what is on screen.** Save is shut while the device is still being asked for a
 * position (a fix that landed after the write would be a position the diver asked for and the row
 * never got), and every field, chip and *+ Add a name* are held still from Save until the question
 * or the failure hands them back, so nothing typed meanwhile is left out of the row. A new position,
 * or an other name changed, forgets a standing question, as a new name does: the question was asked
 * about the old one.
 * A blank row is saved as `null`; a site depth is typed in the diver's units and stored in metres;
 * a wreck's name and year are saved only while *Wreck* is a type (and kept on the page should it
 * be chosen again); other names are saved clean (`cleanAltNames`).
 */
export default function NewPlaceScreen({ kind }: { kind: PlaceKind }) {
  // The subscription that repaints this screen when the diver changes the language (src/i18n).
  useT();
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  const { session, resolved } = useAuthSession();
  const units = useUnitSystem();
  const params = useLocalSearchParams<{ token?: string | string[]; name?: string | string[] }>();
  const token = firstParam(params.token) ?? '';
  // Read once, as the picker reads it: completing forgets the token.
  const [request] = useState(() => placePickRequest(token));
  const dive = request?.dive ?? null;

  const [name, setName] = useState(() => firstParam(params.name) ?? '');
  const [position, setPosition] = useState<Position | null>(() =>
    kind === 'site' && dive !== null && dive.pin !== null ? { ...dive.pin, from: 'dive' } : null,
  );
  const [salinity, setSalinity] = useState<Salinity | null>(dive?.salinity ?? null);
  const [waterBody, setWaterBody] = useState<WaterBody | null>(dive?.waterBody ?? null);
  const [entry, setEntry] = useState<Entry | null>(dive?.entry ?? null);
  const [description, setDescription] = useState('');
  // A site's facts beyond the dive's three.
  const [siteTypes, setSiteTypes] = useState<SiteType[]>([]);
  const [suitableFor, setSuitableFor] = useState<SuitableFor | null>(null);
  const [depth, setDepth] = useState('');
  const [wreckName, setWreckName] = useState('');
  const [wreckYear, setWreckYear] = useState('');
  // One empty row to type into; *+ Add a name* appends another. Rows are never removed or
  // reordered — a blank one is simply not saved — so a row's index is its identity.
  const [altNames, setAltNames] = useState<string[]>(['']);
  // A centre's.
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [openingHours, setOpeningHours] = useState('');
  const [services, setServices] = useState<Service[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  // §2.2: open exactly when the group holds a value, decided as the page opens. Everything starts
  // empty but what the dive handed *The site*, so that is the one group that can open.
  const [opened, setOpened] = useState<Record<PlaceGroup, boolean>>(() => ({
    site: salinity !== null || waterBody !== null || entry !== null,
    otherNames: false,
    contact: false,
    services: false,
  }));
  const [locating, setLocating] = useState(false);
  const [positionNote, setPositionNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // §2.3's near-matches once the check has found some; their presence is also "the diver has been
  // asked", which is what makes the next press mean *anyway*.
  const [matches, setMatches] = useState<readonly SiteTwin[]>([]);
  const [failed, setFailed] = useState(false);

  const alive = useRef(true);
  const leaving = useRef(false);
  const inFlight = useRef(false);
  const asking = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // A match's page is the one way off that comes back: `‹ Back` there returns to this page as it was.
  useFocusEffect(
    useCallback(() => {
      leaving.current = false;
    }, []),
  );

  // *Country*, for whatever position is on screen. An answer is kept with the point it is for, so one
  // about a position since replaced is never shown, and the cleanup drops one landing after the page
  // has closed.
  const latitude = position?.latitude ?? null;
  const longitude = position?.longitude ?? null;
  const [looked, setLooked] = useState<KnownCountry | null>(null);
  useEffect(() => {
    if (latitude === null || longitude === null) return;
    let current = true;
    void countryFor(latitude, longitude).then((country) => {
      if (current) setLooked({ latitude, longitude, country });
    });
    return () => {
      current = false;
    };
  }, [latitude, longitude]);
  // The answer for the position on screen, or none while that position has not been answered for:
  // what the *Country* row reads, and what Save hands on.
  const shown = looked !== null && looked.latitude === latitude && looked.longitude === longitude ? looked : null;
  const pinCountry = shown?.country ?? null;

  // A centre's *Country* when it has an address and no pin (issue #31): asked as the diver leaves the
  // Address box, kept with the address it is for, and current only while that is still the box's
  // text. Never for a site, never while there is a position (the pin's answer wins), and the page
  // closing drops an answer still out (`alive`).
  const trimmedAddress = address.trim();
  const [addressLooked, setAddressLooked] = useState<KnownAddressCountry | null>(null);
  const addressAsked = useRef<string | null>(null);
  const askAddress = () => {
    if (kind !== 'center' || latitude !== null || trimmedAddress === '' || addressAsked.current === trimmedAddress) return;
    const asked = trimmedAddress;
    addressAsked.current = asked;
    void countryForAddress(asked).then((answer) => {
      if (alive.current && addressAsked.current === asked) setAddressLooked({ address: asked, country: answer });
    });
  };
  const fromAddress = kind === 'center' && addressLooked !== null && addressLooked.address === trimmedAddress ? addressLooked : null;
  const country = latitude !== null ? pinCountry : (fromAddress?.country ?? null);
  const countryFromAddress = latitude === null && fromAddress?.country != null;

  const trimmed = name.trim();
  const guest = resolved && session === null;
  const wreck = siteTypes.includes('wreck');

  const groupProps = (group: PlaceGroup) => ({
    expanded: opened[group],
    onToggle: (expanded: boolean) => setOpened((current) => ({ ...current, [group]: expanded })),
    scheme,
  });
  // A year, never a figure that only starts like one: digits only, four at most (the server casts
  // the column to `integer`).
  const takeYear = (text: string) => setWreckYear(text.replace(/\D/g, '').slice(0, 4));
  const retypeAltName = (index: number, text: string) => {
    setAltNames((current) => current.map((kept, at) => (at === index ? text : kept)));
    // A standing question was asked with the other names that were on the page (#31: both ways).
    setMatches([]);
  };
  const addAltName = () => setAltNames((current) => [...current, '']);

  /**
   * The first way off the page wins; every later one is a no-op. A second delivery would already be
   * nothing (the registry settles a token once), but `‹ Back` is plain navigation: a second one
   * would leave the picker too, and a save landing after it would close two screens from a stack
   * that has already lost one.
   */
  const leave = (go: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    go();
  };
  // Back to the form with the place, closing this page and the picker — or, with no request left
  // to answer (Review Focus 3), just this page.
  const deliver = (pick: PlacePick) => leave(() => (request === null ? router.back() : completePlacePick(token, pick, 2)));
  const back = () => leave(() => router.back());

  const release = () => {
    inFlight.current = false;
    setSaving(false);
  };

  const rename = (text: string) => {
    setName(text);
    // A question, or a failure, was about the name that was in the box.
    setMatches([]);
    setFailed(false);
  };

  const locate = async () => {
    if (asking.current || inFlight.current || leaving.current) return;
    asking.current = true;
    setLocating(true);
    setPositionNote(null);
    const outcome = await currentPosition();
    asking.current = false;
    if (!alive.current) return;
    setLocating(false);
    if (outcome.found) {
      setPosition({ latitude: outcome.latitude, longitude: outcome.longitude, from: 'phone' });
      // A standing question was asked around the old position (`similar_sites` is narrowed by it).
      setMatches([]);
    } else {
      setPositionNote(positionRefusalSentence(outcome.reason));
    }
  };

  const save = async () => {
    // Not while the device is still answering *Use current position*: the row would be written
    // without the position the diver asked for, and the fix would land on a page already closing.
    if (leaving.current || inFlight.current || asking.current || trimmed === '') return;
    inFlight.current = true;
    setSaving(true);
    setFailed(false);
    // Both halves or neither — `position` holds a whole point or none.
    const at: MapPoint | null = position === null ? null : { latitude: position.latitude, longitude: position.longitude };
    // The *Country* row's answer, about exactly `at` (the position cannot move while Save is out).
    const known = shown ?? undefined;
    // The other names as the row will hold them — and so as the question is asked about them.
    const others = cleanAltNames(trimmed, altNames);

    if (kind === 'site' && matches.length === 0) {
      const found = await findSiteTwins(trimmed, others, at);
      // Closed, or `‹ Back` pressed while the check was out: nothing is written.
      if (!alive.current || leaving.current) return;
      if (found.length > 0) {
        setMatches(found);
        return release();
      }
    }

    let id: string;
    try {
      id =
        kind === 'site'
          ? await addSite(
              {
                name: trimmed,
                latitude: at?.latitude ?? null,
                longitude: at?.longitude ?? null,
                entry,
                salinity,
                waterBody,
                description: textOrNull(description),
                siteTypes,
                suitableFor,
                // Typed in the diver's units, stored in metres (§6): an imperial diver's 100 is 30.48 m.
                maxDepthM: storedValueFor('depth', toFormNumber(depth), null, units),
                // Asked only while *Wreck* is a type, and so saved only then.
                wreckName: wreck ? textOrNull(wreckName) : null,
                wreckSunkYear: wreck && wreckYear !== '' ? Number(wreckYear) : null,
                altNames: others,
              },
              known,
            )
          : await addCenter(
              {
                name: trimmed,
                latitude: at?.latitude ?? null,
                longitude: at?.longitude ?? null,
                website: textOrNull(website),
                address: textOrNull(address),
                phone: textOrNull(phone),
                email: textOrNull(email),
                openingHours: textOrNull(openingHours),
                description: textOrNull(description),
                services,
                agencies,
              },
              known,
              fromAddress ?? undefined,
            );
    } catch {
      if (!alive.current || leaving.current) return;
      setFailed(true);
      return release();
    }
    // Written. Delivered only while the page is still mounted — and `deliver` is a way off, so after
    // `‹ Back` it does nothing. `inFlight` stays shut either way: nothing on a page that is closing
    // can make a second row.
    if (!alive.current) return;
    deliver({ id, name: trimmed });
  };

  // Opens the match's own page; *Use this site* there picks it (`DiveSiteScreen`).
  const openMatch = (match: SiteTwin) => {
    if (inFlight.current) return;
    leave(() => router.push(twinHref(match.id, token)));
  };

  const unavailable = trimmed === '';
  const shut = saving || locating || unavailable;
  const saveLabel = saving
    ? t('newPlace.saving')
    : matches.length > 0
      ? t('newPlace.saveAnyway')
      : t(kind === 'site' ? 'newPlace.saveSite' : 'newPlace.saveCenter');

  return (
    // The dive form's arrangement: `padding` on iOS and `height` on Android lift the footer with the
    // keyboard, and `liftedBottomInset` stops clearing a home indicator the keys are covering.
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Pressable style={styles.newPlaceBack} onPress={back} accessibilityRole="button" accessibilityLabel={t('back.anyLabel')}>
        <Text style={styles.newPlaceBackLabel}>{t('back.any')}</Text>
      </Pressable>
      <RevealingScrollView
        style={styles.newPlaceScroll}
        contentContainerStyle={styles.newPlaceContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.newPlaceHeader}>
          <Text style={styles.newPlaceHeading} accessibilityRole="header">
            {t(kind === 'site' ? 'newPlace.titleSite' : 'newPlace.titleCenter')}
          </Text>
          <Text style={styles.newPlaceHeaderNote}>{t('newPlace.required')}</Text>
          {guest && <Text style={styles.newPlaceHeaderNote}>{t('newPlace.guestNote')}</Text>}
        </View>
        <FormField
          label={t('newPlace.name')}
          value={name}
          onChange={rename}
          scheme={scheme}
          // The first letter only, as the picker's search (whose text arrives here): see there.
          autoCapitalize="sentences"
          autoCorrect={false}
          spellCheck={false}
          editable={!saving}
        />
        {kind === 'center' && (
          // One free-text line, directly under the name as the canvas draws it. Never corrected: a
          // street the keyboard does not know is still the street (M3n's finding about names).
          <FormField
            label={t('field.address')}
            value={address}
            onChange={setAddress}
            onBlur={askAddress}
            scheme={scheme}
            placeholder={t('newPlace.optional')}
            autoCapitalize="words"
            autoCorrect={false}
            spellCheck={false}
            editable={!saving}
          />
        )}
        {/* Public, and said so: what a diver opens a place to learn. No cap on its length. */}
        <FormField
          label={t('field.description')}
          value={description}
          onChange={setDescription}
          scheme={scheme}
          multiline
          caption={t('newPlace.everyoneCanRead')}
          placeholder={t('newPlace.optional')}
          autoCapitalize="sentences"
          editable={!saving}
        />
        <View style={styles.newPlaceSectionHeader}>
          <Text style={styles.newPlaceSectionTitle}>{t('newPlace.position')}</Text>
          {position?.from === 'dive' && <Text style={styles.formFieldCaption}>{t('newPlace.fromThisDive')}</Text>}
        </View>
        <PositionCard
          styles={styles}
          meta={
            locating
              ? t('form.locating')
              : position === null
                ? t('newPlace.asksThePhone')
                : (formatCoordinates(position.latitude, position.longitude) ?? NO_FIGURE)
          }
          busy={locating || saving}
          onPress={() => void locate()}
        />
        <FieldNote message={positionNote ?? undefined} scheme={scheme} />
        {/* Read-only: what the position says, in the stored ISO code a site's own page shows. */}
        <View style={styles.formField}>
          <View style={styles.formFieldRow}>
            <Text style={styles.formFieldLabel}>{t('field.country')}</Text>
            <Text style={country === null ? styles.newPlaceCountryNone : styles.newPlaceCountry}>{country ?? NO_FIGURE}
              {countryFromAddress && (
                <Text style={styles.newPlaceCountrySource}>{METADATA_SEPARATOR + t('newPlace.fromTheAddress')}</Text>
              )}
            </Text>
          </View>
        </View>
        {kind === 'site' ? (
          <>
            <FormGroup title={t('site.facts')} hint={t('newPlace.siteHint')} {...groupProps('site')}>
              <OptionChips
                label={t('field.salinity')}
                value={salinity}
                options={SALINITY_VALUES}
                displayLabel={(option) => formatSalinity(option) ?? option}
                onChange={(chosen) => setSalinity(chosen === '' ? null : chosen)}
                scheme={scheme}
                caption={fromDive(salinity, dive?.salinity)}
                disabled={saving}
              />
              <OptionChips
                label={t('field.waterBody')}
                value={waterBody}
                options={WATER_BODY_VALUES}
                displayLabel={(option) => formatWaterBody(option) ?? option}
                onChange={(chosen) => setWaterBody(chosen === '' ? null : chosen)}
                scheme={scheme}
                caption={fromDive(waterBody, dive?.waterBody)}
                disabled={saving}
              />
              <OptionChips
                label={t('field.entry')}
                value={entry}
                options={ENTRY_VALUES}
                displayLabel={(option) => formatEntry(option) ?? option}
                onChange={(chosen) => setEntry(chosen === '' ? null : chosen)}
                scheme={scheme}
                icon={(option, tintColor) => <EntryIcon entry={option} tintColor={tintColor} />}
                caption={fromDive(entry, dive?.entry)}
                disabled={saving}
              />
              <TokenChips
                label={t('field.siteTypes')}
                values={siteTypes}
                options={SITE_TYPE_VALUES}
                displayLabel={(option) => formatPlaceToken('siteTypes', option)}
                onChange={setSiteTypes}
                scheme={scheme}
                caption={t('newPlace.anyThatApply')}
                disabled={saving}
              />
              <OptionChips
                label={t('field.suitableFor')}
                value={suitableFor}
                options={SUITABLE_FOR_VALUES}
                displayLabel={(option) => formatSuitableFor(option) ?? option}
                onChange={(chosen) => setSuitableFor(chosen === '' ? null : chosen)}
                scheme={scheme}
                disabled={saving}
              />
              {/* The site's own depth, never the dive's (§2.3): typed, in the diver's units. A
                  figure, so mono — and in ink, as the site page draws it. */}
              <FormField
                label={t('field.siteDepth')}
                value={depth}
                onChange={setDepth}
                scheme={scheme}
                keyboardType="decimal-pad"
                mono
                unit={unitLabel('depth', units)}
                editable={!saving}
              />
              {wreck && (
                <>
                  {/* A ship's name, bound for the catalogue as the place's own is: never corrected. */}
                  <FormField
                    label={t('field.wreckName')}
                    value={wreckName}
                    onChange={setWreckName}
                    scheme={scheme}
                    autoCapitalize="sentences"
                    autoCorrect={false}
                    spellCheck={false}
                    editable={!saving}
                  />
                  <FormField
                    label={t('field.wreckSunkYear')}
                    value={wreckYear}
                    onChange={takeYear}
                    scheme={scheme}
                    keyboardType="number-pad"
                    mono
                    editable={!saving}
                  />
                </>
              )}
            </FormGroup>
            <FormGroup title={t('field.altNames')} hint={t('newPlace.altNamesHint')} {...groupProps('otherNames')}>
              {altNames.map((other, index) => (
                // A place's name, as the page's own *Name* takes one (see there).
                <FormField
                  key={index}
                  label={t('field.altName')}
                  value={other}
                  onChange={(text) => retypeAltName(index, text)}
                  scheme={scheme}
                  autoCapitalize="sentences"
                  autoCorrect={false}
                  spellCheck={false}
                  editable={!saving}
                />
              ))}
              <View style={styles.newPlaceAddNames}>
                <Pressable
                  style={styles.newPlaceAddName}
                  onPress={addAltName}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={t('newPlace.addName')}
                  accessibilityState={{ disabled: saving }}
                >
                  <View style={styles.newPlaceAddNamePill}>
                    <Text style={styles.newPlaceAddNameLabel}>{t('newPlace.addName')}</Text>
                  </View>
                </Pressable>
              </View>
            </FormGroup>
          </>
        ) : (
          <>
            <FormGroup title={t('place.contact')} hint={t('newPlace.contactHint')} {...groupProps('contact')}>
              <FormField
                label={t('field.website')}
                value={website}
                onChange={setWebsite}
                scheme={scheme}
                placeholder={t('newPlace.optional')}
                keyboardType="url"
                textContentType="URL"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                editable={!saving}
              />
              {/* The shop's number and address, not the diver's: no AutoFill hint on either, so
                  the platform offers none of the diver's own. */}
              <FormField
                label={t('field.phone')}
                value={phone}
                onChange={setPhone}
                scheme={scheme}
                keyboardType="phone-pad"
                editable={!saving}
              />
              <FormField
                label={t('field.email')}
                value={email}
                onChange={setEmail}
                scheme={scheme}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                editable={!saving}
              />
              <FormField
                label={t('field.openingHours')}
                value={openingHours}
                onChange={setOpeningHours}
                scheme={scheme}
                editable={!saving}
              />
            </FormGroup>
            <FormGroup title={t('place.services')} hint={t('newPlace.servicesHint')} {...groupProps('services')}>
              <TokenChips
                label={t('field.services')}
                values={services}
                options={SERVICE_VALUES}
                displayLabel={(option) => formatPlaceToken('services', option)}
                onChange={setServices}
                scheme={scheme}
                disabled={saving}
              />
              <TokenChips
                label={t('field.agencies')}
                values={agencies}
                options={AGENCY_VALUES}
                displayLabel={(option) => formatPlaceToken('agencies', option)}
                onChange={setAgencies}
                scheme={scheme}
                disabled={saving}
              />
            </FormGroup>
          </>
        )}
      </RevealingScrollView>

      {/* §2.3's answer stands above the button, outside the scroll, so the diver who pressed Save
          sees it without looking for it: the sentence, then the match's country and how far it is
          from the position on screen. No chevron, though a tap opens the site's page: §0.6 spends
          the chevron on in-place disclosure and never on navigation, and #5 decides how a pressable
          row shows itself (owner's call, PR #35). Inert while a write is out: a pick then would be
          thrown away by the row the write is about to hand the form. */}
      {matches.map((match) => {
        const sentence = matchSentence(match);
        const meta = formatSiteTwinMeta(match, position, units);
        return (
          <Pressable
            key={match.id}
            style={styles.formSuggestion}
            onPress={() => openMatch(match)}
            accessibilityRole="button"
            accessibilityLabel={sentence}
            accessibilityHint={meta ?? undefined}
            disabled={saving}
            accessibilityState={{ disabled: saving }}
          >
            <View style={styles.formSuggestionBody}>
              <Text style={styles.formSuggestionText}>{sentence}</Text>
              {meta !== null && <Text style={styles.formSuggestionMeta}>{meta}</Text>}
            </View>
          </Pressable>
        );
      })}
      {failed && (
        <View style={styles.newPlaceNote}>
          <Text style={styles.newPlaceNoteText}>{t('newPlace.saveFailed')}</Text>
        </View>
      )}

      <View style={[styles.formFooter, { paddingBottom: liftedBottomInset(insets.bottom, 24, keyboardShown) }]}>
        <Pressable
          style={[styles.action, unavailable && styles.newPlaceSaveUnavailable]}
          onPress={() => void save()}
          disabled={shut}
          accessibilityRole="button"
          accessibilityLabel={saveLabel}
          accessibilityState={{ disabled: shut, busy: saving }}
        >
          <Text style={styles.actionLabel}>{saveLabel}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * *Use current position* — drawn as the *Show on map* card (`MapCard`, on the dive detail, site and
 * centre pages) is, one `placeCard` style, and pressed to ask the device where it is. Under the
 * words: what a press does, *Locating…* while it asks, or the coordinates once the page holds a
 * position, whoever's it is.
 */
function PositionCard({
  styles,
  meta,
  busy,
  onPress,
}: {
  styles: Styles;
  meta: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.newPlacePositionCard}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={t('newPlace.useCurrentPosition')}
      accessibilityHint={meta}
      accessibilityState={{ disabled: busy, busy }}
    >
      <SymbolView name={symbolName(CURRENT_POSITION_GLYPH)} size={20} tintColor={styles.newPlaceGlyph.color} />
      <View style={styles.newPlacePositionText}>
        <Text style={styles.newPlacePositionTitle}>{t('newPlace.useCurrentPosition')}</Text>
        <Text style={styles.newPlacePositionMeta}>{meta}</Text>
      </View>
    </Pressable>
  );
}
