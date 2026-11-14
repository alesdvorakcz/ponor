import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

/**
 * **The keyboard's return key walks the form** (2026-11-14, found on a phone). It used to close
 * the keyboard, so a diver moving down the form re-opened it on every row. Now a text field's
 * return key reads "next" and lands in the next text field on screen; from the last one it puts
 * the keyboard away.
 *
 * "Next" is decided by the form's own declared field order rather than by measuring the screen
 * or by the order fields happened to mount in — the dive form already names its order once
 * (`CORE_STRIP_FIELDS` and `FORM_GROUPS`), and a group opened later mounts its fields later
 * without being any further down. The order names pickers and chip rows too; only text fields
 * register, and only while mounted, so the walk steps over everything a keyboard cannot land
 * in and everything collapsed behind a chevron.
 *
 * Moving focus is the caller's (`focus`) — on the dive form it is react-hook-form's own
 * `setFocus`, which reaches the input through the `field.ref` every `FormField` already hands
 * over.
 */
export function nextInOrder(order: readonly string[], mounted: ReadonlySet<string>, current: string): string | null {
  const from = order.indexOf(current);
  if (from === -1) return null;
  for (let i = from + 1; i < order.length; i += 1) {
    const name = order[i];
    if (name !== undefined && mounted.has(name)) return name;
  }
  return null;
}

interface FocusChain {
  /** A text field on screen; the returned function takes it off again. */
  register(name: string): () => void;
  /** The return key was pressed in `name`. */
  step(name: string): void;
}

const FocusChainContext = createContext<FocusChain | null>(null);

export function FocusChainProvider({
  order,
  focus,
  onEnd,
  children,
}: {
  order: readonly string[];
  focus: (name: string) => void;
  /** No text field after this one on screen — the keyboard's work is done. */
  onEnd: () => void;
  children?: ReactNode;
}) {
  const mounted = useRef(new Set<string>());
  // The latest callbacks, read at the press rather than captured at registration, so the chain
  // itself never has to be rebuilt — a rebuilt chain would re-register every field on the form.
  const latest = useRef({ order, focus, onEnd });
  useEffect(() => {
    latest.current = { order, focus, onEnd };
  });
  const chain = useMemo<FocusChain>(
    () => ({
      register(name) {
        mounted.current.add(name);
        return () => {
          mounted.current.delete(name);
        };
      },
      step(name) {
        const { order: names, focus: moveTo, onEnd: end } = latest.current;
        const next = nextInOrder(names, mounted.current, name);
        if (next === null) end();
        else moveTo(next);
      },
    }),
    [],
  );
  return <FocusChainContext.Provider value={chain}>{children}</FocusChainContext.Provider>;
}

/** What a field hands its input so the return key steps: the key's label and its press. */
export interface FocusChainStep {
  returnKeyType: 'next';
  onSubmitEditing: () => void;
}

/**
 * One text field's place in the chain. It registers while mounted, so the step from the row
 * above can land in it; `steps` says whether its OWN return key steps on — false for notes,
 * whose return key writes a new line. `undefined` back outside a chain, or when it takes no step,
 * so the field's keyboard is exactly what it was.
 */
export function useFocusChainStep(name: string, steps: boolean): FocusChainStep | undefined {
  const chain = useContext(FocusChainContext);
  useEffect(() => (chain === null ? undefined : chain.register(name)), [chain, name]);
  return useMemo<FocusChainStep | undefined>(
    () => (chain === null || !steps ? undefined : { returnKeyType: 'next', onSubmitEditing: () => chain.step(name) }),
    [chain, name, steps],
  );
}
