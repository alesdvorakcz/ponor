# M1d · The Dive Form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ponor an app you can put a dive into — create, edit, and complete dives from the `+` button, with carry-over prefill and a form that never blocks a save.

**Architecture:** The data layer is finished and reviewed: `createDive`, `updateDive` and the domain functions all exist and are covered. This milestone is the *input* side. Everything that can be pure is pure — the validation schema, the prefill rule, and the mapping from form values to a `NewDiveInput` all live in testable modules with no React in them. The screen composes them.

**Tech Stack:** Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript · `react-hook-form` + Zod · `StyleSheet` via `src/theme/styles.ts` · Jest + `@testing-library/react-native`.

## Global Constraints

Copied from `DESIGN.md`. These bind every task.

- **THE COERCION CONTRACT (§10, and `src/domain/derived.ts:51`). Read it before writing any schema.** An empty numeric field must reach the domain as `null` or `NaN` — **never `0`**. `derived.ts` treats `NaN` as *absent* (the cylinder still counts) and `0` as *contradictory* for `sizeL` and `count`, which **voids the whole dive's gas figure**. `z.coerce.number()` calls `Number()` internally, and `Number('') === 0`, so a bare `z.coerce.number()` on an optional numeric field silently blanks a dive's RMV the moment it is left empty — no rejection, no flagged field, just a quietly missing number. This is the single most important rule in the milestone.
- **Only the date is required** (§2.2). Every other field is optional, and a dive carrying nothing but a date is a legitimate save.
- **Never block a save** (§1). Validation may warn, correct, or refuse a *value*; it must not refuse the dive. A diver on a boat does not get to argue with a form.
- **Colour encodes depth and nothing else.** Colours come from `makeStyles(scheme)`; the depth scale only via `DepthValue`. A colour literal is a defect and the ESLint rule covers `src/app/**`, `src/components/**`, `src/screens/**`.
- **Fonts from `src/theme/fonts.ts`**, never a hardcoded family. Data is IBM Plex Mono; UI is Archivo.
- **Carried values are marked** (§0.6): a prefilled field shows a `carried ×` chip. Accepting costs nothing, editing drops the chip, and the `×` clears the field **to a real blank, never a zero**.
- **Planned dives carry no dive number** until completed (§2.4, §2.5).
- **Nothing but real routes under `src/app/`** — expo-router sweeps that directory and a test file there breaks the app launch while every static gate stays green. Screens live in `src/screens/`, components in `src/components/`, tests beside them.
- **Verify with `npx expo export --platform ios`** — it must succeed. Do *not* curl the dev server's `entry.bundle`; it returns byte-identical output for broken and fixed trees.
- Tap targets never below **48 dp**; labels wrap rather than truncate — Czech runs 20–30 % longer than English.
- **`unexpectedGraphics()`** in `DiveRow.test.tsx` / `DiveDetailScreen.test.tsx` guards §0.4's no-schematic-profile rule. It flags any `View` styled with anything outside `Object.values(makeStyles(scheme))`. **Put styles in `makeStyles`** — which is the project rule anyway — rather than weakening the guard. It was broken for three milestones and is not to be broken again.

## Verified facts, so no task rediscovers them

- Theme token keys: `bg`, `surface`, `border`, `fg`, `fgMuted`, `action`, `actionFg`. **There is no `fg-muted`.**
- Font keys: `sans`, `sans-medium`, `sans-semibold`, `sans-bold`, `mono`, `mono-medium`.
- `@testing-library/react-native@14`'s `render()` is **async**; `root` exposes `queryAll(predicate)`, not `findAllByType`. `await render(...)`. Both screen test files define a `textIn` helper — read one before writing a harness.
- Screens resolve their own scheme via `useColorScheme()`, which under Jest is **light**. Do not assert against dark tokens as though a screen took a `scheme` prop.
- `zod` is installed; **`react-hook-form` is not** — Task 1 adds it.
- **Where a code sample below disagrees with `DESIGN.md` or the Global Constraints, the spec wins.** Treat samples as illustration, not authority.

