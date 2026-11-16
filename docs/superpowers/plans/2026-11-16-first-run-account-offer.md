# First-run account offer and the grouped account screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer an account on the empty logbook and at the top of Settings while nobody is signed in (issue #24), and bring the account screen to the design canvas's grouped layout (screens 19–20).

**Architecture:** One hook decides whether the offer shows (`useAccountOffer`); one card component draws it in both places; the account screen keeps its nine states and its logic, and only its drawing changes — a shared head (mark, large heading, one line), fields grouped in one surface card, every control a button shape.

**Tech Stack:** Expo / React Native, expo-router, i18next (en + cs), `StyleSheet` from `src/theme/styles.ts`, expo-symbols, Jest + @testing-library/react-native.

**Spec:** the design canvas "Dive app design system" (page *Ponor Reference*): screen 02 (empty dive list), 19 (account — sign in and new account), 20 (account — after the form), 21 (Settings — not signed in), and Flow 01's first step; issue #24 for the requirements. Decisions made with the owner on 2026-11-16 are listed under Global Constraints and go into DESIGN.md in Task 6.

## Global Constraints

- The offer shows only when **this build has a backend AND the session read has answered AND nobody is signed in**. Never while the session read is pending, never signed in, never with no backend.
- Logging stays one tap: the inverted primary on the empty logbook is still *Log your first dive*; the offer is never a gate and has nothing to dismiss.
- Order on the empty logbook (guest): teaching block (top-aligned) → *Log your first dive* → `or` rule → card. Signed in / no backend / unresolved: teaching block centred, button at the bottom, exactly as today.
- Card copy (en): title **Better with an account**; line **Totally optional — Ponor works fully without one.**; three glyph words **Backups · Every device · Community**; outlined button **Sign in or create an account**; rule word **or**.
- Card copy (cs): **S účtem je to lepší** · **Zcela volitelné — Ponor funguje i bez něj.** · **Zálohy · Všechna zařízení · Komunita** · **Přihlásit se nebo vytvořit účet** · **nebo**.
- Promise line (both states, en): **Ponor keeps every dive on this phone and works with the boat out of signal.** (cs): **Ponor drží každý ponor v tomto telefonu a funguje i s lodí mimo signál.**
- Settings: the card sits under the heading, above Units, for a guest; while it shows, the *Account* section (its one row) is not drawn. Signed in: no card, the row as today.
- Account screen sub-line on sign in / new account (en): **Dives already on this phone come with you.** (cs): **Ponory, které už v telefonu máte, půjdou s vámi.** No "optional" sentence there (owner).
- Account perk sentences (en): **Your dives backed up as you log them** · **Your logbook on your other devices** · **Share new sites and centres with other divers**; (cs): **Ponory zálohované hned při zápisu** · **Deník i na vašich dalších zařízeních** · **Sdílejte nové lokality a centra s ostatními potápěči**.
- Signed-in sub-line (en): **Your dives back up to this account and sync to your other devices.** (cs): **Vaše ponory se zálohují do tohoto účtu a synchronizují do dalších zařízení.**
- The account screen's way out reads **‹ Back** (`back.any`): it now has two ways in. Its cold-deep-link fallback stays `/settings`.
- Colour: §0.1 — every control monochrome; no new colour literals; every new value is a style key in `src/theme/styles.ts`.
- Glyphs (expo-symbols, `symbolName`): backup `icloud.and.arrow.up` / `backup`; devices `ipad.and.iphone` / `devices`; community `map` / `map`.
- Public repo: no artifact links, no real names or addresses in code, tests, commits or the PR (test address `jana@example.com` is fine).

## Review Focus

1. **A slow session read must not flash the offer at a signed-in diver** — `useAccountOffer` is false until `resolved`; Task 1 pins it, Task 3 and Task 4 pin the screens.
2. **Czech runs 20–30 % longer** — the three glyph words wrap (`flexWrap`) rather than clip; Task 2 pins `flexWrap: 'wrap'` on the row.
3. **A build with no backend** — no card on either screen, and Settings keeps its *Account* row (which explains the missing backend); Tasks 3–4.
4. **The primary must still be the one inverted control on the empty logbook** — the card's button is `secondaryAction` (outlined), never `action`; Task 3 asserts both.
5. **The account screen's sign-out stays out of the footer** — the destructive act at the end of the content, outlined; Task 5.

