import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FieldNote } from '../components/FieldNote';
import { FormField } from '../components/FormField';
import { authenticate, endSession, type AuthMode, type CredentialField } from '../cloud/auth';
import { localLogbook } from '../cloud/localLogbook';
import { cloud } from '../cloud/supabase';
import { useAuthSession } from '../cloud/useAuthSession';
import { backToSettings } from '../navigation/leaveScreen';
import { confirmDestructive } from '../platform/confirmDestructive';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenTopInset, type Styles } from '../theme/styles';

/**
 * §1, said to a diver rather than to a planner: "an account is only needed to back up, sync a
 * second device, and contribute named sites."
 *
 * It leads the form because it is the answer to the question a diver arrives with, and because
 * §1 makes the answer *"you don't have to"* — this screen is reached from a Settings row and
 * never gates anything, and the sentence is what says so on the screen itself rather than only
 * in the navigation.
 */
const WHAT_AN_ACCOUNT_IS_FOR =
  'Ponor works fully without an account. One backs your logbook up and syncs it to your other devices.';

/** The two things a diver does here, as the action's own label. The mode is one value and
 * these are two views of it (`SWITCH_TO`, below, is the third). */
const ACTION_LABEL: Record<AuthMode, string> = {
  signIn: 'Sign in',
  signUp: 'Create account',
};

/**
 * The way to the other mode — **named for where it goes, not for where it is**.
 *
 * `mutedControl`'s treatment (theme/styles.ts): a deliberate act that is not the screen's
 * primary one, exactly as *Delete preset* and *Save as preset* are, sitting at the end of the
 * content so it never competes with the action in the footer.
 *
 * A muted control rather than a chip row, though §0.6 has chips and this looks like a choice.
 * Two reasons. A chip row is a *field* — "a field is a row, label leading" — and this is not a
 * field of anything; giving it a label would have meant inventing a noun for "which of the two
 * things this screen is doing", and the heading and the button already say that. And it keeps
 * §5's one screen to one action, which is what stops a diver having to read a control before
 * they can read the button.
 */
const SWITCH_TO: Record<AuthMode, string> = {
  signIn: 'Create an account',
  signUp: 'I already have an account',
};

/** The other mode. One function so the control, the label and the state cannot disagree. */
function otherMode(mode: AuthMode): AuthMode {
  return mode === 'signIn' ? 'signUp' : 'signIn';
}

/**
 * §7.4's adoption sentence, or `null` when there is nothing to say.
 *
 * "The app **states what it did** afterwards rather than asking first: a prompt at sign-in is
 * a wall in front of the one flow §1 promises is optional, and the answer it collects is one
 * the diver can give better by looking at the list." So this is a statement, in the past
 * tense, with no control attached and nothing to dismiss — §7.4's own example wording, which
 * is where the shape of the sentence comes from.
 *
 * **Zero returns `null` rather than a sentence.** "0 dives from this phone were added to your
 * logbook" is a true sentence about nothing, and a diver signing in on a fresh phone has no
 * use for it. It is also what an adoption that could not run reports (`AuthOutcome.adopted`),
 * so silence is the honest answer in both cases.
 *
 * Exported so its own test reads the string the diver reads. The plural is spelled out rather
 * than bolted on with an `s`, because the verb moves too and "1 dives ... were added" is the
 * kind of sentence that makes an app look unfinished.
 */
export function adoptionSentence(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? '1 dive from this phone was added to your logbook.'
    : `${count} dives from this phone were added to your logbook.`;
}

/**
 * What the diver reads before the one destructive action in v1 (§7.4), and it is written to be
 * read rather than dismissed.
 *
 * §7.4: "Signing out wipes the local logbook. The data is on the server, signing back in
 * re-syncs it... So sign-out is a real erase, and the app must say so before it happens."
 * Three things are load-bearing in three sentences. The **title asks**, so the buttons answer
 * a question rather than confirming a statement. The body **names what goes and where it
 * goes** — a body saying only "this can't be undone" would be true and would leave a diver
 * believing their logbook was gone. And the reassurance is the *second* half, after the loss,
 * because a diver who reads only the first sentence must not be reassured out of noticing it.
 *
 * Held as constants rather than inline for `DELETE_TITLE`/`DELETE_BODY`'s own reason
 * (GearPresetScreen.tsx): a test asserts on the same strings the diver reads.
 */
