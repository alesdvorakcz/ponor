// The package's own official Jest mock — this screen calls useSafeAreaInsets() for its root's
// top clearance and its footer's bottom one, gets a real SafeAreaProvider from expo-router's
// root layout in the app, and has none when rendered bare here. Imported first, and named
// `mock...`, for the babel-plugin-jest-hoist reason DiveFormScreen.test.tsx records: a
// jest.mock() factory may only close over out-of-scope identifiers starting with
// `mock`/`require`, and every jest.mock() call is hoisted above every import regardless.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  authenticate,
  credentialRefusal,
  CREDENTIALS_REJECTED,
  EMAIL_REQUIRED,
  endSession,
  SIGN_OUT_UNAVAILABLE,
  type AuthOutcome,
  type Credentials,
  type SignOutOutcome,
} from '../cloud/auth';
import { localLogbook } from '../cloud/localLogbook';
import { useAuthSession } from '../cloud/useAuthSession';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { makeStyles } from '../theme/styles';
import AccountScreen, { adoptionSentence, SIGN_OUT_BODY, SIGN_OUT_TITLE } from './AccountScreen';

/**
 * **No real sign-in has ever been performed from this tree.** There are no credentials for the
 * owner's Supabase project here and none were sought — the repository is public and the only
 * key in it is the publishable one in a gitignored `.env`. Every test below drives a fake.
 *
 * What is deliberately **not** faked: the sentences. `../cloud/auth` keeps its real module
 * through `jest.requireActual`, so the strings asserted here are the strings the diver reads,
 * and only the two functions that would reach a network are replaced. A file that retyped
 * "That email and password don't match an account." would go on passing after the screen
 * started showing something else.
 */
jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../cloud/auth', () => ({
  ...jest.requireActual('../cloud/auth'),
  authenticate: jest.fn(),
  endSession: jest.fn(),
}));
jest.mock('../cloud/useAuthSession', () => ({ useAuthSession: jest.fn() }));
// The way out. Nothing else on this screen navigates.
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}));

/**
 * `../cloud/supabase` behind a getter, so each test decides what this build's one `cloud`
 * looks like. A plain object in the factory would be read once at import and pin every test to
 * one branch — and the branch that matters most here is the one where there is no backend at
 * all, which is the state `supabase.ts` says every screen must survive.
 */
let mockCloud: unknown = { configured: true, client: { itIsTheFakeClient: true } };
jest.mock('../cloud/supabase', () => ({
  get cloud() {
    return mockCloud;
  },
}));

const mockAuthenticate = authenticate as unknown as jest.Mock;
const mockEndSession = endSession as unknown as jest.Mock;
const mockUseAuthSession = useAuthSession as unknown as jest.Mock;

const CLIENT = { itIsTheFakeClient: true };
const SESSION = { access_token: 'fake', user: { id: 'u1', email: 'ales@example.com' } };

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

/**
 * The one live read this screen makes, stubbed per render.
 *
 * `mockImplementation`, never `mockReturnValue` — the discipline DivesScreen.test.tsx and
 * SettingsScreen.test.tsx both keep: a stub modelling "one frozen answer forever" is the wrong
 * shape to reach for, and this screen genuinely re-renders as the session arrives.
 */
function stubSession({
  session = null,
  resolved = true,
}: { session?: unknown; resolved?: boolean } = {}) {
  mockUseAuthSession.mockImplementation(() => ({ session, resolved }));
}

beforeEach(() => {
  mockCloud = { configured: true, client: CLIENT };
  stubSession();
  mockAuthenticate.mockImplementation(async (): Promise<AuthOutcome> => ({ kind: 'signedIn', adopted: 0 }));
  mockEndSession.mockImplementation(async (): Promise<SignOutOutcome> => ({ ok: true }));
});

afterEach(() => {
  mockAuthenticate.mockReset();
  mockEndSession.mockReset();
  mockUseAuthSession.mockReset();
  alertSpy.mockClear();
  (router.back as jest.Mock).mockClear();
  (router.replace as jest.Mock).mockClear();
});

