import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateTimeField } from '../components/DateTimeField';
import { FieldNote } from '../components/FieldNote';
import { FormField } from '../components/FormField';
import {
  createCertification,
  softDeleteCertification,
  updateCertification,
} from '../db/certifications';
import { db } from '../db/client';
import { useCertifications } from '../db/useCertifications';
import {
  certificationRefusal,
  type CertificationFields,
} from '../domain/certifications';
import { type Certification } from '../domain/types';
import { backToSettings } from '../navigation/leaveScreen';
import { confirmDestructive } from '../platform/confirmDestructive';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenTopInset, type Styles } from '../theme/styles';

/**
 * Shown when the id names nothing live — deleted on another device, or a stale deep link.
 *
 * Said rather than swallowed, and above all this screen does not fall back to a blank *new*
 * card: `MISSING_DIVE_MESSAGE` (DiveFormScreen.tsx) records why that is the dangerous option —
 * a form that quietly created a NEW row because it could not find the one it was editing would
 * duplicate on the device that still has it, and again on every later attempt. `mode` is what
 * makes the two cases tellable apart here, exactly as it does on the dive form.
 */
const MISSING_CERTIFICATION_MESSAGE = "Couldn't find that certification — it may have been deleted.";

/**
 * What a failed read says, on both screens that show a card.
 *
 * A different sentence from the one above on purpose: `useCertifications`' `error` field exists
 * for exactly this distinction, and telling a diver their card may have been deleted when the
 * database simply could not be read sends them looking for something that is still there.
 * Shared with Settings, which says the same thing about the same event one route up — two
 * screens naming the same object is what turns a look-alike into a copy (`PRESETS_UNREADABLE`,
 * domain/presets.ts, is the same call one object over).
 */
export const CERTIFICATIONS_UNREADABLE = "Couldn't load your certifications. Try again.";

/** Shown when the write rejects. §10: "a local save failure is shown to the diver" — the
 * alternative is a diver believing their card is stored and finding an empty wallet on the
 * boat where they were asked for it. */
const SAVE_ERROR_MESSAGE = "Couldn't save that certification. Try again.";

/** Shown when `softDeleteCertification`'s write rejects. Its own literal, unlike the read
 * failure above: no other screen deletes a card, so there is nothing here for a second copy to
 * drift from — `GearPresetScreen`'s own delete error makes the same call. */
const DELETE_ERROR_MESSAGE = "Couldn't delete that certification. Try again.";

/** What the delete confirmation says — `GearPresetScreen`'s own pair, one object over. Held
 * here rather than inline so a test can assert on the same strings the diver reads. */
const DELETE_TITLE = 'Delete this certification?';
const DELETE_BODY = "It will be removed from your wallet. This can't be undone.";

/**
 * The five fields as text, plus the card they came from.
 *
 * **Keyed on the id, not on the object** — `PresetDraft`'s rule and for its stated reason:
 * `useCertifications` hands back a fresh array of fresh objects whenever the query re-runs,
 * including on this screen's own save, so an identity comparison could never settle. A string
 * compares by value and settles on the second render.
 *
 * **And there is no `units` half**, which is the one way this differs from `PresetDraft`.
 * Nothing on this screen is a converted figure: an agency, a course and a card number are
 * text, and a date is a calendar date in both systems. So the unit-change defect that
 * docblock records as still open cannot arise here at all.
 *
 * The consequence worth stating, and it is the same one: once seeded, the diver's draft wins
 * over a later change to the same CARD from elsewhere — the gate compares an identity that has
 * not changed, so there is nothing to reseed from.
 */
interface CertificationDraft extends CertificationFields {
  /** `null` in create mode, where there is no card to be keyed on and the draft seeds once. */
  sourceId: string | null;
}

function draftFor(certification: Certification | null): CertificationDraft {
  return {
    sourceId: certification?.id ?? null,
    agency: certification?.agency ?? null,
    course: certification?.course ?? null,
    cardNumber: certification?.cardNumber ?? null,
    issuedOn: certification?.issuedOn ?? null,
    expiresOn: certification?.expiresOn ?? null,
  };
}