## The repository contract, which is already built and reviewed

- `createDive(db, input: NewDiveInput): Promise<Dive>` — generates its own `id` and `createdAt`; any `id` you pass is stripped.
- `updateDive(db, id, patch: DivePatch): Promise<Dive>` — **a carried `undefined` means "don't touch"**; `null` is the only "clear this field" signal; an empty patch is a successful no-op that does not bump `updated_at`; **an unknown key throws** rather than silently no-writing.
- `NewDiveInput = Partial<Omit<Dive, ImmutableField>> & Pick<Dive, 'date'>` — date required, everything else optional.
- `reorderDivesForDate(db, date, orderedIds)` exists; this milestone does not touch it.

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `src/domain/diveFormSchema.ts` | The Zod schema. Owns the coercion contract — the only place a form string becomes a domain number. |
| `src/domain/carryOver.ts` | Pure: given the previous dive, which fields carry and which stay fresh (§2.1). |
| `src/screens/DiveFormScreen.tsx` | The form. Core strip plus collapsible groups. |
| `src/components/FormField.tsx` | One labelled field, with its `carried ×` chip. |
| `src/components/FormGroup.tsx` | A collapsible group. |
| `src/app/dive/new.tsx` | Thin route — nothing but a re-export. |
| `src/app/dive/[id]/edit.tsx` | Thin route — nothing but a re-export. |

**Modified**

| File | Change |
|---|---|
| `src/theme/styles.ts` | Form field, group, and chip styles. |
| `src/screens/DivesScreen.tsx` | The `+` becomes live; "Up next" rows offer *Complete dive*. |
| `package.json` | `react-hook-form` (Task 1). |

---

## Task 1: Add react-hook-form, and prove it works here first

`DESIGN.md` §4 names `react-hook-form` + Zod. Zod is installed; react-hook-form is not.

**This task exists to fail fast if it does not fit.** This repo runs `eslint-plugin-react-hooks` v7.1.1 — the full React Compiler rule set — and it has already rejected an idiomatic React Native pattern outright: M1c's scroll behaviour could not use `Animated`'s standard ref-held-value form because the linter refused it. react-hook-form leans heavily on refs and uncontrolled inputs, so the same conflict is plausible.

**Files:**
- Modify: `package.json`
- Create: a throwaway probe, deleted before committing

**Interfaces:**
- Produces: `react-hook-form` available to later tasks.

- [ ] **Step 1: Install**

```bash
npx expo install react-hook-form @hookform/resolvers
```

`@hookform/resolvers` is what connects Zod to react-hook-form. Use `npx expo install` rather than `npm install` so the version is one Expo has pinned for this SDK.

- [ ] **Step 2: Write a throwaway probe that uses the library the way the form will**

Create `src/screens/__probe.test.tsx` — a component with `useForm`, a `Controller`-wrapped `TextInput`, a `zodResolver`, and a submit. Render it, type into the field, submit, and assert the handler received the typed value.

The point is not the assertion. The point is finding out whether the pattern compiles, renders, and survives the linter.

- [ ] **Step 3: Run every gate against the probe**

Run: `npm test && npm run typecheck && npm run lint && npx eslint .`

**If ESLint rejects the idiomatic pattern, STOP.** Do not restructure the form around a linter workaround, and do not disable the rule. Report exactly which rule fired, on which line, and what the idiomatic alternative would be. That is a decision for the plan-holder — the same call that was made when NativeWind v5 turned out not to work, and making it quietly is what cost that milestone a rewrite.

- [ ] **Step 4: Delete the probe**

```bash
rm src/screens/__probe.test.tsx
```

