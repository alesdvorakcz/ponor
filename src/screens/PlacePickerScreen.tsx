import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  useColorScheme,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClearFieldControl } from '../components/ClearFieldControl';
import { symbolName, type PlatformSymbol } from '../components/symbolName';
import { searchCenters, searchCentersNear } from '../cloud/searchCenters';
import { searchSites, searchSitesNear } from '../cloud/searchSites';
import { type Cloud } from '../cloud/supabase';
import { useAuthSession } from '../cloud/useAuthSession';
import { applyPulledDiveCenters, applyPulledDiveSites } from '../db/catalogue';
import { useDiveCenters } from '../db/useDiveCenters';
import { useDives } from '../db/useDives';
import { useDiveSites } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { catalogueUnreadable } from '../domain/logbook';
import { pointOf, type MapPoint } from '../domain/mapSites';
import {
  NEAR_ME_RADIUS_KM,
  pickerGroups,
  type PickerGroupKey,
  type PickerPlace,
  type PickerRow,
  type PlaceKind,
} from '../domain/placePicker';
import {
  formatCreatePlaceMeta,
  formatDistance,
  formatPickerFigure,
  formatPickerGroupTitle,
  formatPickerMeta,
  NO_FIGURE,
  unnamedCenter,
  unnamedSite,
  type PickerWording,
} from '../format/display';
import { useCatalogueSupplement, useNearbySupplement } from '../hooks/useCatalogueSupplement';
import { t, useT } from '../i18n';
import { completePlacePick, forgetPlacePick, placePickRequest } from '../navigation/placePick';
import { roughPosition, type PositionOutcome, type PositionRefusal } from '../platform/location';
import { themeFor, resolveScheme } from '../theme/resolve';
import { makeStyles, screenBottomInset, screenTopInset, type Styles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/** The page's three glyphs, monochrome, through `symbolName` like every other in the app. Exported
 * so `symbolName.test.tsx` can pin their Android and web names. */
export const PICKER_SEARCH_GLYPH: PlatformSymbol = { ios: 'magnifyingglass', android: 'search' };
export const PICKED_PLACE_GLYPH: PlatformSymbol = { ios: 'checkmark', android: 'check' };
export const CREATE_PLACE_GLYPH: PlatformSymbol = { ios: 'plus', android: 'add' };

/**
 * Near me's server question, at module scope with its radius bound. `useNearbySupplement` has no
 * delay and re-runs whenever its function arguments change identity, so an inline lambda here
 * would ask the server on every render.
 */
const NEAR_ME_RADIUS_M = NEAR_ME_RADIUS_KM * 1000;
const searchSitesNearMe = (cloud: Cloud, point: MapPoint) => searchSitesNear(cloud, point, NEAR_ME_RADIUS_M);
const searchCentersNearMe = (cloud: Cloud, point: MapPoint) => searchCentersNear(cloud, point, NEAR_ME_RADIUS_M);

/**
 * The create page for `kind`, carrying the form's token and the typed name — `/site/new` or
 * `/center/new`, which complete the same request two screens up. Checked by typed routes.
 */
function newPlaceHref(kind: PlaceKind, token: string, name: string): Href {
  return { pathname: kind === 'site' ? '/site/new' : '/center/new', params: { token, name } };
}

/** *Near me*: off (perhaps having just said why), asking the device, or on with a fix. */
type NearMe =
  | { state: 'off'; refusal: PositionRefusal | null }
  | { state: 'locating' }
  | { state: 'on'; fix: MapPoint };

/** One line of the list: a group's header, a place, *No centre*, or *Create "…"*. */
type PickerItem =
  | { type: 'title'; key: string; text: string }
  | { type: 'place'; key: string; group: PickerGroupKey; row: PickerRow }
  | { type: 'noCenter'; key: string }
  | { type: 'create'; key: string; name: string };

/** Why Near me came back empty, worded for a list rather than for the form's GPS row. A timeout
 * and a failure ask the same of the diver, so they share a sentence; `roughPosition` never answers
 * `imprecise`, and it would mean the same if it did. */
function refusalSentence(reason: PositionRefusal): string {
  switch (reason) {
    case 'denied':
      return t('picker.locationDenied');
    case 'servicesOff':
      return t('picker.locationServicesOff');
    case 'timedOut':
    case 'imprecise':
    case 'failed':
      return t('picker.locationFailed');
  }
}

/**
 * **Choose a site / Choose a centre** (`/pick/site`, `/pick/center`; issue #19) — the page the dive
 * form's *Site* and *Centre* rows push, and the one way a place reaches a dive: picked from the
 * list, or created through the *Create "…"* row. The site-picker design's *The picker page* is the
 * description this follows.
 *
 * ── The list is `pickerGroups`', the page decides nothing about it ─────────────────────────
 *
 * Which rows, under which heading, in what order, which one is checked — all of that is
 * `domain/placePicker.ts`, run over the device's catalogue (live, so a row the supplement or the
 * create page writes appears as it lands) and the diver's dives. The call is memoised here on its
 * inputs, because it pairs every place with the logbook each time it runs. What this page owns is
 * the wording (`format/display.ts`), the three ways off it, and *Near me*.
 *
 * ── Three ways off, and the form hears about one ────────────────────────────────────────────
 *
 * A pick (a row, or *No centre*) completes the form's request through `navigation/placePick.ts`,
 * which hands the form the place and closes this page. `‹ Cancel` and swipe-back forget the request
 * and leave the form as it was. *Create* pushes the create page with the same token and the typed
 * name, and that page completes the request itself. A token the registry no longer knows (a JS
 * reload under an open page) costs only the *Selected* line and the centre picker's *Near [site]*:
 * the list, the search and *Create* work, and a pick simply closes the page.
 *
 * ── Near me asks the device only when pressed ───────────────────────────────────────────────
 *
 * `roughPosition`, never `currentPosition` — the fix sorts a 50 km list and is stored nowhere. A
 * second press while the first is out is ignored rather than asked again, and a fix that lands after
 * the page closed is dropped.
 */
export default function PlacePickerScreen({ kind }: { kind: PlaceKind }) {
  // The subscription that repaints this screen when the diver changes the language (src/i18n).
  useT();
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const insets = useSafeAreaInsets();
  const units = useUnitSystem();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = (Array.isArray(params.token) ? params.token[0] : params.token) ?? '';
  // Read once: completing the request forgets it, and the page should not lose its *Selected*
  // line in the moment between the pick and the page closing.
  const [request] = useState(() => placePickRequest(token));

  const siteCatalogue = useDiveSites();
  const centerCatalogue = useDiveCenters();
  const { dives, resolved: divesResolved } = useDives();
  const { session } = useAuthSession();
  const [query, setQuery] = useState('');
  const [nearMe, setNearMe] = useState<NearMe>({ state: 'off', refusal: null });
  const fix = nearMe.state === 'on' ? nearMe.fix : null;

  // §2.3's online supplement, for the table this page is choosing from and never the other: each
  // pair is handed a blank query or no point when it is not this page's, which asks nothing.
  useCatalogueSupplement(kind === 'site' ? query : '', searchSites, applyPulledDiveSites);
  useCatalogueSupplement(kind === 'center' ? query : '', searchCenters, applyPulledDiveCenters);
  useNearbySupplement(kind === 'site' ? fix : null, searchSitesNearMe, applyPulledDiveSites);
  useNearbySupplement(kind === 'center' ? fix : null, searchCentersNearMe, applyPulledDiveCenters);

  const catalogue = kind === 'site' ? siteCatalogue : centerCatalogue;
  const places: readonly PickerPlace[] = kind === 'site' ? siteCatalogue.sites : centerCatalogue.centers;

  // The centre picker's *Near [site]*: the site the dive is paired to, when it has a position.
  const siteId = request?.dive.siteId ?? null;
  const pairedSite =
    kind === 'center' && siteId !== null ? (siteCatalogue.sites.find((s) => s.id === siteId) ?? null) : null;
  const nearSite = useMemo(() => (pairedSite === null ? null : pointOf(pairedSite)), [pairedSite]);

  const signedIn = session !== null;
  const userId = session?.user.id ?? null;
  const selectedId = request?.selected?.id ?? null;
  const groups = useMemo(
    () =>
      pickerGroups({ kind, places, dives, query, selectedId, near: fix, nearSite, viewer: { signedIn, userId } }),
    [kind, places, dives, query, selectedId, fix, nearSite, signedIn, userId],
  );

  // A fix that lands after the page has gone is dropped; leaving by swipe-back forgets the request
  // exactly as `‹ Cancel` does, so the registry does not keep a closed page's request.
  const alive = useRef(true);
  const locating = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      forgetPlacePick(token);
    };
  }, [token]);

  // **The first way off the page wins.** A second tap on a row would complete again, and its
  // second `dismiss` would pop the dive form itself; a second tap on *Create* would stack two
  // create pages. So a pick, *No centre*, `‹ Cancel` and *Create* each claim this before acting
  // and do nothing once it is claimed. *Create* is the one way off that can come back — `‹ Back`
  // on the create page returns here with the query intact — so the claim is released whenever the
  // page is focused again.
  const leaving = useRef(false);
  useFocusEffect(
    useCallback(() => {
      leaving.current = false;
    }, []),
  );
  const once = (go: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    go();
  };

  const toggleNearMe = () => {
    // A second press while the device is still answering asks nothing (Review Focus 1); the ref
    // rather than the state, because two taps can land before the re-render that would show it.
    if (locating.current) return;
    if (nearMe.state === 'on') {
      setNearMe({ state: 'off', refusal: null });
      return;
    }
    locating.current = true;
    setNearMe({ state: 'locating' });
    void (async () => {
      let outcome: PositionOutcome;
      try {
        outcome = await roughPosition();
      } catch {
        outcome = { found: false, reason: 'failed' };
      }
      locating.current = false;
      if (!alive.current) return;
      setNearMe(
        outcome.found
          ? { state: 'on', fix: { latitude: outcome.latitude, longitude: outcome.longitude } }
          : { state: 'off', refusal: outcome.reason },
      );
    })();
  };

  const typed = query.trim();
  const unnamed = kind === 'site' ? unnamedSite : unnamedCenter;
  const wording: PickerWording = {
    siteName: pairedSite === null ? '' : (pairedSite.name ?? unnamedSite()),
    nearRadiusKm: NEAR_ME_RADIUS_KM,
    system: units,
  };

  const items: PickerItem[] = [];
  for (const group of groups) {
    items.push({
      type: 'title',
      key: `title-${group.key}`,
      // Counted while something is typed — except *Near you*, whose heading already states a bound.
      text: formatPickerGroupTitle(group.key, kind, typed === '' || group.key === 'near' ? null : group.rows.length, wording),
    });
    for (const row of group.rows) items.push({ type: 'place', key: `${group.key}-${row.id}`, group: group.key, row });
  }
  // *No centre* is the history list's last answer, so it goes with that list: not while a name is
  // typed (that is a search) and not under Near me (that is a different question).
  if (kind === 'center' && typed === '' && fix === null) {
    items.push({ type: 'title', key: 'title-or', text: t('picker.or') });
    items.push({ type: 'noCenter', key: 'no-center' });
  }
  if (typed !== '') items.push({ type: 'create', key: 'create', name: typed });

  // What stands where rows would be. A failed read is said and the list is still drawn from
  // whatever the read last held (Review Focus 4). "Nothing near" only when the catalogue has
  // answered with rows: an unread table and an empty one are the same `[]`, and a failed read is
  // `resolved` too (db/liveQuery.ts), so a page that could not read it must not also call it empty.
  const notes: string[] = [];
  if (catalogue.error !== undefined) notes.push(catalogueUnreadable());
  if (
    fix !== null &&
    catalogue.resolved &&
    catalogue.error === undefined &&
    !groups.some((group) => group.key === 'near')
  ) {
    const distance = formatDistance(NEAR_ME_RADIUS_KM, units);
    notes.push(
      typed === '' ? t('picker.nothingNear', { distance }) : t('picker.nothingNearMatches', { distance, query: typed }),
    );
  }
  // A page with no place to list — a diver with no dives yet, nothing typed, *Near me* off — says
  // that typing is the way in, as the Search screen's empty field does; it opened on a title, a
  // search and a pill otherwise. Not before both reads have answered, so it never stands for a
  // moment over the *Dived here* rows about to arrive. The centre picker's *Or · No centre* is not a
  // place, so the line stands above it there.
  if (typed === '' && nearMe.state === 'off' && groups.length === 0 && divesResolved && catalogue.resolved) {
    notes.push(t(kind === 'site' ? 'picker.promptSite' : 'picker.promptCenter'));
  }

  const selected = request?.selected ?? null;
  const selectedName =
    selected === null ? null : selected.name !== '' ? selected.name : selected.id !== null ? unnamed() : null;

  const pick = (row: PickerRow) => once(() => completePlacePick(token, { id: row.id, name: row.name ?? '' }, 1));
  const pickNoCenter = () => once(() => completePlacePick(token, { id: null, name: '' }, 1));
  const leave = () =>
    once(() => {
      forgetPlacePick(token);
      router.back();
    });
  const create = (name: string) => once(() => router.push(newPlaceHref(kind, token, name)));

  const on = nearMe.state === 'on';
  const busy = nearMe.state === 'locating';
  const refusal = nearMe.state === 'off' && nearMe.refusal !== null ? refusalSentence(nearMe.refusal) : null;

  const renderItem = ({ item }: { item: PickerItem }) => {
    switch (item.type) {
      case 'title':
        return <Text style={styles.pickerGroupTitle}>{item.text}</Text>;
      case 'place':
        return (
          <PlaceRow
            row={item.row}
            name={item.row.name ?? unnamed()}
            meta={formatPickerMeta(item.row, item.group, kind, wording)}
            figure={formatPickerFigure(item.row, item.group, kind, units)}
            distance={item.group === 'near' || item.group === 'nearSite'}
            styles={styles}
            onPress={() => pick(item.row)}
          />
        );
      case 'noCenter':
        return (
          <Pressable
            style={styles.pickerRow}
            onPress={pickNoCenter}
            accessibilityRole="button"
          >
            <View style={styles.pickerRowBody}>
              <Text style={styles.pickerRowName}>{t('picker.noCenter')}</Text>
              <Text style={styles.pickerRowMeta}>{t('picker.noCenterMeta')}</Text>
            </View>
            <Text style={styles.pickerRowDistance}>{NO_FIGURE}</Text>
          </Pressable>
        );
      case 'create':
        return (
          <Pressable style={styles.pickerRow} onPress={() => create(item.name)} accessibilityRole="button">
            <View style={styles.pickerRowBody}>
              <Text style={styles.pickerRowName}>{t('picker.create', { name: item.name })}</Text>
              <Text style={styles.pickerRowMeta}>{formatCreatePlaceMeta(kind, signedIn)}</Text>
            </View>
            <Glyph symbol={CREATE_PLACE_GLYPH} size={16} tint={styles.pickerGlyphMuted.color} />
          </Pressable>
        );
    }
  };

  return (
    // `padding` on iOS and `height` on Android, RN's own pairing: the list ends above the keyboard,
    // which is up from the moment the page opens.
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Pressable style={styles.pickerBack} onPress={leave} accessibilityRole="button" accessibilityLabel={t('picker.leave')}>
        <Text style={styles.pickerBackLabel}>{t('back.cancel')}</Text>
      </Pressable>
      <Text style={styles.pickerHeading} accessibilityRole="header">
        {t(kind === 'site' ? 'picker.titleSite' : 'picker.titleCenter')}
      </Text>
      {selectedName !== null && (
        <View style={styles.pickerSelected}>
          <Glyph
            symbol={PICKED_PLACE_GLYPH}
            size={12}
            tint={styles.pickerGlyphMuted.color}
            style={styles.pickerSelectedCheck}
          />
          {/* One `Text`, so the name wraps under *Selected:* rather than beside it — and never clips. */}
          <Text style={styles.pickerSelectedText}>
            <Text style={styles.pickerSelectedLabel}>{t('picker.selected')}</Text> {selectedName}
          </Text>
        </View>
      )}
      <SearchField
        scheme={scheme}
        value={query}
        onChangeText={setQuery}
        placeholder={t(kind === 'site' ? 'picker.searchSites' : 'picker.searchCenters')}
      />
      <View style={styles.pickerPills}>
        <Pressable
          style={styles.pickerNearMe}
          onPress={toggleNearMe}
          accessibilityRole="button"
          accessibilityState={{ selected: on, busy }}
        >
          <View style={[styles.pickerNearMePill, on && styles.pickerNearMePillOn]}>
            <Text style={[styles.pickerNearMeLabel, on && styles.pickerNearMeLabelOn]}>
              {busy ? t('picker.locating') : t('picker.nearMe')}
            </Text>
          </View>
        </Pressable>
      </View>
      {refusal !== null && (
        <View style={styles.pickerNote}>
          <Text style={styles.pickerNoteText}>{refusal}</Text>
        </View>
      )}
      <FlatList
        style={styles.pickerList}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListHeaderComponent={
          notes.length === 0 ? null : (
            <View>
              {notes.map((note) => (
                <View key={note} style={styles.pickerNote}>
                  <Text style={styles.pickerNoteText}>{note}</Text>
                </View>
              ))}
            </View>
          )
        }
        contentContainerStyle={[styles.pickerListContent, { paddingBottom: screenBottomInset(insets.bottom) }]}
        // `SearchScreen`'s pair: a drag reads, so the keyboard goes; a tap still picks the row
        // rather than being spent putting the keyboard away.
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      />
    </KeyboardAvoidingView>
  );
}