---

### Task 1: `useAccountOffer` — the one owner of "offer an account now"

**Files:**
- Create: `src/cloud/useAccountOffer.ts`
- Test: `src/cloud/useAccountOffer.test.ts`

**Interfaces:**
- Produces: `export function useAccountOffer(): boolean`

- [ ] **Step 1: Failing tests** — mock `./supabase` (getter, as `AccountScreen.test.tsx` does) and `./useAuthSession`:
  - `it('offers an account to a guest once the session read has answered')` → `{configured: true}`, `{session: null, resolved: true}` → `true`
  - `it('offers nothing while the session read is out')` → `{session: null, resolved: false}` → `false`
  - `it('offers nothing to a diver who is signed in')` → `{session: {user: {}}, resolved: true}` → `false`
  - `it('offers nothing on a build with no backend')` → `{configured: false}`, `{session: null, resolved: true}` → `false`
- [ ] **Step 2:** `npx jest src/cloud/useAccountOffer.test.ts` → FAIL (module not found)
- [ ] **Step 3:** Implement: `cloud.configured && resolved && session === null`, reading `useAuthSession()`. Docblock says why each of the three halves is there.
- [ ] **Step 4:** Same command → PASS
- [ ] **Step 5:** Commit `useAccountOffer: one owner for when Ponor offers an account (#24)`

### Task 2: The card, its words and its glyphs

**Files:**
- Create: `src/components/AccountOfferCard.tsx`, `src/components/AccountPerks.tsx`
- Modify: `src/theme/styles.ts` (new keys below), `src/i18n/en.ts`, `src/i18n/cs.ts`
- Test: `src/components/AccountOfferCard.test.tsx`, `src/components/AccountPerks.test.tsx`, `src/components/symbolName.test.tsx`

**Interfaces:**
- Produces: `AccountOfferCard({ scheme, onPress }: { scheme: ColorScheme; onPress: () => void })`; `AccountPerks({ scheme, variant }: { scheme: ColorScheme; variant: 'words' | 'sentences' })`; `export const ACCOUNT_PERK_GLYPHS: readonly PlatformSymbol[]` (from `AccountPerks.tsx`, backup → devices → community); `OrRule({ scheme })` exported from `AccountOfferCard.tsx`.
- Style keys: `secondaryAction` (minHeight 48, radius 12, border 1 `theme.border`, centred) and `secondaryActionLabel` (sans-medium 16, `theme.fg`) — written once as consts `outlinedAction` / `outlinedActionLabel` beside `mutedControl`; `accountOfferCard` (surface, radius 12, padding 14 / 16, gap 12), `accountOfferTitle` (sans-semibold 16 / 20), `accountOfferLine` (sans 13 / 18 muted), `accountOfferButton` (`outlinedAction` with minHeight 44), `accountOfferButtonLabel` (15); `accountPerkWords` (row, `flexWrap: 'wrap'`, columnGap 16, rowGap 6), `accountPerkWord` (row, gap 6), `accountPerkWordLabel` (sans 13.5 fg); `accountPerkList` (gap 10), `accountPerkSentence` (row, gap 12), `accountPerkSentenceLabel` (sans 14.5 / 19 fg, flexShrink 1); `orRule` (row, height 32, gap 12, centred), `orRuleLine` (flex 1, hairline, `theme.border`), `orRuleLabel` (mono 11, uppercase, letterSpacing 1.2, muted).
- i18n keys (en/cs per Global Constraints): `accountOffer.title`, `accountOffer.optional`, `accountOffer.action`, `accountOffer.or`, `accountPerks.backupWord`, `accountPerks.devicesWord`, `accountPerks.communityWord`, `accountPerks.backup`, `accountPerks.devices`, `accountPerks.community`.