It has done its job. Do not leave it in the suite.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add react-hook-form for the dive form"
```

---

## Task 2: The form schema, and the coercion contract

**This is the most important task in the milestone.** Everything else is composition; this is the part where a mistake silently corrupts a diver's gas figures.

**Files:**
- Create: `src/domain/diveFormSchema.ts`
- Test: `src/domain/diveFormSchema.test.ts`

**Interfaces:**
- Consumes: `zod`; `Tank` and `Dive` from `src/domain/types.ts`; `isCalendarDate` / `isTimeOfDay` from `src/domain/datetime.ts`.
- Produces:
  - `diveFormSchema` — a Zod schema over the form's **string** values.
  - `type DiveFormValues = z.infer<typeof diveFormSchema>`
  - `toNewDiveInput(values: DiveFormValues): NewDiveInput` — the single place form values become a domain object.

- [ ] **Step 1: Write the failing tests**

```ts
import { diveFormSchema, toNewDiveInput } from './diveFormSchema';

const base = { date: '2026-08-16' };

describe('the coercion contract', () => {
  it('turns an empty numeric field into null, never zero', () => {
    const v = diveFormSchema.parse({ ...base, maxDepthM: '', durationMin: '', weightsKg: '' });
    expect(v.maxDepthM).toBeNull();
    expect(v.durationMin).toBeNull();
    expect(v.weightsKg).toBeNull();
    // the specific failure this guards: Number('') === 0
    expect(v.maxDepthM).not.toBe(0);
  });

  it('turns an empty cylinder size into null, because zero would void the dive gas figure', () => {
    const v = diveFormSchema.parse({ ...base, tanks: [{ sizeL: '', count: '', o2Pct: '' }] });
    expect(v.tanks[0]?.sizeL).toBeNull();
    expect(v.tanks[0]?.count).toBeNull();
    expect(v.tanks[0]?.sizeL).not.toBe(0);
  });

  it('keeps a real zero when the diver actually typed one', () => {
    const v = diveFormSchema.parse({ ...base, waterTempC: '0' });
    expect(v.waterTempC).toBe(0);
  });

  it('turns whitespace into null too', () => {
    expect(diveFormSchema.parse({ ...base, maxDepthM: '   ' }).maxDepthM).toBeNull();
  });

  it('turns unparseable text into null rather than NaN reaching the database', () => {
    expect(diveFormSchema.parse({ ...base, maxDepthM: 'abc' }).maxDepthM).toBeNull();
  });
});

describe('never blocking a save', () => {
  it('accepts a dive carrying nothing but a date', () => {
    expect(() => diveFormSchema.parse({ date: '2026-08-16' })).not.toThrow();
  });

  it('accepts a negative depth as a value rather than refusing the dive', () => {
    // §1: validation may correct or warn; it must not refuse the save.
    expect(() => diveFormSchema.parse({ ...base, maxDepthM: '-5' })).not.toThrow();
  });
});

describe('toNewDiveInput', () => {
  it('omits fields the diver left empty rather than sending nulls for all of them', () => {
    const input = toNewDiveInput(diveFormSchema.parse({ date: '2026-08-16' }));
    expect(input.date).toBe('2026-08-16');
    expect(Object.values(input).every((v) => v !== 0)).toBe(true);
  });
});
```

The third test is the one people get wrong: **a typed `0` is real data.** Water temperature of zero is a fact about an ice dive. Only *empty* becomes null.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest diveFormSchema`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Write one helper that every optional numeric field uses, so the rule exists once:

```ts
/**
 * The coercion contract (DESIGN.md §10, derived.ts's COERCION CONTRACT block).
 *
 * An empty numeric field must reach the domain as null — never 0. `derived.ts`
 * treats 0 as *contradictory* data for sizeL and count and voids the whole
 * dive's gas figure, where absent data merely skips that cylinder. A bare
 * `z.coerce.number()` would do exactly the wrong thing, because
 * `Number('') === 0`.
 */
const optionalNumber = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((raw) => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  });
```

Note it does **not** use `z.coerce.number()` anywhere. Every optional numeric field in the schema — depths, duration, temperatures, visibility, weights, pressures, cylinder size, count, gas percentages — goes through this one helper.

