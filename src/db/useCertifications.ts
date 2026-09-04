import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { type Certification } from '../domain/types';
import { certificationRowsQuery, toCertifications } from './certifications';
import { db } from './client';
import { isResolved, useCurrentError } from './liveQuery';

export interface CertificationListState {
  /** Every live card, newest first (`toCertifications`' own order — `compareCertifications`). */
  certifications: Certification[];
  /**
   * Whether the read has produced an answer yet — rows, or a failure (`isResolved`,
   * db/liveQuery.ts, which owns the mechanism and both words' exact meaning).
   *
   * **The same name and the same meaning as `useDives`' and `useGearPresets`' own `resolved`,
   * and that is the requirement rather than a coincidence** (§4.1): three hooks growing three
   * vocabularies for one fact is this project's defining defect, and the fact is shared.
   * `certifications` alone cannot say it — `[]` means "you hold no cards" and "nothing has
   * been read yet" at once, and both screens below would otherwise state the first while the
   * second was true.
   */
  resolved: boolean;
  /**
   * Set when the wallet could not be read at all.
   *
   * Read on both screens that show a card, for `useGearPresets`' stated reason: "couldn't load
   * your certifications" and "you have none yet" are different sentences, and a diver who went
   * to Settings specifically to check a card must not be shown the second when the first is
   * true. The editor one route deeper needs it for the sharper version of the same
   * distinction — "may have been deleted" sends a diver looking for something that is still
   * there.
   *
   * **Set only while that failure is still what the read last said** (`useCurrentError`,
   * db/liveQuery.ts). `useLiveQuery` never clears its own `error`, so forwarding it raw leaves
   * a notice standing over a list a later read has already delivered.
   */
  error: Error | undefined;
}

/**
 * The diver's certification wallet (DESIGN.md §3, §6), live: save a card and every screen
 * holding this re-renders with it.
 *
 * **Its own hook rather than a field on any other read**, for the reason `useGearPresets`
 * records at length: a failed read of one thing must not blank another, and separate hooks are
 * the strongest form of that separation rather than a stated one, because there is no shared
 * object for two failures to be conflated inside.
 *
 * Its whole pipeline is `toCertifications(certificationRowsQuery(db))`, both of which
 * `db/certifications.test.ts` exercises against a real database — the split `useDives` and
 * `useGearPresets` both document, where the pure half is tested directly and `useLiveQuery`
 * itself is left to the app. There is nothing here beyond that call, `isResolved` and the memo.
 *
 * `toCertifications` is memoised on the raw row array for `useGearPresets`' reason: it is
 * `rows.map(...).sort(...)`, so without this every consumer would get a brand-new array on
 * every render whether or not a row had changed. It is an optimisation, not a contract — no
 * consumer may assume `certifications` is referentially stable.
 *
 * **Screens call this; components take the answer as a prop**, the same rule `useUnitSystem`
 * states, so every component stays a pure function of its props that a test can render without
 * a database.
 */
export function useCertifications(): CertificationListState {
  const rows = useLiveQuery(certificationRowsQuery(db));
  const rowData = rows.data;
  const certifications = useMemo(() => toCertifications(rowData), [rowData]);
  // `useCurrentError`, not `rows.error`: `useLiveQuery` sets `error` in its failure paths and
  // never clears it, so the raw field would stand for the life of the component once it fired.
  return { certifications, resolved: isResolved(rows), error: useCurrentError(rows) };
}