- [ ] **Step 1: Failing tests**
  - `AccountOfferCard`: `it('says what an account adds, and that it is optional')` (title, line, three words present); `it('opens the account screen through the button it carries')` (press label `Sign in or create an account` → `onPress` once, role `button`); `it('draws its button outlined, never as the inverted primary')` (button style flattens to `secondaryAction`/`accountOfferButton`, not `action`); `it('lets the three words wrap rather than clip')` (`accountPerkWords.flexWrap === 'wrap'`); `describe('in Czech')` → the cs strings.
  - `AccountPerks`: `it('says the three perks as words or as sentences, in one order')` (both variants, same glyph order as `ACCOUNT_PERK_GLYPHS`).
  - `symbolName.test.tsx`: `it('gives each account perk glyph an Android and a web name, not just an iOS one')`.
- [ ] **Step 2:** `npx jest src/components/AccountOfferCard.test.tsx src/components/AccountPerks.test.tsx src/components/symbolName.test.tsx` → FAIL
- [ ] **Step 3:** Implement the two components and the style keys; glyphs through `SymbolView` + `symbolName`, tinted `theme.fg`, size 18, `accessible={false}` (the word beside each carries it).
- [ ] **Step 4:** Same command → PASS
- [ ] **Step 5:** Commit `Account offer card and perks: one set of words for what an account adds (#24)`

### Task 3: The empty logbook offers the account

**Files:**
- Modify: `src/components/EmptyState.tsx`, `src/screens/DivesScreen.tsx`, `src/theme/styles.ts` (`emptyStateContentTop`, `emptyStateFooter`), `src/i18n/en.ts` + `cs.ts` (`empty.promise`)
- Test: `src/components/EmptyState.test.tsx`, `src/screens/DivesScreen.test.tsx`

**Interfaces:**
- Consumes: `useAccountOffer()` (Task 1); `AccountOfferCard`, `OrRule` (Task 2)
- Produces: `EmptyState` prop `onAccount?: () => void` — present ⇒ the guest layout.

- [ ] **Step 1: Failing tests**
  - EmptyState: `it('shows no offer when it is given nowhere to send one')`; `it('puts the primary first, then the rule, then the card')` (document order of `Log your first dive`, `or`, `Better with an account`); `it('keeps the primary and the card out of the scroll')` (extend the existing footer test); `it('sends the diver to the account screen from the card')`; `it('promises only what is true either way')` (new promise text, no "No account"); Czech: promise + card strings.
  - DivesScreen (mock `../cloud/useAccountOffer`): `it('offers a guest an account on the empty logbook, and opens the account screen from it')` (push `'/account'`); `it('offers nothing on the empty logbook when the hook says no')`; `it('never offers an account over a logbook that has dives')`.