`date` is the only required field. Validate it with `isCalendarDate` from `src/domain/datetime.ts`, which is the single owner of what a valid date string is — do not write a second date check.

- [ ] **Step 4: Run the tests**

Run: `npx jest diveFormSchema`
Expected: PASS, all 8.

- [ ] **Step 5: Prove the contract's guard can fail — this is the step that matters**

Temporarily replace `optionalNumber` with a bare `z.coerce.number().nullable()` and run the suite. The empty-field tests **must** fail with `0` where they expect `null`. Restore it.

Report the exact received values. A test for this rule that passes under `z.coerce.number()` is not testing the rule — and this milestone's whole risk is concentrated here.

- [ ] **Step 6: Commit**

```bash
git add src/domain/diveFormSchema.ts src/domain/diveFormSchema.test.ts
git commit -m "Add the dive form schema, with the coercion contract in one place"
```

---

## Task 3: Carry-over prefill

**Files:**
- Create: `src/domain/carryOver.ts`
- Test: `src/domain/carryOver.test.ts`

**Interfaces:**
- Consumes: `Dive` from `src/domain/types.ts`; `dive()` from `src/domain/diveFixture.ts`.
- Produces: `carryOverFrom(previous: Dive | null): Partial<DiveFormValues>`, and `CARRIED_FIELDS: readonly (keyof DiveFormValues)[]` so the screen knows which fields to mark.

- [ ] **Step 1: Write the failing tests**

§2.1 lists exactly what carries and what does not. Encode both halves:

```ts
import { dive } from './diveFixture';
import { carryOverFrom } from './carryOver';

const previous = dive({
  date: '2026-08-16', timeIn: '09:15', durationMin: 44, maxDepthM: 32.4, avgDepthM: 18.2,
  siteName: 'Blue Hole', centerName: 'Dahab Divers', entry: 'shore', salinity: 'salt',
  waterBody: 'ocean', suit: 'wet', weightsKg: 6, buddy: 'Petra', visibilityM: 25,
  waterTempC: 26, rating: 5, notes: 'Arch at 30 m',
  tanks: [{ material: 'steel', sizeL: 12, count: 1, workingBar: 232, o2Pct: 21, hePct: 0, startBar: 200, endBar: 60 }],
});

it('carries the things that stay the same across a trip', () => {
  const c = carryOverFrom(previous);
  expect(c.siteName).toBe('Blue Hole');
  expect(c.centerName).toBe('Dahab Divers');
  expect(c.entry).toBe('shore');
  expect(c.salinity).toBe('salt');
  expect(c.waterBody).toBe('ocean');
  expect(c.suit).toBe('wet');
  expect(c.weightsKg).toBe(6);
  expect(c.buddy).toBe('Petra');
});

it('carries the cylinder and its gas, but not its pressures', () => {
  const c = carryOverFrom(previous);
  expect(c.tanks?.[0]?.sizeL).toBe(12);
  expect(c.tanks?.[0]?.o2Pct).toBe(21);
  // §2.1: starting AND ending pressure are fresh every dive
  expect(c.tanks?.[0]?.startBar ?? null).toBeNull();
  expect(c.tanks?.[0]?.endBar ?? null).toBeNull();
});

it('does not carry what changes every dive', () => {
  const c = carryOverFrom(previous);
  for (const field of ['maxDepthM', 'avgDepthM', 'durationMin', 'timeIn',
                       'visibilityM', 'waterTempC', 'rating', 'notes', 'title'] as const) {
    expect(c[field] ?? null).toBeNull();
  }
});

it('returns nothing to carry for a diver with no previous dive', () => {
  expect(Object.keys(carryOverFrom(null))).toHaveLength(0);
});

it('keeps the previous date when it is less than 48 hours old', () => {
  // §2.1: "the date stays on the previous dive's date when it is less than 48 h old"
  const c = carryOverFrom(dive({ date: '2026-08-16' }), new Date('2026-08-17T10:00:00Z'));
  expect(c.date).toBe('2026-08-16');
});

it('moves to today once the previous dive is older than 48 hours', () => {
  const c = carryOverFrom(dive({ date: '2026-08-16' }), new Date('2026-08-20T10:00:00Z'));
  expect(c.date).toBe('2026-08-20');
});
```