function textIn(t: RenderResult): string[] {
  return (t.root ? t.root.queryAll((n) => n.type === 'Text') : [])
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

/** The whole rendered text as one string, for asserting that something is absent — the
 * screen wraps a caption across several `Text` children, so a per-child search would miss a
 * sentence that is genuinely on screen. */
function screenText(t: RenderResult): string {
  return textIn(t).join(' ');
}

function buttonLabels(t: RenderResult): string[] {
  return (t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : []).map((n) =>
    String(n.props?.accessibilityLabel ?? ''),
  );
}

function findControl(t: RenderResult, label: string) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === label) : [];
  return node;
}

async function pressControl(t: RenderResult, label: string) {
  const node = findControl(t, label);
  if (!node) throw new Error(`AccountScreen rendered no control labelled "${label}" (has: ${buttonLabels(t).join(', ')})`);
  await fireEvent.press(node);
}

function findField(t: RenderResult, label: string) {
  const [node] = t.root
    ? t.root.queryAll((n) => n.type === 'TextInput' && n.props?.accessibilityLabel === label)
    : [];
  if (!node) throw new Error(`AccountScreen did not render the "${label}" field`);
  return node;
}

/** Types a whole pair, which is what every attempt needs. */
async function typeCredentials(t: RenderResult, email: string, password: string) {
  await fireEvent.changeText(findField(t, 'Email'), email);
  await fireEvent.changeText(findField(t, 'Password'), password);
}

/** The buttons the platform Alert was actually asked to show — the third argument of the one
 * `Alert.alert` call, exactly as `confirmDestructive` passed it. Reading it off the real
 * `Alert` spy rather than mocking `platform/confirmDestructive` is what keeps the platform
 * module in the path, the same check `DiveDetailScreen.test.tsx` makes. */
function alertButtons(): { text?: string; style?: string; onPress?: () => void }[] {
  return (alertSpy.mock.calls[0]?.[2] ?? []) as { text?: string; style?: string; onPress?: () => void }[];
}

// ---------------------------------------------------------------------------------------
// The sentence §7.4 asks for
// ---------------------------------------------------------------------------------------