export interface CertificationScreenProps {
  /**
   * `'create'` writes a new card, `'edit'` writes the one `certificationId` names.
   *
   * **A mode rather than "an id means edit"**, which is `DiveFormScreen`'s shape and is the
   * one that can tell *there is no card yet* from *the card you asked for is gone*. Without
   * it those two states are both "no certification in hand", and the screen would either
   * refuse to create or silently create a duplicate — the defect `MISSING_DIVE_MESSAGE`
   * records. `GearPresetScreen` gets away with a bare optional id because §10 puts preset
   * creation in the dive form; a certification has nowhere else to come from.
   */
  mode: 'create' | 'edit';
  /** Which card `mode="edit"` is for — found inside `useCertifications()`'s own list, never
   * fetched with a second query, exactly as `GearPresetScreen` finds its preset. */
  certificationId?: string;
}

/**
 * The certification editor (DESIGN.md §3's wallet, §6's table), at `/certification/new` and
 * `/certification/[id]` via thin re-exports in `src/app/certification/`; this file lives
 * outside expo-router's swept tree so its colocated test is not bundled into the app, the same
 * shape every other screen here has.
 *
 * **The read is `useCertifications()` and nothing else**, exactly as `GearPresetScreen` finds
 * its preset inside `useGearPresets()`: the card shown here is found by id in the list the
 * Settings row was tapped from, never fetched with a second, independent query. A second read
 * path is a second place this screen could disagree with the list that opened it — the class
 * of mistake §4.1 opens with.
 *
 * **It is not react-hook-form, for `GearPresetScreen`'s reason**: that library buys a
 * thirty-field form per-field validation, dirty tracking and a resolver, and this is five text
 * boxes with no coercion at all — the dates are the platform's picker's and are canonicalised
 * by `db/certifications.ts` (§4.1), and the three text fields are trimmed by
 * `certificationRefusal` (domain/certifications.ts). A second Zod schema here would be a rule
 * written twice.
 *
 * **No chips.** `agency` is free text and `domain/certifications.ts` carries the whole
 * argument for why — the short version is that §6's `PADI·SSI·CMAS·…` is an open list, and a
 * closed one would make §10's store-and-flag ruling tell a BSAC diver that their own correct
 * answer came from another version of Ponor.
 */