- [ ] **Step 2:** `npx jest src/components/EmptyState.test.tsx src/screens/DivesScreen.test.tsx` → FAIL
- [ ] **Step 3:** Implement: footer `View` (`emptyStateFooter`) holds `action`, then — only with `onAccount` — `OrRule` and `AccountOfferCard`; the scroll's content style switches to `emptyStateContentTop` (justify flex-start, paddingTop 10) when `onAccount` is set. DivesScreen passes `onAccount={offerAccount ? () => router.push('/account') : undefined}`. Docblocks: §0.5's bend (primary mid-screen with the card, owner's call) and why the offer waits for the session read.
- [ ] **Step 4:** Same command → PASS
- [ ] **Step 5:** Commit `First run: offer an account under the first dive, never instead of it (#24)`

### Task 4: Settings heads with the card for a guest

**Files:**
- Modify: `src/screens/SettingsScreen.tsx`, `src/theme/styles.ts` (`settingsAccountOffer`: paddingHorizontal 16, paddingBottom 18)
- Test: `src/screens/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `useAccountOffer()`, `AccountOfferCard`

- [ ] **Step 1: Failing tests** (mock `../cloud/useAccountOffer`, default `false` so existing tests keep the row):
  - `it('heads the screen with the account card for a guest, above Units')` (card's title appears before the `Units` label in document order);
  - `it('draws no Account row while the card is the way in')`;
  - `it('opens the account screen from the card')` (push `'/account'`);
  - `it('draws no card for a diver who is signed in, and keeps the Account row')`.
- [ ] **Step 2:** `npx jest src/screens/SettingsScreen.test.tsx` → FAIL
- [ ] **Step 3:** Implement; replace the stale "It says nothing about who is signed in" comment with the current reason.
- [ ] **Step 4:** Same command → PASS
- [ ] **Step 5:** Commit `Settings: the account card on top for a guest, in place of the Account row (#24)`

### Task 5: The account screen, grouped

**Files:**
- Modify: `src/screens/AccountScreen.tsx`, `src/components/FormField.tsx` (prop `grouped?: boolean`), `src/theme/styles.ts`, `src/i18n/en.ts` + `cs.ts`
- Test: `src/screens/AccountScreen.test.tsx`, `src/components/FormField.test.tsx`

**Interfaces:**
- Consumes: `AccountPerks` (variant `'sentences'`), `outlinedAction` / `secondaryAction` (Task 2)
- Produces: `FormField` `grouped` — no top hairline, no focus fill (the card is the fill), row minHeight 52, padding 0 14.
- Style keys: `accountHead` (padding 0 20, gap 14), `accountMark` (44, opacity 0.5, tinted muted — `emptyStateMark`'s treatment), `accountTitle` (sans-bold 28 / 32, letterSpacing −0.6), `accountSub` (sans 14 / 19 muted, maxWidth 330), `accountBody` (padding 10 16 0), `accountFieldCard` (surface, radius 12), `accountFieldDivider` (hairline, marginLeft 14), `accountReadRow` / `accountReadValue` (row 52, value sans 15), `accountRemark` (sans 12.5 / 17 muted, padding 8 4 0, maxWidth 330), `accountForgot` (48 box, flex-start) holding `actionPill` / `actionPillLabel`, `accountSignOut` (`secondaryAction`, marginTop 18).
- i18n: add `account.divesComeWithYou`, `account.signedInSub`; remove `account.whatItIsFor` (en + cs).

- [ ] **Step 1: Update/add failing tests**
  - `it('leaves by ‹ Back, because two screens open it')` (replaces the `‹ Settings` assertion; label `back.any`).
  - `it('says dives on this phone come with it, and names what an account adds')` (replaces *says an account is optional* and *names all three things*): sub-line + three perk sentences; no "optional" sentence.
  - `it('groups both rows in one card')` (both inputs are descendants of the `accountFieldCard` view; rows render `grouped`).
  - `it('draws Forgot password? as a pill, not as another row')` (style includes `actionPill`).
  - `it('switches mode with an outlined button under the primary')` (footer holds `action` then `secondaryAction`).
  - `it('keeps sign-out out of the footer, outlined at the end of the content')` (replaces *muted control*).
  - `it('offers Back to sign in as the footer’s one button after a mail is sent')`.
  - FormField: `it('draws no hairline and no focus fill when grouped')`.
  - Czech: sub-line, perk sentences, mode button in cs.
- [ ] **Step 2:** `npx jest src/screens/AccountScreen.test.tsx src/components/FormField.test.tsx` → FAIL
- [ ] **Step 3:** Implement. One `AccountHead({ styles, title, sub?, perks? })` used by every state; `BackControl` label → `back.any`. No logic changes: submit / reset / link / sign-out code paths stay byte-for-byte except for what they render into.
- [ ] **Step 4:** Same command → PASS, then the full suite.
- [ ] **Step 5:** Commit `Account screen: the canvas's grouped layout — one card for the fields, a button for every control (#24)`

### Task 6: DESIGN.md, then the whole check

**Files:**
- Modify: `DESIGN.md` — §0.6 (the first-run paragraph: the offer; the account screen as screens 19–20; Settings' card), §3 (Settings line and the onboarding line: the card stands in for "optionally sign in"), §10 (decision entries: placement and wording by the owner; §0.5 bent on the first-run screen; the account screen's grouped card and the first outlined button treatment; Forgot as the quiet pill; `‹ Back` on the account screen; the "nothing to back up yet" wording rule).

- [ ] **Step 1:** Write the DESIGN.md changes.
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm test -- --ci` → all green.
- [ ] **Step 3:** Simulator pass (guest, en + cs, dark + light): first run, Settings, sign in, new account, wrong password, check email; screenshots to `pr-screenshots/issue-24/`.
- [ ] **Step 4:** Commit `DESIGN.md: the first-run account offer and the grouped account screen (#24)`; rebase on `main`; open the PR (`Closes #24`, "Needs your call").