export const SIGN_OUT_TITLE = 'Sign out?';
export const SIGN_OUT_BODY =
  'Your logbook will be removed from this device. It stays in your account, and signing back in brings it back.';

/**
 * What stands where the form would be when this build has no backend at all.
 *
 * **This screen is the reader `cloud.ts` was waiting for.** That module deliberately says
 * nothing about a missing or refused configuration — "this module owns the fact and not the
 * telling (§4.1) — it has no screen, no locale and no idea whether anyone is looking, and a
 * `console.warn` here fires on every launch of every build forever... The sign-in surface M2
 * builds is what reads `cause` and says so, once, to someone who asked." This is that, and
 * asking is opening this screen.
 *
 * It names the variables and quotes the library's own refusal, which is the one place in this
 * app where developer-facing text is the right register: the two ways to reach this branch are
 * a checkout with no `.env` and a `.env` with a typo in it, and the only person who can act on
 * either is the one who wrote it. A diver never sees it — a store build has both values
 * inlined at build time (`supabase.ts`, "Why the two reads are spelled out literally").
 */
function noBackendMessage(): string {
  if (cloud.configured) return '';
  if (cloud.cause !== undefined) {
    return `This build’s Supabase settings were refused: ${cloud.cause.message}`;
  }
  return `This build has no backend, so there is nothing to sign in to. Missing: ${cloud.missing.join(' and ')}.`;
}

/**
 * The account screen (DESIGN.md §5's auth bullet and §7.4) — signing in, creating an account,
 * and signing out. Route `/account` via a thin re-export in `src/app/account.tsx`; this file
 * lives outside expo-router's swept `src/app/` tree so its colocated test is not bundled into
 * the app, the same shape every other screen here has.
 *
 * **It is a screen stacked on Settings, not a tab and not a gate.** §1 is the constraint that
 * shapes the whole thing: "an account is only needed to back up, sync a second device, and
 * contribute named sites", and M1 shipped a complete logbook with no backend in existence. So
 * there is no launch screen, nothing to dismiss, and no route into this one but a row in
 * Settings (§3's "account & sync"). The way out is `‹ Settings`, present in every state
 * including the ones that have nothing else on them.
 *
 * **Nothing here is a login-screen idiom.** §0.6 exists because a screen was once "built to
 * spec and then styled by default into a different language", and the sign-in screen is where
 * that happens by reflex — every app has one and they all look alike. This one is the dive
 * form's grammar with different words in it: fields are rows (`FormField`), what went wrong is
 * text under the row it belongs to (`FieldNote`), the primary action is filled inverted ink in
 * a fixed footer, the secondary ones are muted labels at the end of the content, and leaving
 * has the one treatment it has everywhere.
 *
 * **Five states, and each is drawn for a reason the next one is not.**
 *
 * 1. *No backend* — `noBackendMessage` above.
 * 2. *Not answered yet* — the session read has not come back. Heading and way out, nothing
 *    else, which is M1f's rule as `DiveDetailScreen` and `GearPresetScreen` both apply it: a
 *    screen must not claim "you are not signed in" before anything has looked.
 * 3. *Signed out* — the form.
 * 4. *Signed up, not confirmed* — the owner switched email confirmation on (M2e), so creating
 *    an account does not sign anybody in. This state is what says so, and shows the address
 *    back.
 * 5. *Signed in* — who, §7.4's adoption sentence if there is one, and the way out of the
 *    account.
 *
 * **What is deliberately not here.** No sync trigger and no pending indicator (§7.5 and the
 * engine are their own task; this one only has to leave a session where that engine can find
 * it, which `useAuthSession` is). No Apple or Google (§5 has both before release; Apple is
 * mandatory once Google is offered). No password reset — it needs the `ponor://` deep link
 * handled, which is its own task, and this screen says nothing about recovery in either
 * direction: a link that cannot work is the dead affordance §10 has an entry about, and a line
 * claiming recovery is impossible would be false. No `delete_account` (§8 requires in-app
 * deletion and it is a later task).
 */