export default function CertificationScreen({ mode, certificationId }: CertificationScreenProps) {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  // The device's own top clearance, from the app's one owner of that rule (`screenTopInset`,
  // theme/styles.ts) — never a constant, which is inside the safe area on an island phone.
  const insets = useSafeAreaInsets();
  // `resolved` is read alongside the list because `certifications` alone cannot say whether it
  // has been read yet — see the not-found branch below.
  const { certifications, error, resolved } = useCertifications();

  const certification =
    mode === 'create' || certificationId === undefined
      ? null
      : (certifications.find((card) => card.id === certificationId) ?? null);

  // React's own documented "adjusting some state when a prop changes" pattern, not the
  // effect-plus-setState round trip it replaces (which this repo's lint config rejects
  // outright). See `CertificationDraft` for what the gate is keyed on and why.
  const [draft, setDraft] = useState<CertificationDraft>(() => draftFor(certification));
  if (draft.sourceId !== (certification?.id ?? null)) {
    setDraft(draftFor(certification));
  }

  // The one refusal this screen can state (`certificationRefusal`), under the row it is about
  // — §0.6: "a field error is text, not a field. Muted, trailing, under the row it belongs
  // to." It sits under the LAST row rather than under a field, because the rule it reports is
  // about the card as a whole and no single row is at fault.
  const [note, setNote] = useState<string | null>(null);
  // Non-null only while an attempt has failed and not yet been retried — cleared at the START
  // of the next attempt, never on a timer, so it reads as "still true" for exactly as long as
  // it still is.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // §10's in-flight guard, in the two halves that must not be confused: the ref is written and
  // read synchronously, so the second tap of a double-tap is turned away before it can reach
  // the repository; `busy` is only how that is SHOWN. Without the ref a double-tap in create
  // mode writes two cards and pops the navigation stack twice.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const edit = (field: keyof CertificationFields, value: string) => {
    // Typing clears the note: it described a card that held nothing, and the diver has just
    // put something in it.
    setNote(null);
    setDraft((current) => ({ ...current, [field]: value }));
  };

  if (mode === 'edit' && certification === null) {
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        <BackControl styles={styles} />
        <View style={styles.centerFill}>
          {/* **Neither sentence is said until there is an answer to say one about** (M1f) —
              the gate `GearPresetScreen` and `DiveDetailScreen` both put on their own
              not-found lines, so all three go quiet in the same circumstances instead of each
              inventing a rule. `error` decides WHICH sentence; `resolved` decides WHETHER
              there is one, which works only because a failed read counts as an answer
              (`isResolved`, db/liveQuery.ts). The way out above is rendered on both branches
              and in both states (§0.6): a screen that could not find its card is exactly the
              one a diver most needs to leave. */}
          {resolved && (
            <Text style={styles.messageText}>
              {error === undefined ? MISSING_CERTIFICATION_MESSAGE : CERTIFICATIONS_UNREADABLE}
            </Text>
          )}
        </View>
      </View>
    );
  }

  const save = async () => {
    if (busyRef.current) return;

    // `certificationRefusal` (domain/certifications.ts) decides what is wrong and what the
    // stored values are; this decides where to say it. Nothing here trims or blanks a field
    // itself — that would be the same rule in two places, free to disagree about what a card
    // of spaces is.
    const refusal = certificationRefusal(draft);
    setNote(refusal.note);
    if (refusal.refused) return;

    busyRef.current = true;
    setBusy(true);
    setSaveError(null);
    setDeleteError(null);
    try {
      if (certification === null) {
        await createCertification(db, refusal.stored);
      } else {
        // The whole card, not a diff. `updateCertification`'s own docblock states why it can
        // take one: it compares field by field against the row as it stands, so an unchanged
        // Save is a no-op there rather than a write that advances §7's clock over nothing.
        await updateCertification(db, certification.id, refusal.stored);
      }
      backToSettings();
    } catch {
      setSaveError(SAVE_ERROR_MESSAGE);
    } finally {
      // Released on both paths, so a failed save leaves a control the diver can press again
      // rather than one that silently stopped working.
      busyRef.current = false;
      setBusy(false);
    }
  };

  const runDelete = async () => {
    if (busyRef.current || certification === null) return;
    busyRef.current = true;
    setBusy(true);
    setDeleteError(null);
    try {
      // Soft, never hard (§6): the `deleted_at` tombstone is what §7 needs to carry the
      // deletion to the diver's other devices. Every read already filters on it, so the card
      // leaves the wallet at once.
      await softDeleteCertification(db, certification.id);
      backToSettings();
    } catch {
      setDeleteError(DELETE_ERROR_MESSAGE);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // A confirmation drawn by the platform, not by this app — `GearPresetScreen` carries the
  // whole reasoning: §0.1 reserves colour for depth, so the destructive weight goes into
  // chrome the app does not draw, and `platform/confirmDestructive.ts` owns which chrome.
  const confirmDelete = () => {
    confirmDestructive({
      title: DELETE_TITLE,
      body: DELETE_BODY,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      onConfirm: () => void runDelete(),
    });
  };

  return (
    <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
      <BackControl styles={styles} />
      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={styles.formScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* What this screen is, not what the card is called: the agency and the course are
            editable fields two rows down, and a heading repeating them would go stale the
            moment they are typed over. `headingFor`'s own shape one screen over. */}
        <Text style={styles.certificationHeading}>
          {certification === null ? 'Add certification' : 'Edit certification'}
        </Text>

        {/* §3's own three words for this row — "agency, level, card number" — with `course`
            taking the middle one, because that is what §6 calls the column and what an agency
            prints on the card. The labels are literals for the reason §4.1 records (roughly
            twenty-five of them across the app, awaiting i18next). */}
        <FormField
          label="Agency"
          value={draft.agency ?? ''}
          onChange={(text) => edit('agency', text)}
          scheme={scheme}
          placeholder="PADI"
        />
        <FormField
          label="Course"
          value={draft.course ?? ''}
          onChange={(text) => edit('course', text)}
          scheme={scheme}
          placeholder="Rescue Diver"
        />
        <FormField
          label="Card number"
          value={draft.cardNumber ?? ''}
          onChange={(text) => edit('cardNumber', text)}
          scheme={scheme}
          // §0.6: "Figures in mono, names in sans." A card number is a figure, and a mono row
          // is what makes a long one readable back off the plastic digit by digit.
          mono
          placeholder="1234567"
        />
        {/* Dates through the platform's picker (§10, M1d: "an invalid date cannot be
            entered"), the same control the dive form's own date row uses. Both carry a clear
            (`onClear`), because both are genuinely optional — most cards never expire (§6),
            and "not recorded" has to be reachable from a field the diver has filled in by
            mistake. */}
        <DateTimeField
          label="Issued"
          value={draft.issuedOn}
          onChange={(value) => edit('issuedOn', value)}
          onClear={(value) => edit('issuedOn', value)}
          mode="date"
          scheme={scheme}
          placeholder="Not set"
        />
        <DateTimeField
          label="Expires"
          value={draft.expiresOn}
          onChange={(value) => edit('expiresOn', value)}
          onClear={(value) => edit('expiresOn', value)}
          mode="date"
          scheme={scheme}
          // A different empty state from *Issued*'s, and it is the fact rather than a
          // placeholder: §6 gives `expires_on` to "(O₂, first aid)", so a null here means this
          // card does not expire rather than that nobody has typed it yet.
          placeholder="Doesn’t expire"
        />
        <FieldNote message={note ?? undefined} scheme={scheme} />

        {/* Deleting, at the END of the content — the position *Delete dive* and *Delete
            preset* occupy, for the reason those screens record: a deliberate act on the one
            thing you are looking at should take a deliberate reach. Absent in create mode,
            where there is nothing yet to delete. */}
        {certification !== null && (
          <>
            {deleteError !== null && (
              <View style={styles.certificationNotice}>
                <Text style={styles.certificationNoticeText}>{deleteError}</Text>
              </View>
            )}
            <Pressable
              style={styles.certificationDelete}
              onPress={confirmDelete}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Delete certification"
              accessibilityState={{ disabled: busy }}
            >
              <Text style={styles.certificationDeleteLabel}>Delete certification</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* A sibling of the footer rather than scroll content, so it is visible without
          scrolling exactly as the control that produced it is. */}
      {saveError !== null && (
        <View style={styles.certificationNotice}>
          <Text style={styles.certificationNoticeText}>{saveError}</Text>
        </View>
      )}

      {/* §0.5: the primary action sits in the bottom third — a fixed footer outside the
          scroll, the dive form's own arrangement. */}
      <View style={[styles.formFooter, { paddingBottom: insets.bottom + 24 }]}>
        <Pressable
          style={styles.action}
          onPress={() => void save()}
          // Disabled only while a write is in flight, never for validity: §1's "never block a
          // save" binds the control itself, and a refusal here is a sentence next to the rows
          // it is about rather than a control that does nothing.
          disabled={busy}
          accessibilityRole="button"
          // Verb plus noun, naming what it writes — the shape `Save dive` and `Save preset`
          // already use, and the same words in both modes because it is the same act.
          accessibilityLabel="Save certification"
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.actionLabel}>Save certification</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The way out (§0.6: "leaving a screen has one treatment everywhere") — `formBack`, the
 * definition the dive form's `‹ Cancel`, the dive detail's `‹ Dives` and the preset editor all
 * share. Pinned above the scroll rather than scrolling with it, and rendered in the not-found
 * state too.
 *
 * It writes NOTHING. `backToSettings` (navigation/leaveScreen.ts) pops the stack, or replaces
 * to Settings for a cold deep link — never to the dives list, which is not the screen this one
 * sits on top of.
 */
function BackControl({ styles }: { styles: Styles }) {
  return (
    <Pressable
      style={styles.formBack}
      onPress={backToSettings}
      accessibilityRole="button"
      // Says what leaving does, which is the half a diver cannot see from the chevron —
      // deliberately free of the word "Save", so it can never be mistaken, by a screen reader
      // or by a test query, for the control at the bottom of the screen.
      accessibilityLabel="Leave without saving"
    >
      <Text style={styles.formBackLabel}>‹ Cancel</Text>
    </Pressable>
  );
}