The pressure test is the one that protects a diver: **starting pressure must never carry**, because a stale 200 bar silently becomes a wrong gas-consumption figure for the next dive. §2.1 says so explicitly and the owner called it out when the spec was written.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest carryOver`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

`carryOverFrom(previous, now = new Date())` — take `now` as a parameter with a default so the 48-hour rule is testable without mocking the clock. Compute the day difference from `calendarDateToUtcMs` in `src/domain/datetime.ts`; do not do local-time `Date` arithmetic, which is the class of bug the date formatting already guards against.

Export `CARRIED_FIELDS` derived from the same source the function uses, so the list and the behaviour cannot drift apart.

- [ ] **Step 4: Run and commit**

Run: `npm test && npm run typecheck`

```bash
git add src/domain/carryOver.ts src/domain/carryOver.test.ts
git commit -m "Add carry-over prefill, keeping pressures fresh every dive"
```

---

## Task 4: The form screen

**Files:**
- Create: `src/screens/DiveFormScreen.tsx`, `src/components/FormField.tsx`, `src/components/FormGroup.tsx`
- Modify: `src/theme/styles.ts`
- Test: `src/screens/DiveFormScreen.test.tsx`, `src/components/FormField.test.tsx`

**Interfaces:**
- Consumes: `diveFormSchema`, `DiveFormValues`, `carryOverFrom`, `CARRIED_FIELDS`, `makeStyles`.
- Produces: `<DiveFormScreen mode="create" | "edit" diveId?: string />`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows the core strip without opening anything', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const text = textIn(t).join(' ');
  // §2.2: date, site, center, max depth, duration are always visible
  for (const label of ['Date', 'Site', 'Centre', 'Max depth', 'Duration']) {
    expect(text).toContain(label);
  }
});

it('keeps the deeper groups collapsed until asked', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  const text = textIn(t).join(' ');
  expect(text).toContain('Gas & cylinders');   // the group's header shows
  expect(text).not.toContain('Working pressure'); // its fields do not
});

it('saves a dive carrying nothing but a date', async () => {
  const t = await render(<DiveFormScreen mode="create" />);
  // only the date is required (§2.2) — the save must be reachable with nothing else set
  const save = t.root.queryAll((n: any) => n.props?.accessibilityRole === 'button')
    .find((n: any) => String(n.props?.accessibilityLabel ?? '').includes('Save'));
  expect(save?.props?.accessibilityState?.disabled).not.toBe(true);
});
```

That third test encodes §1 — **never block a save.** A disabled save button is the most common way a form breaks that rule, and it is worth a test that fails if someone adds a `disabled` prop later.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest DiveFormScreen`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Build `FormGroup` and `FormField`**

`FormGroup` — a header with the group name and a disclosure state, its children hidden when collapsed. 48 dp header target. §2.2's groups: *Times & depth · Conditions · Gas & cylinders · Equipment · People · Notes & rating*.

`FormField` — a label, an input, and space for the `carried ×` chip Task 5 adds. Numeric fields get `keyboardType="decimal-pad"`; the label wraps rather than truncating.

- [ ] **Step 4: Build the screen**

Core strip always visible: date, site, centre, max depth, duration. Everything else in collapsed groups. One scroll view. `zodResolver(diveFormSchema)`.

The save action sits in the bottom third (§0.5) and is never disabled.

- [ ] **Step 5: Run the suite**

Run: `npm test && npm run typecheck && npm run lint && npx eslint . && npx expo export --platform ios`

- [ ] **Step 6: Commit**

```bash
git add src/screens/DiveFormScreen.tsx src/screens/DiveFormScreen.test.tsx src/components/FormField.tsx src/components/FormField.test.tsx src/components/FormGroup.tsx src/theme/styles.ts
git commit -m "Add the dive form: core strip, collapsible groups, always saveable"
```

---

## Task 5: The `carried ×` chips

**Files:**
- Modify: `src/components/FormField.tsx`, `src/screens/DiveFormScreen.tsx`, `src/theme/styles.ts`
- Test: `src/components/FormField.test.tsx`

**Interfaces:**
- Consumes: `CARRIED_FIELDS` from Task 3.

- [ ] **Step 1: Write the failing tests**

§0.6 defines the three states. Test all three, and test them *against each other*:

```tsx
it('marks a carried field and leaves a typed one unmarked', async () => {
  const t = await render(
    <>
      <FormField label="Site" value="Blue Hole" carried onChange={() => {}} onClear={() => {}} />
      <FormField label="Max depth" value="32.4" onChange={() => {}} onClear={() => {}} />
    </>,
  );
  const chips = textIn(t).filter((s) => s.includes('carried'));
  expect(chips).toHaveLength(1);
});