export default function AccountScreen() {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  // The device's own top clearance, from the app's one owner of that rule (`screenTopInset`,
  // theme/styles.ts) — never a constant, which is inside the safe area on an island phone.
  const insets = useSafeAreaInsets();
  // The one live read of who is signed in (`cloud/useAuthSession.ts`). `resolved` alongside
  // the session for the reason that module's own docblock gives: a `null` session cannot say
  // whether it means "nobody" or "the keychain has not answered".
  const { session, resolved } = useAuthSession();

  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  /**
   * **The one secret this app handles, and this is the only place it is stored.**
   *
   * It has to live here to be typed at all, and it lives nowhere else: it is not written to
   * the database, not put in a URL, not carried in navigation state, and never placed in a
   * message (`cloud/auth.ts` returns sentences from a fixed set precisely so a server's own
   * error text cannot echo it back onto the screen). It is cleared the moment an attempt
   * succeeds — see `submit` — so a signed-in screen left open is not holding one.
   */
  const [password, setPassword] = useState('');
  /**
   * What went wrong, and **which row it is about** (§0.6: "a field error is text, not a field.
   * Muted, trailing, under the row it belongs to").
   *
   * Two slots, and the reason there are exactly two is the reason there are not two *messages*.
   * A refusal this app made itself names its row — "Enter your email address." belongs under
   * *Email*, and shipped under *Password*, which is a sentence pointing two rows up; found by
   * putting the screen on a phone and reading it. Anything that came back from the **server**
   * carries no row, deliberately: Supabase answers a wrong password and an unknown address
   * with one `invalid_credentials` so that nobody can test whether an address has an account
   * (`CREDENTIALS_REJECTED`, cloud/auth.ts), and pinning that to one field would be this app
   * inventing the answer the server withheld. Those land under the password row, which is the
   * last row of the pair they are about.
   */
  const [note, setNote] = useState<{ message: string; field?: CredentialField } | null>(null);
  const noteFor = (row: CredentialField) =>
    note !== null && (note.field ?? 'password') === row ? note.message : undefined;
  // The address a confirmation mail went to, and the whole of state 4. Non-null only between a
  // successful sign-up and the diver leaving or going back to the form.
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  // §7.4's count, kept so the sentence survives the re-render that the arriving session causes:
  // the sign-in that produced the number is what switches this screen to state 5, so a number
  // held anywhere less durable than state would be gone before it was drawn.
  const [adopted, setAdopted] = useState(0);
  // Non-null only while a sign-out attempt has failed and not yet been retried — cleared at the
  // START of the next attempt, never on a timer, so it reads as "still true" for exactly as
  // long as it still is (`GearPresetScreen`'s own rule for its two notices).
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // §10's in-flight guard, in the two halves that must not be confused (GearPresetScreen.tsx):
  // the ref is written and read synchronously, so the second tap of a double-tap is turned away
  // before it reaches the network; `busy` is only how that is SHOWN, a render flag that by
  // definition lags a render behind and could never have enforced anything. Without the ref a
  // double-tap sends two sign-up requests, and the second one is rate-limited.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  if (!cloud.configured) {
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        <BackControl styles={styles} />
        <Text style={styles.accountHeading}>Account</Text>
        <View style={styles.accountCaption}>
          <Text style={styles.accountCaptionText}>{noBackendMessage()}</Text>
        </View>
      </View>
    );
  }

  // Captured after the narrowing above rather than read again inside each handler: `cloud` is a
  // module constant and the discriminated union is what makes `client` reachable at all
  // (supabase.ts), so taking it once here is what lets the closures below use it without each
  // re-asking a question this render has already answered.
  const client = cloud.client;

  const submit = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNote(null);
    try {
      const outcome = await authenticate(client, mode, { email, password }, localLogbook);
      if (outcome.kind === 'failed') {
        setNote({ message: outcome.message, field: outcome.field });
        return;
      }
      // Both successes end the diver's typing, so the secret goes. It is cleared here rather
      // than on unmount because this screen does not unmount on success — the session arrives
      // through `useAuthSession` and re-renders this same component into state 5, with whatever
      // is in this variable still in it.
      setPassword('');
      if (outcome.kind === 'confirmationSent') {
        setConfirmationSentTo(outcome.email);
        return;
      }
      setAdopted(outcome.adopted);
    } finally {
      // Released on both paths, so a failed attempt leaves a control the diver can press again
      // rather than one that silently stopped working.
      busyRef.current = false;
      setBusy(false);
    }
  };

  const runSignOut = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSignOutError(null);
    try {
      // `endSession` wipes first and ends the session only if the wipe succeeded — see its own
      // docblock for why that order is a safety property rather than a preference, and
      // `cloud/localLogbook.ts` for why the wipe is not wired up in this build.
      const outcome = await endSession(client, localLogbook);
      if (!outcome.ok) setSignOutError(outcome.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // A confirmation drawn by the platform, not by this app (§10: "a destructive confirmation is
  // OS chrome; the app's own control stays muted"). §0.1 reserves colour for depth, so there is
  // nothing here to make a destructive control look destructive — the weight goes into a dialog
  // this app does not draw, and `platform/confirmDestructive.ts` owns which one.
  const confirmSignOut = () => {
    confirmDestructive({
      title: SIGN_OUT_TITLE,
      body: SIGN_OUT_BODY,
      confirmLabel: 'Sign out',
      cancelLabel: 'Cancel',
      onConfirm: () => void runSignOut(),
    });
  };

  if (!resolved) {
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        <BackControl styles={styles} />
        {/* Heading and way out and nothing else: M1f's rule, which `DiveDetailScreen` and
            `GearPresetScreen` both apply to their own not-found branches — a screen must not
            say "you are not signed in" before anything has looked. The heading stays put
            through all of it, so this is a screen filling in rather than one appearing. */}
        <Text style={styles.accountHeading}>Account</Text>
      </View>
    );
  }

  if (session !== null) {
    // Every session this app can produce carries an address, because §5's one method is email
    // and password. The branch exists because `Session`'s own type leaves `email` optional, and
    // a row reading "Signed in as" with nothing after it would be a blank claim — §0.6 omits
    // rather than drawing a dash for a figure with nothing behind it. The way out of the
    // account stands either way, which is the half that matters.
    const address = session.user.email ?? null;
    const adoption = adoptionSentence(adopted);
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        <BackControl styles={styles} />
        <ScrollView
          style={styles.settingsScroll}
          contentContainerStyle={styles.settingsContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.accountHeading}>Account</Text>

          {address !== null && (
            <View style={styles.formField}>
              <View style={styles.formFieldRow}>
                <Text style={styles.formFieldLabel}>Signed in as</Text>
                <Text style={styles.accountEmail}>{address}</Text>
              </View>
            </View>
          )}

          {/* §7.4's adoption message: a statement about what already happened, in the app's
              own register, with nothing to dismiss and nothing blocked behind it. */}
          {adoption !== null && (
            <View style={styles.accountCaption}>
              <Text style={styles.accountCaptionText}>{adoption}</Text>
            </View>
          )}

          {/* Kept in this branch on purpose. `signOut` removes the local session before
              returning its error whenever the server refused or could not be reached, so a
              diver signing out at sea IS signed out — and this screen has already switched to
              the form. A notice rendered outside the branch would outlive the state it is
              about and report a failure that did not happen. */}
          {signOutError !== null && (
            <View style={styles.accountNotice}>
              <Text style={styles.accountNoticeText}>{signOutError}</Text>
            </View>
          )}

          {/* At the END of the content — the position *Delete dive* and *Delete preset*
              occupy, for the reason those record: the one act that removes something should
              take a deliberate reach. There is no footer on this branch, because signing out
              is not this screen's primary action and putting it in the slot §0.5 reserves for
              one would make the destructive control the easiest thing to hit. */}
          <Pressable
            style={styles.accountSecondaryAction}
            onPress={confirmSignOut}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            accessibilityState={{ disabled: busy }}
          >
            <Text style={styles.accountSecondaryActionLabel}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (confirmationSentTo !== null) {
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        <BackControl styles={styles} />
        <ScrollView
          style={styles.settingsScroll}
          contentContainerStyle={styles.settingsContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* The one state where the heading changes, and it changes because the diver has
              just acted and there is exactly one thing left for them to do. */}
          <Text style={styles.accountHeading}>Check your email</Text>

          {/* **The address, shown back.** A typo at registration is the failure confirmation
              exists to catch, and it is caught only if the diver can see what was typed. It is
              the normalised address the mail actually went to, not the raw text in the field —
              those differ by the trim `authenticate` performs. */}
          <View style={styles.formField}>
            <View style={styles.formFieldRow}>
              <Text style={styles.formFieldLabel}>Sent to</Text>
              <Text style={styles.accountEmail}>{confirmationSentTo}</Text>
            </View>
          </View>

          <View style={styles.accountCaption}>
            <Text style={styles.accountCaptionText}>
              Open the link in that email, then sign in here.
            </Text>
            {/* The two ways no mail arrives, said without asserting either. The app cannot
                tell them apart: with confirmation on, Supabase answers a sign-up against an
                address that already has an account exactly as it answers a new one, on
                purpose, so that nobody can test whether a given address is registered. */}
            <Text style={styles.accountCaptionText}>
              Nothing arrives? The address may be wrong, or it may already have an account —
              try signing in.
            </Text>
          </View>

          <Pressable
            style={styles.accountSecondaryAction}
            onPress={() => {
              setConfirmationSentTo(null);
              setMode('signIn');
              setNote(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Back to sign in"
          >
            <Text style={styles.accountSecondaryActionLabel}>Back to sign in</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
      <BackControl styles={styles} />
      {/* `keyboardShouldPersistTaps="handled"`, the same as the dive form's and Settings'
          own ScrollViews: RN's default spends the first tap dismissing the keyboard, so with
          the password field open a tap on *Create an account* would do nothing visible and
          need a second tap. */}
      <ScrollView
        style={styles.settingsScroll}
        contentContainerStyle={styles.settingsContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.accountHeading}>Account</Text>

        <View style={styles.accountCaption}>
          <Text style={styles.accountCaptionText}>{WHAT_AN_ACCOUNT_IS_FOR}</Text>
        </View>

        <View>
          <FormField
            label="Email"
            value={email}
            onChange={(text) => {
              // Typing clears the note: it described the pair that was in the boxes, and a
              // sentence about credentials the diver has already changed is a stale complaint.
              setNote(null);
              setEmail(text);
            }}
            scheme={scheme}
            keyboardType="email-address"
            // Both explicit, and both `'none'`/`false` for the same reason: an address the
            // device capitalised or corrected is a different address, and the diver does not
            // see it happen. §0.6 keeps names in sans, and an address is a name.
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="you@example.com"
          />
          {/* Only ever the refusal this app made about THIS row — see `note` above. */}
          <FieldNote message={noteFor('email')} scheme={scheme} />
          <FormField
            label="Password"
            value={password}
            onChange={(text) => {
              setNote(null);
              setPassword(text);
            }}
            scheme={scheme}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          {/* This row's own refusal, and everything the server said — which is about the pair
              and lands under the last row of it. */}
          <FieldNote message={noteFor('password')} scheme={scheme} />
        </View>

        <Pressable
          style={styles.accountSecondaryAction}
          onPress={() => {
            setMode(otherMode(mode));
            // The note described an attempt in the other mode — "that email already has an
            // account" is advice to switch, and it must not still be on screen after the
            // switch it was advising.
            setNote(null);
          }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={SWITCH_TO[mode]}
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.accountSecondaryActionLabel}>{SWITCH_TO[mode]}</Text>
        </Pressable>
      </ScrollView>

      {/* §0.5: the primary action sits in the bottom third — a fixed footer outside the
          scroll, the dive form's and the preset editor's own arrangement. `insets.bottom` is
          the one value here that cannot live in a scheme-only stylesheet. */}
      <View style={[styles.formFooter, { paddingBottom: insets.bottom + 24 }]}>
        <Pressable
          style={styles.action}
          onPress={() => void submit()}
          // Disabled only while a request is in flight, never for validity: §1's "never block"
          // binds the control itself, and a refusal here is a sentence next to the rows it is
          // about rather than a control that does nothing.
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={ACTION_LABEL[mode]}
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.actionLabel}>{ACTION_LABEL[mode]}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The way out (§0.6: "Leaving a screen has one treatment everywhere") — `formBack`, the
 * definition the dive form's `‹ Cancel` and the dive detail's `‹ Dives` already share, so this
 * cannot invent a second treatment for the same kind of object. Rendered in **every** state,
 * including the two that have nothing else on them: a screen with no backend, and one waiting
 * on a session read, are exactly the ones a diver most needs to leave.
 *
 * It says `‹ Settings` rather than `‹ Cancel`, which is the dive detail's form of the same
 * control. Nothing on this screen is a draft: there is no save, so there is nothing to cancel,
 * and naming the destination is what `‹ Dives` already does one screen over.
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
      // Says what leaving does, and deliberately free of the words that name this screen's own
      // controls, so it can never be mistaken — by a screen reader or by a test query — for
      // *Sign in* or *Sign out*.
      accessibilityLabel="Back to Settings"
    >
      <Text style={styles.formBackLabel}>‹ Settings</Text>
    </Pressable>
  );
}