/**
 * One place: its name (never truncated), what the diver has done there or where it came from, and
 * trailing either its figure — the deepest dive in ink, a distance muted — or, for the place the
 * field already holds, a check instead.
 */
function PlaceRow({
  row,
  name,
  meta,
  figure,
  distance,
  styles,
  onPress,
}: {
  row: PickerRow;
  name: string;
  meta: string | null;
  figure: string | null;
  distance: boolean;
  styles: Styles;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.pickerRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: row.selected }}
    >
      <View style={styles.pickerRowBody}>
        <Text style={styles.pickerRowName}>{name}</Text>
        {meta !== null && <Text style={styles.pickerRowMeta}>{meta}</Text>}
      </View>
      {row.selected ? (
        <Glyph symbol={PICKED_PLACE_GLYPH} size={16} tint={styles.pickerGlyphInk.color} />
      ) : (
        figure !== null && <Text style={distance ? styles.pickerRowDistance : styles.pickerRowFigure}>{figure}</Text>
      )}
    </Pressable>
  );
}

/** A monochrome glyph, through `symbolName` so Android and the browser draw it too. */
function Glyph({
  symbol,
  size,
  tint,
  style,
}: {
  symbol: PlatformSymbol;
  size: number;
  tint: ColorValue | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  return <SymbolView name={symbolName(symbol)} size={size} tintColor={tint} style={style} />;
}

/**
 * The search field at the top of the page: a magnifier, the input — focused on open, so the
 * keyboard is up — and the clear ring once it holds text (`ClearFieldControl`, the form's own).
 * Typed names become new places through *Create*, so it capitalises words and never autocorrects.
 */
function SearchField({
  scheme,
  value,
  onChangeText,
  placeholder,
}: {
  scheme: ColorScheme;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}) {
  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);
  return (
    <View style={styles.pickerSearch}>
      <Glyph symbol={PICKER_SEARCH_GLYPH} size={18} tint={styles.pickerGlyphInk.color} />
      <TextInput
        style={styles.pickerSearchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.fgMuted}
        accessibilityLabel={placeholder}
        autoFocus
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value !== '' && (
        <ClearFieldControl accessibilityLabel={t('picker.clearSearch')} onPress={() => onChangeText('')} scheme={scheme} />
      )}
    </View>
  );
}