it('clears to an empty string, never a zero', async () => {
  const onClear = jest.fn();
  const t = await render(
    <FormField label="Weights" value="6" carried onChange={() => {}} onClear={onClear} />,
  );
  const x = t.root.queryAll((n: any) => n.props?.accessibilityRole === 'button')
    .find((n: any) => String(n.props?.accessibilityLabel ?? '').toLowerCase().includes('clear'));
  fireEvent.press(x);
  expect(onClear).toHaveBeenCalled();
  // the value the field reports after clearing must be '' — the schema turns that into null.
  // A 0 here would reach the domain as contradictory data.
  expect(onClear.mock.calls[0]?.[0] ?? '').not.toBe(0);
});
```

The first test is the shape that matters: **an assertion that a chip renders would pass if every field were chipped.** Holding a carried field and a typed field in one assertion is what makes it a test of the distinction.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest FormField -t 'carried'`
Expected: FAIL — no chip rendered.

- [ ] **Step 3: Implement**

The chip reads `carried ×`, with the `×` behind a divider inside the chip so it is visibly a button rather than a label — §0.6, and the owner's own correction: a label you are expected to guess is tappable is not an affordance. Editing the field drops the chip. The `×` clears to `''`.

The chip is muted mono on `border`; it gains no colour.

- [ ] **Step 4: Run, prove one can fail, commit**

Break the `carried` condition so every field chips, and confirm the first test reddens. Restore.

```bash
git add src/components/FormField.tsx src/components/FormField.test.tsx src/screens/DiveFormScreen.tsx src/theme/styles.ts
git commit -m "Mark carried fields, and let the diver clear them to blank"
```

---

## Task 6: Creating a dive — the `+` becomes live

**Files:**
- Create: `src/app/dive/new.tsx`
- Modify: `src/screens/DivesScreen.tsx`, `src/screens/DiveFormScreen.tsx`
- Test: `src/screens/DiveFormScreen.test.tsx`

**Interfaces:**
- Consumes: `createDive(db, input)`; `useDives()`; `toNewDiveInput`; `carryOverFrom`.

- [ ] **Step 1: Write the failing tests**

The mocking pattern is already established in `src/screens/DiveDetailScreen.test.tsx:27` and `DivesScreen.test.tsx:41` — follow it rather than inventing one:

