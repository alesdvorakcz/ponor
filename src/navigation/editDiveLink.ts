import { type DiveStatus } from '../domain/types';

/**
 * The link to `/dive/[id]/edit`, in both directions: what the two screens that offer
 * *Edit* / *Complete dive* push, and what the route reads back out of it.
 *
 * §2.4 gives a planned dive one action a logged one has no use for — *Complete dive* —
 * and DESIGN.md §10 leaves exactly one place that may change a dive's status: the form's
 * own Logged/Planned control. Those two facts have to be reconciled somewhere, because a
 * pill labelled "Complete dive" that opened the form on **Planned** would complete
 * nothing while still saying it does. This is that somewhere, and it writes nothing: the
 * link carries which state the control should *open* on, the diver fills in the missing
 * numbers, and saving is still the one deliberate act that logs the dive.
 *
 * The alternative — a second rule inside the form, "if you arrived to complete a dive,
 * log it" — is the rule this milestone deleted. It lived at `DiveFormScreen.tsx:806` as
 * `if (target.status === 'planned') patch.status = 'logged'`, and it meant that editing a
 * planned dive to fix a typo in its site name silently logged the dive. A status the
 * diver can see on a control they can move is not the same thing as a hidden rule keyed
 * on where they came from, even when the two agree on the common case.
 *
 * **One module, two producers, one consumer.** `DivesScreen`'s "Up next" pill and
 * `DiveDetailScreen`'s own action both push these; `src/app/dive/[id]/edit.tsx` reads
 * them. The param's name is written here once — `src/app/**` holds nothing but thin
 * routes and carries no tests of its own by this repo's convention, so a name retyped at
 * each end is a seam no test could ever cover. `leaveScreen.ts` next door exists for the
 * same reason: one owner beats one copy per screen.
 */
export interface EditDiveHref {
  /** The route template, not an interpolated path. expo-router's typed routes
   * (`app.config.ts`'s `experiments.typedRoutes`) check this against the routes that
   * actually exist on disk, and additionally require the `id` param — the same guarantee
   * `DivesScreen`'s own `logDive` records at length for its absolute `/dive/new`, kept
   * rather than traded away for string interpolation. */
  pathname: '/dive/[id]/edit';
  params: {
    id: string;
    /** Which state the form's §2.4 control opens on, overriding the dive's own stored
     * status. Absent means "open on whatever the dive is", which is what plain editing
     * wants. Deliberately not called `status`: it says nothing about what the dive IS,
     * only about where a control starts. */
    openAs?: DiveStatus;
  };
}

/** The runtime spelling of the param above, written once. `satisfies` pins it to a real
 * key of `EditDiveHref['params']`, so the reader and the writer below cannot drift onto
 * two different names without failing to compile. */
const OPEN_AS_PARAM = 'openAs' satisfies keyof EditDiveHref['params'];

/**
 * Editing a dive as it stands — the form opens on the dive's own status, so a planned
 * dive stays planned and a logged one stays logged unless the diver says otherwise.
 */
export function editDiveHref(id: string): EditDiveHref {
  return { pathname: '/dive/[id]/edit', params: { id } };
}

/**
 * §2.4's *Complete dive* — the same form and the same route, opened with the control
 * already on Logged so that saving finishes the dive, which is precisely what the label
 * promises. The diver still sees the flipped control before they save, and can flip it
 * back; nothing here changes a stored status.
 */
export function completeDiveHref(id: string): EditDiveHref {
  return { pathname: '/dive/[id]/edit', params: { id, [OPEN_AS_PARAM]: 'logged' } };
}

/**
 * The other direction: which state a route's search params ask the control to open on,
 * or `undefined` when they ask for nothing.
 *
 * Deliberately narrow. `useLocalSearchParams` hands back whatever is in the URL —
 * including `string[]` for a repeated param, and any typo a hand-typed deep link
 * contains — so anything that is not one of the two real states is treated as no
 * instruction at all rather than being passed on to the form. A junk `?openAs=maybe`
 * therefore opens the dive on its own status, which is the same thing a plain edit does;
 * it never opens the form on a state that is not a state.
 */
export function openAsStatus(params: { [key: string]: string | string[] | undefined }): DiveStatus | undefined {
  const raw = params[OPEN_AS_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'logged' || value === 'planned' ? value : undefined;
}
