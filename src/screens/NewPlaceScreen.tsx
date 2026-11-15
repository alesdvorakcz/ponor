import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { KeyboardAvoidingView, Platform, Pressable, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EntryIcon } from '../components/EntryIcon';
import { FieldNote } from '../components/FieldNote';
import { FormField } from '../components/FormField';
import { RevealingScrollView } from '../components/FormReveal';
import { OptionChips } from '../components/OptionChips';
import { symbolName, type PlatformSymbol } from '../components/symbolName';
import { addCenter, addSite, findSiteTwins, type KnownCountry } from '../cloud/addToCatalogue';
import { useAuthSession } from '../cloud/useAuthSession';
import { type MapPoint } from '../domain/mapSites';
import { type PlaceKind } from '../domain/placePicker';
import { foldForMatching } from '../domain/search';
import { type Suggestion } from '../domain/suggest';
import {
  ENTRY_VALUES,
  SALINITY_VALUES,
  WATER_BODY_VALUES,
  type Entry,
  type Salinity,
  type WaterBody,
} from '../domain/types';
import { formatCoordinates, formatEntry, formatSalinity, formatWaterBody, NO_FIGURE } from '../format/display';
import { positionRefusalSentence } from '../format/positionRefusal';
import { useKeyboardShown } from '../hooks/useKeyboardShown';
import { t, useT } from '../i18n';
import { completePlacePick, placePickRequest, type PlacePick } from '../navigation/placePick';
import { countryFor } from '../platform/geocode';
import { currentPosition } from '../platform/location';
import { resolveScheme } from '../theme/resolve';
import { liftedBottomInset, makeStyles, screenTopInset, type Styles } from '../theme/styles';

/** The position card's glyph, monochrome, through `symbolName` like every other in the app. Exported
 * so `symbolName.test.tsx` can pin its Android and web names. */
export const CURRENT_POSITION_GLYPH: PlatformSymbol = { ios: 'location', android: 'near_me' };

/** Where the new place is, and whose answer that is: the dive's own pin, or the phone's, asked for. */
type Position = MapPoint & { from: 'dive' | 'phone' };

const first = (param: string | string[] | undefined) => (Array.isArray(param) ? param[0] : param);

/** *from this dive* while a value is still the one the dive handed the page; nothing once it is not. */
function fromDive<T>(value: T | null, dives: T | null | undefined): string | undefined {
  return value !== null && value === dives ? t('newPlace.fromThisDive') : undefined;
}

/**
 * §2.3's answer, worded: a catalogue row whose folded name **is** the name typed is not a question
 * (*“Lom Leštinka” is already a site.*); anything else is *Did you mean …?*. Both are the one tap
 * that picks the existing row instead.
 */
function matchSentence(match: Suggestion, typed: string): string {
  return foldForMatching(match.value) === foldForMatching(typed)
    ? t('newPlace.sameName', { name: match.value })
    : t('form.didYouMean', { name: match.value });
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
 * ── Saving, once ──────────────────────────────────────────────────────────────────────────
 *
 * A site asks §2.3's question first (`findSiteTwins`); its matches stand above the button, each one a
 * tap that picks the existing site, and the button becomes *Save as a new site anyway*. A centre
 * saves straight away. The row is then written, handed to the form two screens down and both pages
 * close (`completePlacePick(…, 2)`) — or, for a token the registry lost to a reload, the row is
 * written and this page just goes back. A failed write says so and changes nothing on the dive.
 *
 * Three refs keep each press to one outcome (Review Focus 1, 2): `inFlight` shuts Save from the
 * moment it is pressed — before any re-render could disable it — until a question or a failure hands
 * it back; `leaving` lets exactly one way off happen (`‹ Back`, a match, or a save that went
 * through); `alive` drops any answer that lands after the page has closed. A write already out when
 * the page closes still makes its row — it is the diver's own place, and the picker underneath lists
 * it — but nothing reaches the form.
 *
 * **What is saved is what is on screen.** Save is shut while the device is still being asked for a
 * position (a fix that landed after the write would be a position the diver asked for and the row
 * never got), and the name, the website and the chips are held still from Save until the question
 * or the failure hands them back, so nothing typed meanwhile is left out of the row. A new position
 * forgets a standing question, as a new name does: the server's check was asked around the old one.
 */
export default function NewPlaceScreen({ kind }: { kind: PlaceKind }) {
  // The subscription that repaints this screen when the diver changes the language (src/i18n).
  useT();
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  const { session, resolved } = useAuthSession();
  const params = useLocalSearchParams<{ token?: string | string[]; name?: string | string[] }>();
  const token = first(params.token) ?? '';
  // Read once, as the picker reads it: completing forgets the token.
  const [request] = useState(() => placePickRequest(token));
  const dive = request?.dive ?? null;

  const [name, setName] = useState(() => first(params.name) ?? '');
  const [position, setPosition] = useState<Position | null>(() =>
    kind === 'site' && dive !== null && dive.pin !== null ? { ...dive.pin, from: 'dive' } : null,
  );
  const [salinity, setSalinity] = useState<Salinity | null>(dive?.salinity ?? null);
  const [waterBody, setWaterBody] = useState<WaterBody | null>(dive?.waterBody ?? null);
  const [entry, setEntry] = useState<Entry | null>(dive?.entry ?? null);
  const [website, setWebsite] = useState('');
  const [locating, setLocating] = useState(false);
  const [positionNote, setPositionNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // §2.3's near-matches once the check has found some; their presence is also "the diver has been
  // asked", which is what makes the next press mean *anyway*.
  const [matches, setMatches] = useState<readonly Suggestion[]>([]);
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
  const country = shown?.country ?? null;

  const trimmed = name.trim();
  const guest = resolved && session === null;

  /** The first way off the page wins; every later one is a no-op. */
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

    if (kind === 'site' && matches.length === 0) {
      const found = await findSiteTwins(trimmed, at);
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
              { name: trimmed, latitude: at?.latitude ?? null, longitude: at?.longitude ?? null, entry, salinity, waterBody },
              known,
            )
          : await addCenter(
              {
                name: trimmed,
                latitude: at?.latitude ?? null,
                longitude: at?.longitude ?? null,
                website: website.trim() === '' ? null : website.trim(),
              },
              known,
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

  const pickMatch = (match: Suggestion) => {
    if (inFlight.current || match.id === null) return;
    deliver({ id: match.id, name: match.value });
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
          autoCapitalize="words"
          autoCorrect={false}
          spellCheck={false}
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
        {kind === 'site' ? (
          <>
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
          </>
        ) : (
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
        )}
        {/* Read-only: what the position says, in the stored ISO code a site's own page shows. */}
        <View style={styles.formField}>
          <View style={styles.formFieldRow}>
            <Text style={styles.formFieldLabel}>{t('field.country')}</Text>
            <Text style={country === null ? styles.newPlaceCountryNone : styles.newPlaceCountry}>{country ?? NO_FIGURE}</Text>
          </View>
        </View>
      </RevealingScrollView>

      {/* §2.3's answer stands above the button, outside the scroll, so the diver who pressed Save
          sees it without looking for it. Inert while a write is out: a pick then would be thrown
          away by the row the write is about to hand the form. */}
      {matches.map((match) => {
        const sentence = matchSentence(match, trimmed);
        return (
          <Pressable
            key={match.id ?? match.value}
            style={styles.formSuggestion}
            onPress={() => pickMatch(match)}
            accessibilityRole="button"
            accessibilityLabel={sentence}
            disabled={saving}
            accessibilityState={{ disabled: saving }}
          >
            <Text style={styles.formSuggestionText}>{sentence}</Text>
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