```tsx
import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';
import { dive } from '../domain/diveFixture';
import { useDives } from '../db/useDives';
import { createDive } from '../db/dives';
import DiveFormScreen from './DiveFormScreen';

jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
jest.mock('../db/dives', () => ({ createDive: jest.fn(), updateDive: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));

const mockUseDives = useDives as jest.Mock;
const mockCreate = createDive as jest.Mock;

function textIn(t: RenderResult): string[] {
  return (t.root ? t.root.queryAll((n: any) => n.type === 'Text') : [])
    .flatMap((n: any) => n.children)
    .filter((c: any): c is string => typeof c === 'string');
}

const pressSave = (t: RenderResult) => {
  const save = t.root
    .queryAll((n: any) => n.props?.accessibilityRole === 'button')
    .find((n: any) => String(n.props?.accessibilityLabel ?? '').includes('Save'));
  if (!save) throw new Error('no Save control found');
  fireEvent.press(save);
};

const typeInto = (t: RenderResult, label: string, value: string) => {
  const input = t.root
    .queryAll((n: any) => n.type === 'TextInput')
    .find((n: any) => String(n.props?.accessibilityLabel ?? '') === label);
  if (!input) throw new Error(`no field labelled ${label}`);
  fireEvent.changeText(input, value);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseDives.mockReturnValue({ dives: [], numbers: new Map(), error: undefined });
});

it('creates a dive and returns to the list', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  typeInto(t, 'Date', '2026-08-16');
  pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  expect(mockCreate.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ date: '2026-08-16' }));
});

it('sends no zeros for fields the diver left empty', async () => {
  mockCreate.mockResolvedValue(dive({ date: '2026-08-16' }));
  const t = await render(<DiveFormScreen mode="create" />);
  typeInto(t, 'Date', '2026-08-16');
  pressSave(t);
  await waitFor(() => expect(mockCreate).toHaveBeenCalled());
  const input = mockCreate.mock.calls[0]?.[1] ?? {};
  expect(Object.entries(input).filter(([, v]) => v === 0)).toHaveLength(0);
});

it('tells the diver when a save fails instead of pretending it worked', async () => {
  mockCreate.mockRejectedValue(new Error('disk full'));
  const t = await render(<DiveFormScreen mode="create" />);
  typeInto(t, 'Date', '2026-08-16');
  pressSave(t);
  // §1's "never block a save" does not mean "never admit a save failed"
  await waitFor(() => expect(textIn(t).join(' ').toLowerCase()).toContain("couldn't"));
  expect(router.back).not.toHaveBeenCalled();
});
```

`waitFor` comes from `@testing-library/react-native`. If the accessibility labels you give the Save control and the fields differ from `'Save'` / `'Date'`, adjust the helpers — but keep every assertion as written.

The second is the milestone's contract, tested end to end rather than only at the schema. The third closes a gap M1b left: the scaffolding had no `.catch()`, and the pattern was explicitly flagged as one not to carry into the real save flow.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest DiveFormScreen -t 'creates'`
Expected: FAIL.

- [ ] **Step 3: Wire it**

`src/app/dive/new.tsx` is a thin route re-exporting the screen in create mode — nothing else in it. `DivesScreen`'s `+` navigates there. On save: `toNewDiveInput(values)` → `createDive` → navigate back. On failure: a visible message, and the form keeps its values.

Prefill comes from `carryOverFrom(mostRecentLoggedDive)`, using `useDives()` — **do not add a second read path.**

- [ ] **Step 4: Run everything and commit**

Run: `npm test && npm run typecheck && npm run lint && npx eslint . && npx expo export --platform ios`

```bash
git add src/app/dive/new.tsx src/screens/DivesScreen.tsx src/screens/DiveFormScreen.tsx src/screens/DiveFormScreen.test.tsx
git commit -m "Let the + button actually log a dive"
```

---

## Task 7: Editing, and completing a planned dive

**Files:**
- Create: `src/app/dive/[id]/edit.tsx`
- Modify: `src/screens/DiveDetailScreen.tsx`, `src/screens/DivesScreen.tsx`, `src/screens/DiveFormScreen.tsx`
- Test: `src/screens/DiveFormScreen.test.tsx`

**Interfaces:**
- Consumes: `updateDive(db, id, patch)`; `getDive` via `useDives()`.

- [ ] **Step 1: Write the failing tests**

Reuse the mocks, `textIn`, `pressSave` and `typeInto` from Task 6's test file — these tests live in the same file.