describe('the adoption sentence', () => {
  /** §7.4's own example wording. */
  it('says what happened, in the past tense, with the count', () => {
    expect(adoptionSentence(4)).toBe('4 dives from this phone were added to your logbook.');
  });

  /** The verb moves with the number, not just the noun: "1 dives ... were added" is the kind
   * of sentence that makes an app look unfinished. */
  it('reads correctly for a single dive', () => {
    expect(adoptionSentence(1)).toBe('1 dive from this phone was added to your logbook.');
  });

  /** A diver signing in on a fresh phone has no use for "0 dives ... were added", and it is
   * also what an adoption that could not run reports. */
  it('says nothing at all when nothing was adopted', () => {
    expect(adoptionSentence(0)).toBeNull();
    expect(adoptionSentence(-1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// The five states
// ---------------------------------------------------------------------------------------

/**
 * `supabase.ts` deliberately says nothing about a missing or refused configuration — "this
 * module owns the fact and not the telling... The sign-in surface M2 builds is what reads
 * `cause` and says so, once, to someone who asked." This is the one place that promise is
 * kept, so if it broke, nothing anywhere would report a build with no backend.
 */
describe('with no backend in this build', () => {
  it('names the variables the build did not supply, and offers no form to fill in', async () => {
    mockCloud = { configured: false, missing: ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'] };

    const t = await render(<AccountScreen />);

    expect(screenText(t)).toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(screenText(t)).toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    expect(buttonLabels(t)).not.toContain('Sign in');
  });

  /** The other half of the union: both values were supplied and `createClient` refused them,
   * which is a typo the owner cannot otherwise see. */
  it('quotes the refusal when the values were supplied and rejected', async () => {
    mockCloud = { configured: false, missing: [], cause: new Error('Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.') };

    const t = await render(<AccountScreen />);

    expect(screenText(t)).toContain('Invalid supabaseUrl');
  });

  /** A screen with nothing on it is exactly the one a diver most needs to leave. */
  it('still offers the way out', async () => {
    mockCloud = { configured: false, missing: ['EXPO_PUBLIC_SUPABASE_URL'] };

    const t = await render(<AccountScreen />);
    await pressControl(t, 'Back to Settings');

    expect(router.back).toHaveBeenCalledTimes(1);
  });
});

/**
 * M1f's rule, which `DiveDetailScreen` and `GearPresetScreen` both apply to their own
 * not-found branches: a screen must not claim "you are not signed in" before anything has
 * looked. `useAuthSession` exists to make that distinguishable at all.
 */
describe('before the session read has answered', () => {
  it('says nothing about being signed in or out, and still offers the way out', async () => {
    stubSession({ session: null, resolved: false });

    const t = await render(<AccountScreen />);

    expect(buttonLabels(t)).toEqual(['Back to Settings']);
    expect(screenText(t)).not.toContain('Signed in as');
  });
});

describe('signed out', () => {
  it('offers an email, a password and one action', async () => {
    const t = await render(<AccountScreen />);

    expect(findField(t, 'Email')).toBeDefined();
    expect(findField(t, 'Password')).toBeDefined();
    expect(buttonLabels(t)).toEqual(['Back to Settings', 'Sign in', 'Create an account']);
  });

  /**
   * §1's constraint, on the screen rather than only in the navigation: "an account is only
   * needed to back up, sync a second device, and contribute named sites."
   */
  it('says an account is optional before it asks for one', async () => {
    const t = await render(<AccountScreen />);

    expect(screenText(t)).toContain('Ponor works fully without an account');
  });

  /**
   * **The one secret this app handles.** A password field rendering in the clear is the exact
   * failure §0.6 collects — "shipped once and only found by using the app" — because nothing
   * about it errors, and the other two props are what stop a device silently rewriting a
   * credential the diver cannot then reproduce.
   */
  it('masks the password, and lets the device correct neither row', async () => {
    const t = await render(<AccountScreen />);

    const password = findField(t, 'Password');
    expect(password.props.secureTextEntry).toBe(true);
    expect(password.props.autoCapitalize).toBe('none');
    expect(password.props.autoCorrect).toBe(false);

    const email = findField(t, 'Email');
    expect(email.props.secureTextEntry).toBeUndefined();
    expect(email.props.autoCapitalize).toBe('none');
    expect(email.props.autoCorrect).toBe(false);
    expect(email.props.keyboardType).toBe('email-address');
  });

  /** The mode is one value, and the action, the switch and the call are three views of it. */
  it('switches to creating an account, and the action says so', async () => {
    const t = await render(<AccountScreen />);

    await pressControl(t, 'Create an account');

    expect(buttonLabels(t)).toEqual(['Back to Settings', 'Create account', 'I already have an account']);

    await pressControl(t, 'I already have an account');
    expect(buttonLabels(t)).toEqual(['Back to Settings', 'Sign in', 'Create an account']);
  });

  it('signs in with what was typed, in the mode on screen, through the app’s own seam', async () => {
    const t = await render(<AccountScreen />);
    await typeCredentials(t, 'ales@example.com', 'hunter2');

    await pressControl(t, 'Sign in');

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    const [client, mode, credentials, seam] = mockAuthenticate.mock.calls[0] as unknown[];
    expect(mode).toBe('signIn');
    expect(credentials).toEqual({ email: 'ales@example.com', password: 'hunter2' });
    /**
     * **The last two are `toBe`, and that is the whole point of them.** Written as
     * `toHaveBeenCalledWith(CLIENT, 'signIn', …, localLogbook)` this test passes with the
     * screen handing over an inline `{ wired: false }` — found by making exactly that edit and
     * watching the suite stay green, because `toHaveBeenCalledWith` compares structurally and
     * the app's unwired seam and a fresh copy of it are the same shape. A copy is precisely
     * the defect `cloud/localLogbook.ts` exists to name: it would go on working today and
     * would be the one call site left behind on the day the real seam is wired.
     *
     * The client is pinned the same way, for the same reason: `cloud` holds exactly one, and a
     * screen constructing its own would build a second `GoTrueClient` against one storage key
     * (`supabase.ts`, "Why a module-scope constant").
     */
    expect(seam).toBe(localLogbook);
    expect(client).toBe(CLIENT);
  });

  it('creates an account when that is the mode', async () => {
    mockAuthenticate.mockImplementation(async (): Promise<AuthOutcome> => ({
      kind: 'confirmationSent',
      email: 'ales@example.com',
    }));
    const t = await render(<AccountScreen />);
    await typeCredentials(t, 'ales@example.com', 'hunter2');
    await pressControl(t, 'Create an account');

    await pressControl(t, 'Create account');

    expect(mockAuthenticate.mock.calls[0]?.[1]).toBe('signUp');
  });

  /** §0.6: "A field error is text, not a field. Muted, trailing, under the row it belongs
   * to." Never a dialog, and never a control that silently does nothing. */
  it('shows what went wrong as text on the screen', async () => {
    mockAuthenticate.mockImplementation(async (): Promise<AuthOutcome> => ({
      kind: 'failed',
      message: CREDENTIALS_REJECTED,
    }));
    const t = await render(<AccountScreen />);
    await typeCredentials(t, 'ales@example.com', 'wrong');

    await pressControl(t, 'Sign in');

    expect(textIn(t)).toContain(CREDENTIALS_REJECTED);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  /**
   * §0.6: "under the row it belongs to." **Found by looking at the screen** — with one note
   * slot, "Enter your email address." rendered under *Password*, a sentence pointing two rows
   * up, and every test in this file was green. Asserted positionally, on the order the screen
   * actually draws its text in, because that order IS the claim: a note in the right words in
   * the wrong place is the defect.
   */
  it('puts a refusal about the email under the email row', async () => {
    // The REAL rule decides which row (`credentialRefusal` survives the module mock through
    // `jest.requireActual`), so this cannot drift into asserting the screen's own idea of it.
    mockAuthenticate.mockImplementation(async (_c: unknown, _m: unknown, credentials: Credentials): Promise<AuthOutcome> => {
      const refusal = credentialRefusal(credentials);
      return refusal === null
        ? { kind: 'signedIn', adopted: 0 }
        : { kind: 'failed', message: refusal.message, field: refusal.field };
    });
    const t = await render(<AccountScreen />);

    await pressControl(t, 'Sign in');

    const lines = textIn(t);
    expect(lines).toContain(EMAIL_REQUIRED);
    expect(lines.indexOf(EMAIL_REQUIRED)).toBeGreaterThan(lines.indexOf('Email'));
    expect(lines.indexOf(EMAIL_REQUIRED)).toBeLessThan(lines.indexOf('Password'));
  });

  /**
   * The other half of the same rule, and the reason there are two slots rather than two
   * messages: the server answers a wrong password and an unknown address with one
   * `invalid_credentials`, on purpose, so pinning it to a row would be this app inventing the
   * answer the server withheld. It lands under the last row of the pair it is about.
   */
  it('puts what the server said under the pair, not under one row of it', async () => {
    mockAuthenticate.mockImplementation(async (): Promise<AuthOutcome> => ({
      kind: 'failed',
      message: CREDENTIALS_REJECTED,
    }));
    const t = await render(<AccountScreen />);
    await typeCredentials(t, 'ales@example.com', 'wrong');

    await pressControl(t, 'Sign in');

    const lines = textIn(t);
    expect(lines.indexOf(CREDENTIALS_REJECTED)).toBeGreaterThan(lines.indexOf('Password'));
  });

  /** A sentence about credentials the diver has already changed is a stale complaint. */
  it('drops the message the moment either row is edited', async () => {
    mockAuthenticate.mockImplementation(async (): Promise<AuthOutcome> => ({
      kind: 'failed',
      message: CREDENTIALS_REJECTED,
    }));
    const t = await render(<AccountScreen />);
    await typeCredentials(t, 'ales@example.com', 'wrong');
    await pressControl(t, 'Sign in');
    expect(textIn(t)).toContain(CREDENTIALS_REJECTED);

    await fireEvent.changeText(findField(t, 'Password'), 'wrong-b');

    expect(textIn(t)).not.toContain(CREDENTIALS_REJECTED);
  });

  /**
   * §10's in-flight guard, in the half that actually enforces anything.
   *
   * **The two presses are fired inside ONE act, deliberately.** Written as two awaited presses
   * this test passes with the `busyRef` deleted — the first press re-renders with
   * `disabled={busy}` and `fireEvent.press` then refuses a disabled control, so the assertion
   * is satisfied by the render flag and never touches the ref. That is the guard-that-cannot-
   * fail shape this project keeps finding, and it was found here by deleting the ref and
   * watching the suite stay green. Fired back to back with no render in between, the second
   * press meets a control still announcing itself enabled, which is exactly the double-tap a
   * thumb produces and exactly what only the synchronous ref can turn away.
   */
  it('sends one request for a double tap, before any re-render could disable the control', async () => {
    let settle: ((outcome: AuthOutcome) => void) | undefined;
    mockAuthenticate.mockImplementation(
      () =>
        new Promise<AuthOutcome>((resolve) => {
          settle = resolve;
        }),
    );
    const t = await render(<AccountScreen />);
    await typeCredentials(t, 'ales@example.com', 'hunter2');
    const action = findControl(t, 'Sign in');
    if (!action) throw new Error('AccountScreen rendered no action');
    // The premise: the control is enabled at the moment BOTH presses land.
    expect(action.props.accessibilityState).toEqual({ disabled: false });

    await act(async () => {
      fireEvent.press(action);
      fireEvent.press(action);
    });

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    // ...and the flag has since done its own, different job: saying so on screen.
    expect(findControl(t, 'Sign in')?.props.accessibilityState).toEqual({ disabled: true });

    await act(async () => {
      settle?.({ kind: 'signedIn', adopted: 0 });
    });
  });

  /** §1 binds the control itself: a diver with an empty form still gets a button that does
   * something, and the refusal is a sentence rather than a dead control. */
  it('never disables the action for what has been typed', async () => {
    const t = await render(<AccountScreen />);

    expect(findControl(t, 'Sign in')?.props.accessibilityState).toEqual({ disabled: false });
  });
});

/**
 * The owner switched email confirmation **on** (M2e), so creating an account does not sign
 * anybody in. This state is what says so.
 */
describe('after a sign-up that sent a confirmation', () => {
  async function signUpSuccessfully(): Promise<RenderResult> {
    mockAuthenticate.mockImplementation(async (): Promise<AuthOutcome> => ({
      kind: 'confirmationSent',
      email: 'ales@example.com',
    }));
    const t = await render(<AccountScreen />);
    await typeCredentials(t, '  ales@example.com ', 'hunter2');
    await pressControl(t, 'Create an account');
    await pressControl(t, 'Create account');
    return t;
  }

  /**
   * **The address, shown back.** A typo at registration is the failure confirmation exists to
   * catch, and it is caught only if the diver can see what was sent to. It is the normalised
   * address `authenticate` reports, not the raw text still sitting in the field.
   */
  it('says to check the email, and shows which address it went to', async () => {
    const t = await signUpSuccessfully();

    expect(screenText(t)).toContain('Check your email');
    expect(textIn(t)).toContain('ales@example.com');
    expect(screenText(t)).toContain('Open the link in that email');
  });

  /**
   * Nothing was pushed, because nobody is signed in. §7.4's sentence here would be a claim
   * about a logbook that does not exist yet.
   */
  it('claims nothing about dives being added', async () => {
    const t = await signUpSuccessfully();

    expect(screenText(t)).not.toContain('added to your logbook');
  });

  it('offers a way back to the form, in sign-in mode', async () => {
    const t = await signUpSuccessfully();

    await pressControl(t, 'Back to sign in');

    expect(buttonLabels(t)).toEqual(['Back to Settings', 'Sign in', 'Create an account']);
  });
});

describe('signed in', () => {
  it('says who, and offers no form', async () => {
    stubSession({ session: SESSION });

    const t = await render(<AccountScreen />);

    expect(screenText(t)).toContain('Signed in as');
    expect(textIn(t)).toContain('ales@example.com');
    expect(buttonLabels(t)).toEqual(['Back to Settings', 'Sign out']);
  });

  /**
   * §7.4's adoption message end to end: the sign-in that produced the count is what switches
   * this screen into the signed-in state, so the number has to survive that re-render.
   */
  it('states what the sign-in did with this phone’s dives, afterwards and without blocking', async () => {
    mockAuthenticate.mockImplementation(async (): Promise<AuthOutcome> => ({ kind: 'signedIn', adopted: 4 }));
    const t = await render(<AccountScreen />);
    await typeCredentials(t, 'ales@example.com', 'hunter2');
    await pressControl(t, 'Sign in');

    // The session arrives through `useAuthSession`, exactly as it does in the app.
    stubSession({ session: SESSION });
    await t.rerender(<AccountScreen />);

    expect(textIn(t)).toContain('4 dives from this phone were added to your logbook.');
    // A statement, not a dialog (§7.4).
    expect(alertSpy).not.toHaveBeenCalled();
    expect(buttonLabels(t)).toEqual(['Back to Settings', 'Sign out']);
  });

  it('says nothing about adoption when there was nothing to adopt', async () => {
    mockAuthenticate.mockImplementation(async (): Promise<AuthOutcome> => ({ kind: 'signedIn', adopted: 0 }));
    const t = await render(<AccountScreen />);
    await typeCredentials(t, 'ales@example.com', 'hunter2');
    await pressControl(t, 'Sign in');
    stubSession({ session: SESSION });
    await t.rerender(<AccountScreen />);

    expect(screenText(t)).not.toContain('added to your logbook');
  });

  /**
   * **The secret does not outlive the call it was typed for.** The screen does not unmount on
   * success — the session arrives and re-renders this same component — so anything left in
   * that state variable would still be in memory behind the signed-in view.
   */
  it('keeps nothing of the password once the attempt succeeded', async () => {
    const t = await render(<AccountScreen />);
    await typeCredentials(t, 'ales@example.com', 'correct-horse-battery-staple');

    await pressControl(t, 'Sign in');

    expect(findField(t, 'Password').props.value).toBe('');
  });
});

/**
 * §7.4's sign-out — "the one destructive action in v1", which is why the ordering and the
 * confirmation are tested rather than assumed.
 */
describe('signing out', () => {
  /**
   * §10: "a destructive confirmation is OS chrome; the app's own control stays muted." §0.1
   * reserves colour for depth, so the weight has to go into a dialog this app does not draw.
   */
  it('asks first, through the platform’s own dialog, in the words §7.4 requires', async () => {
    stubSession({ session: SESSION });
    const t = await render(<AccountScreen />);

    await pressControl(t, 'Sign out');

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]?.[0]).toBe(SIGN_OUT_TITLE);
    expect(alertSpy.mock.calls[0]?.[1]).toBe(SIGN_OUT_BODY);
    // Both halves in one body: what goes, and that it comes back. A body naming only the loss
    // would be true and would leave a diver believing their logbook was gone for good.
    expect(SIGN_OUT_BODY).toContain('removed from this device');
    expect(SIGN_OUT_BODY).toContain('signing back in brings it back');
    expect(alertButtons().map((b) => b.style)).toEqual(['cancel', 'destructive']);
  });

  it('does nothing at all until the diver answers the dialog', async () => {
    stubSession({ session: SESSION });
    const t = await render(<AccountScreen />);

    await pressControl(t, 'Sign out');

    expect(mockEndSession).not.toHaveBeenCalled();
  });

  it('signs out through the app’s own seam once confirmed', async () => {
    stubSession({ session: SESSION });
    const t = await render(<AccountScreen />);
    await pressControl(t, 'Sign out');

    const destructive = alertButtons().find((b) => b.style === 'destructive');
    await act(async () => {
      destructive?.onPress?.();
    });

    // By identity on both, for the reason the sign-in call above records at length: a
    // structural comparison here is satisfied by a copy of the seam, which is the one thing
    // that must not exist.
    expect(mockEndSession).toHaveBeenCalledTimes(1);
    const [client, seam] = mockEndSession.mock.calls[0] as unknown[];
    expect(client).toBe(CLIENT);
    expect(seam).toBe(localLogbook);
  });

  /**
   * The same synchronous guard as the sign-in action's, on the one act in the app that
   * destroys something. It is written here as two calls to the dialog's own callback rather
   * than as two presses, because a press cannot reach it — the dialog is gone by then and the
   * control is disabled. That makes this the only way the ref on this path is defended at all,
   * and without it the line would be an untested claim.
   */
  it('erases and signs out once even if the confirmation fires twice', async () => {
    let settle: ((outcome: SignOutOutcome) => void) | undefined;
    mockEndSession.mockImplementation(
      () =>
        new Promise<SignOutOutcome>((resolve) => {
          settle = resolve;
        }),
    );
    stubSession({ session: SESSION });
    const t = await render(<AccountScreen />);
    await pressControl(t, 'Sign out');
    const destructive = alertButtons().find((b) => b.style === 'destructive');

    await act(async () => {
      destructive?.onPress?.();
      destructive?.onPress?.();
    });

    expect(mockEndSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle?.({ ok: true });
    });
  });

  /**
   * The state this build actually ships in: the wipe is not wired, so `endSession` refuses and
   * the diver is told, out loud, that nothing happened. §10 — "a local save failure is shown to
   * the diver" — and a silent refusal here would be a screen that swallowed the one destructive
   * action in the app.
   */
  it('says so when the sign-out could not be carried out', async () => {
    mockEndSession.mockImplementation(async (): Promise<SignOutOutcome> => ({
      ok: false,
      message: SIGN_OUT_UNAVAILABLE,
    }));
    stubSession({ session: SESSION });
    const t = await render(<AccountScreen />);
    await pressControl(t, 'Sign out');

    const destructive = alertButtons().find((b) => b.style === 'destructive');
    await act(async () => {
      destructive?.onPress?.();
    });

    expect(textIn(t)).toContain(SIGN_OUT_UNAVAILABLE);
  });
});

// ---------------------------------------------------------------------------------------
// §0.1 and §0.6: this screen speaks the app's language and draws nothing
// ---------------------------------------------------------------------------------------

/**
 * §0.4/§0.1's guard (`src/testing/unexpectedGraphics.ts`): nothing on this screen is painted
 * with anything `makeStyles(scheme)` did not hand out. A sign-in screen is where a default
 * style language arrives by reflex — §0.6's own origin is "a screen that was built to spec and
 * then styled by default into a different language" — so this is the check that it did not.
 */
describe('the app’s own visual language', () => {
  it.each([
    ['signed out', null],
    ['signed in', SESSION],
  ])('draws no graphic and no colour of its own (%s)', async (_label, session) => {
    stubSession({ session });

    const t = await render(<AccountScreen />);

    // `useColorScheme()` reports light under Jest, so the guard has to be given the sheet that
    // actually rendered.
    expect(unexpectedGraphics(t, 'light')).toEqual([]);
  });

  /**
   * §0.6: "Leaving a screen has one treatment everywhere." Asserted by identity against the
   * sheet, so this cannot drift into a second treatment for the same object — which is what
   * `backControl` (theme/styles.ts) was written to have stopped.
   */
  it('leaves by the same control the dive form and the dive detail leave by', async () => {
    const t = await render(<AccountScreen />);

    const back = findControl(t, 'Back to Settings');
    expect(back?.props.style).toBe(makeStyles('light').formBack);
  });

  /** The primary action is the app's one button treatment (§0.1: inverted ink, monochrome),
   * not a shape invented for a login screen. */
  it('uses the app’s one button treatment for its primary action', async () => {
    const t = await render(<AccountScreen />);

    expect(findControl(t, 'Sign in')?.props.style).toBe(makeStyles('light').action);
  });

  /**
   * Sign-out is `mutedControl`'s treatment and **not** `action`'s. §0.5 reserves the bottom
   * third for the primary action, and putting the one destructive act in the app there would
   * make it the easiest thing on the screen to hit.
   */
  it('keeps sign-out a muted control rather than the primary action', async () => {
    stubSession({ session: SESSION });

    const t = await render(<AccountScreen />);

    const styles = makeStyles('light');
    expect(findControl(t, 'Sign out')?.props.style).toBe(styles.accountSecondaryAction);
    expect(findControl(t, 'Sign out')?.props.style).not.toBe(styles.action);
  });
});

// ---------------------------------------------------------------------------------------
// Where the two controls of the bottom block are (M2f)
// ---------------------------------------------------------------------------------------

/** The fixed footer, found by the style it is drawn with rather than by its position in the
 * tree — DiveFormScreen.test.tsx locates its own the same way, and for the same reason: an
 * index would go on matching whatever ended up last. */
function footerOf(t: RenderResult) {
  const [footer] = t.root
    ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(makeStyles('light').formFooter))
    : [];
  if (!footer) throw new Error('AccountScreen rendered no footer');
  return footer;
}

/** The scrolling content, by the one prop only a ScrollView has. */
function scrollOf(t: RenderResult) {
  const [scroll] = t.root ? t.root.queryAll((n) => n.props?.contentContainerStyle !== undefined) : [];
  if (!scroll) throw new Error('AccountScreen rendered no scroll');
  return scroll;
}

/** The controls **inside** one node, in the order it draws them. `queryAll` does not return
 * the node it is called on, so a footer that is itself pressable could not pad this. */
function controlsUnder(node: ReturnType<typeof footerOf>): string[] {
  return node
    .queryAll((n) => n.props?.accessibilityRole === 'button')
    .map((n) => String(n.props?.accessibilityLabel ?? ''));
}

/**
 * **The defect M2f fixed, and the only kind of assertion that could have caught it.**
 *
 * The mode toggle shipped at the end of the scrolling content, where — measured on an iPhone
 * 17 Pro — it floated ~150 pt below the password row with ~400 pt of empty screen under it,
 * centred while every other element on the screen is left-aligned on the content inset. It
 * belongs to the primary action, because what it says is "the button below is the wrong verb
 * for me", so it is drawn with that button in the one bottom block.
 *
 * **Every test in this file was green while it was wrong**, and the labels-and-order check in
 * `signed out` above was green too: which parent a control hangs off is a layout fact, and a
 * Jest tree has no layout. So these assert CONTAINMENT, which is the part of a layout that
 * does live in the tree — the footer holds both, the scroll holds neither.
 */
describe('the mode toggle and the action it belongs to', () => {
  it('draws both in the one bottom block, the action leading', async () => {
    const t = await render(<AccountScreen />);

    expect(controlsUnder(footerOf(t))).toEqual(['Sign in', 'Create an account']);
  });

  /** The other half, and not a restatement of it: the first would still pass with the toggle
   * drawn twice, once in each place. */
  it('leaves no control at all in the scrolling content', async () => {
    const t = await render(<AccountScreen />);

    expect(controlsUnder(scrollOf(t))).toEqual([]);
  });

  /** The pair is the arrangement, not the two strings that happen to be in it — the whole
   * point of the control is that both of its labels appear. */
  it('keeps the pairing after the mode is switched', async () => {
    const t = await render(<AccountScreen />);

    await pressControl(t, 'Create an account');

    expect(controlsUnder(footerOf(t))).toEqual(['Create account', 'I already have an account']);
    expect(controlsUnder(scrollOf(t))).toEqual([]);
  });

  /**
   * §0.5's floor, **met by the box and not by `hitSlop`** — the combination
   * `CLEAR_HIT_SLOP`'s own note (FormField.tsx) was written about: an invisible target is
   * free to point somewhere the ink is not, and one did, 21 dp inward over the word
   * "carried", so tapping a label cleared the field. This control is a text link in a block
   * with a full-width button, which is exactly where a compact label stretched by slop gets
   * reached for.
   */
  it('reaches the 48 dp floor with a real box, carrying no slop', async () => {
    const t = await render(<AccountScreen />);

    expect(findControl(t, 'Create an account')?.props.hitSlop).toBeUndefined();
    const toggle = makeStyles('light').accountSecondaryAction as Record<string, unknown>;
    expect(toggle.minHeight).toBe(48);
  });

  /**
   * **The clearance under the block is still the device's**, and the block being measured is
   * the one both controls are in — the two halves are one test because either alone is an
   * arbitrary claim about a number. §10 records this project putting a bottom control under
   * the device's own chrome and fixing it twice, and M2f added an element BELOW the button
   * that had that clearance, which is precisely how it would be spent by accident.
   */
  it('spends the device’s own bottom inset on the block that holds them', async () => {
    const footerAt = async (bottom: number) => {
      const t = await render(
        <SafeAreaProvider
          initialMetrics={{ frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom } }}
        >
          <AccountScreen />
        </SafeAreaProvider>,
      );
      const footer = footerOf(t);
      const style = [footer.props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
      // LAST wins, not first: RN resolves a style array in order, and `formFooter` carries a
      // base `paddingBottom` the call site's device value overrides. Reading the first would
      // report the sheet's own number and conclude the footer ignores the device.
      const padding = style.reduce<unknown>((acc, s) => (s.paddingBottom !== undefined ? s.paddingBottom : acc), undefined);
      if (typeof padding !== 'number') throw new Error('the footer composed no paddingBottom');
      return { padding, controls: controlsUnder(footer) };
    };

    const onAPhone = await footerAt(34);
    const onNothing = await footerAt(0);

    // It is the block with both controls in it that stands on the bottom edge — so the toggle
    // cannot have been moved below the padding that keeps it off the home indicator.
    expect(onAPhone.controls).toEqual(['Sign in', 'Create an account']);
    expect(onAPhone.padding).toBeGreaterThan(onNothing.padding);
    expect(onAPhone.padding).toBeGreaterThanOrEqual(34);
  });
});