```tsx
const existing = dive({
  id: 'target', date: '2026-08-16', siteName: 'Blue Hole',
  maxDepthM: 32.4, notes: 'Arch at 30 m',
});

it('sends only the fields that changed', async () => {
  mockUseDives.mockReturnValue({ dives: [existing], numbers: new Map(), error: undefined });
  mockUpdate.mockResolvedValue(existing);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  typeInto(t, 'Max depth', '28.0');
  pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  const patch = mockUpdate.mock.calls[0]?.[2] ?? {};
  expect(patch).toHaveProperty('maxDepthM', 28);
  expect(patch).not.toHaveProperty('siteName');
});

it('clears a field the diver emptied, rather than leaving the old value', async () => {
  mockUseDives.mockReturnValue({ dives: [existing], numbers: new Map(), error: undefined });
  mockUpdate.mockResolvedValue(existing);
  const t = await render(<DiveFormScreen mode="edit" diveId="target" />);
  typeInto(t, 'Notes', '');
  pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(mockUpdate.mock.calls[0]?.[2]?.notes).toBeNull();
});

it('completing a planned dive turns it into a logged one', async () => {
  const planned = dive({ id: 'p1', date: '2026-09-05', status: 'planned', siteName: 'Silfra' });
  mockUseDives.mockReturnValue({ dives: [planned], numbers: new Map(), error: undefined });
  mockUpdate.mockResolvedValue(planned);
  const t = await render(<DiveFormScreen mode="edit" diveId="p1" />);
  typeInto(t, 'Duration', '44');
  pressSave(t);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(mockUpdate.mock.calls[0]?.[2]?.status).toBe('logged');
});
```

`mockUpdate` is `updateDive as jest.Mock` from the same `jest.mock('../db/dives', ...)` Task 6 sets up.

The first two together are the repository's contract from the other side: **`undefined` means don't touch, `null` means clear.** Getting them backwards either wipes fields the diver never opened or silently keeps values they deleted — and only a pair of tests can tell those apart.

- [ ] **Step 2: Run and watch them fail**

Run: `npx jest DiveFormScreen -t 'edit'`
Expected: FAIL.

- [ ] **Step 3: Implement**

Edit mode loads the dive from `useDives()` and builds a patch of **changed fields only**. A field the diver emptied sends `null`; an untouched field is absent from the patch entirely.

*Complete dive* (§2.4) is edit mode on a planned dive, with `status: 'logged'` in the patch on save. It asks for what a planned dive lacks — duration, depths, ending pressure — with everything already set left alone. A dive number appears the moment it is logged, because numbering is computed.

Entry points: *Edit* from dive detail; *Complete dive* from an "Up next" row.

- [ ] **Step 4: Run everything and commit**

Run: `npm test && npm run typecheck && npm run lint && npx eslint . && npx expo export --platform ios`

```bash
git add src/app/dive src/screens/DiveFormScreen.tsx src/screens/DiveFormScreen.test.tsx src/screens/DiveDetailScreen.tsx src/screens/DivesScreen.tsx
git commit -m "Edit a dive, and complete a planned one"
```

---

## Done when

On a simulator, with an empty database:

1. The `+` opens a form whose core strip shows date, site, centre, max depth and duration, with the other groups collapsed.
2. Saving with **only a date set** creates a dive, and it appears in the list.
3. Logging a second dive prefills site, centre, cylinder, suit, weights and buddy from the first — each marked `carried` — while **depth, duration, time and both pressures are empty**.
4. Tapping a chip's `×` clears that field, and the saved dive has `null` there — **not `0`**.
5. Editing a dive changes only what you touched; emptying a field clears it.
6. A planned dive offers *Complete dive*, and completing it gives the dive a number.
7. A save that fails says so, and the form keeps what you typed.
8. `npm test`, `npm run typecheck`, `npm run lint`, `npx eslint .` and `npx expo export --platform ios` are all clean.

**Item 4 is the milestone.** Everything else is a form; that one is the difference between a correct gas figure and a silently wrong one. Check it in the database, not just on screen.
