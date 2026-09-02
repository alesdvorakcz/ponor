import type { SupabaseClient } from '@supabase/supabase-js';

import { db } from '../db/client';
import type { Db } from '../db/types';
import { syncNow, type SyncReport } from './sync';
import { cloud } from './supabase';

/**
 * **When a sync cycle runs, and the guarantee that only one runs at a time.**
 *
 * `cloud/sync.ts` owns what a cycle *does* (§7.1–§7.3). This module owns *when* — DESIGN.md
 * §7.5's triggers — and it owns the two rules that make four triggers into one engine rather
 * than a stampede:
 *
 * > **One cycle at a time**, and **never while signed out or on a build with no backend.**
 *
 * The triggers themselves are in `cloud/syncTriggers.tsx`, because they are subscriptions with
 * a lifetime and this has none: this is a module constant with no React in it, exactly as
 * `cloud/localLogbook.ts` is, so it can be executed against a real in-memory database and the
 * fake server without a renderer.
 *
 * ── Why serialising is a correctness rule and not a politeness ─────────────────────────────
 *
 * Two cycles overlapping is not two syncs, it is a corrupted one. The push reads its set,
 * remembers each row's clock *as read*, sends, and clears flags against those remembered
 * clocks (`sync.ts`). A second push starting in the middle of that reads the same rows again,
 * sends them again, and both clear against clocks the other has already had restamped — so a
 * flag is cleared for a row the server took a *different* version of, and the diver's edit is
 * on one phone with nothing left to send it. Nothing raises. Nothing shows. §7.5 hands four
 * independent triggers to one engine, and without this every one of them is a second author
 * for a protocol whose whole safety argument (§7) is that there is only ever one.
 *
 * ── Requests coalesce; exclusive work does not ────────────────────────────────────────────
 *
 * `request()` is the trigger's verb, and asking twice does not mean syncing twice. A request
 * made while a cycle is *waiting to start* joins it — the cycle has not read anything yet, so
 * it will see whatever the second caller wanted seen. A request made while a cycle is
 * *running* gets one of its own, queued behind: that cycle has already read its push set, and
 * a save made a moment later would otherwise wait for the next trigger. So a burst of four
 * triggers costs one cycle, and a save landing mid-cycle is never dropped.
 *
 * `runExclusive` is the other half, and it is for the one other thing in this app that touches
 * the same rows: §7.4's sign-out erase (`cloud/localLogbook.ts`). It takes the same lock, so
 * no cycle can run inside the wipe — a pull landing between the erase and `signOut` would put
 * the logbook back on a device that is being signed out, which is precisely the outcome §7.4
 * calls "the only way a second account could ever see them".
 *
 * ── A failure is not an error the diver must dismiss ──────────────────────────────────────
 *
 * §1: "sync failures never block logging." Nothing here throws. A cycle that fails reports
 * `failed`, leaves every flag where it was, leaves the watermark where it was, and arms a
 * retry. What — if anything — a diver reads about that is the *caller's* decision and not this
 * module's: an automatic cycle says nothing, because the pending indicator is already the
 * honest account of it (`usePendingChanges.ts`), and only the diver who *asked*, by pulling
 * the list down, is answered in words (`DivesScreen.tsx`).
 */

/**
 * §7.5's "debounced 10 s after any save".
 *
 * **The window does not restart, and that is deliberate.** A textbook trailing-edge debounce
 * resets its timer on every call, so a diver saving a dive every eight seconds is a diver
 * whose logbook never syncs at all — the timer is pushed forward for as long as they keep
 * working, and "never syncs" is the exact defect class this whole task exists to close. What
 * is wanted from a debounce here is *coalescing*, not deferral: the first save arms the window
 * and every save inside it rides the same cycle, so eight edits cost one sync and the sync is
 * never more than ten seconds behind the first of them.
 */
export const SAVE_DEBOUNCE_MS = 10_000;

/**
 * §7.5 names **"connectivity restored"** as a trigger and this is what stands in for it.
 *
 * `@react-native-community/netinfo` is not installed, and installing it is a native dependency
 * and therefore a rebuild and the owner's call — so it was not installed. What is here instead
 * observes the *consequence* rather than the cause: a cycle that failed is retried on a
 * doubling delay, from 30 s to a five-minute ceiling, until one succeeds. That covers the case
 * connectivity actually is — the phone regains signal while the diver is looking at their list
 * and saving nothing — without claiming to know anything about the radio.
 *
 * Two honest limits, stated because the substitution is not free. It is **later** than netinfo
 * would be: up to five minutes rather than the moment the interface comes up. And it **cannot
 * tell a lost signal from a server that refuses this device**, so a build with a genuinely
 * broken RPC retries on the same ladder rather than giving up — which costs one call every
 * five minutes, and is the safe direction, because the alternative is a device that has
 * decided to stop trying.
 *
 * The ladder resets on any cycle that ran, successfully or skipped, and the timer is dropped
 * by `stop()` — which `syncTriggers.tsx` calls the moment a session ends.
 */
export const RETRY_FIRST_MS = 30_000;
export const RETRY_CEILING_MS = 300_000;

/** How a cycle ended. Three arms because *"it did not run"* is not a failure and must not be
 * reported as one — a guest device skipping is the ordinary, specified state of this app
 * (§1), not something that went wrong. */
export type SyncOutcome =
  | { readonly kind: 'synced'; readonly report: SyncReport }
  | { readonly kind: 'failed' }
  | { readonly kind: 'skipped' };

export interface SyncEngine {
  /**
   * Run a cycle. Resolves when the cycle this call is answered by has finished, and **never
   * rejects** — see the module docblock's last paragraph.
   */
  readonly request: () => Promise<SyncOutcome>;
  /** §7.5's save trigger: ask for a cycle `SAVE_DEBOUNCE_MS` from now, or ride the window one
   * is already inside. */
  readonly requestAfterSave: () => void;
  /**
   * Runs `work` with the engine held: no cycle starts while it runs, and **anything already
   * scheduled is dropped**, because the caller is about to change the same rows and a cycle
   * armed before it cannot know that. §7.4's wipe is the one caller.
   */
  readonly runExclusive: <T>(work: () => Promise<T>) => Promise<T>;
  /** Drops the save window and the retry ladder. Not a stop of anything in flight — there is
   * no way to un-send a push — and deliberately not a latch: the engine's own guard is the
   * session, checked at the moment a cycle runs, so a request arriving after this is refused
   * on its own merits rather than by a flag that would then have to be un-set. */
  readonly stop: () => void;
}

export interface SyncEngineDeps {
  readonly db: Db;
  /**
   * The backend, asked for at the moment a cycle is about to run, or `null` when this build
   * has none — `cloud/localLogbook.ts`'s own dependency, in the same shape and for the same
   * reason: a function, so that building the engine reads nothing at module scope.
   */
  readonly client: () => SupabaseClient | null;
}

/**
 * Builds an engine over one database and one backend.
 *
 * Exported so the rules above can be executed against a real (in-memory) database and
 * `src/testing/fakeSyncServer.ts`, which is the only way any of this is checked: nobody here
 * has credentials for the owner's project and **no round trip has ever been performed from
 * this repository**.
 */
export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  /**
   * The lock, as a promise chain. Every job runs after the previous one has settled — settled,
   * not succeeded, which is what the two-armed `then` is for: a failed job must not strand the
   * queue behind it for the life of the process.
   */
  let chain: Promise<void> = Promise.resolve();
  /**
   * The cycle a `request()` would be answered by, while it is still *waiting*. Cleared the
   * moment that cycle begins, which is the whole of the coalescing rule: a request arriving
   * before the read joins it, one arriving after gets its own.
   */
  let waiting: Promise<SyncOutcome> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** How many cycles have failed in a row. Reset by any cycle that ran, and by `stop()`. */
  let retryFailures = 0;

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const job = chain.then(work);
    chain = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  const clearSaveTimer = () => {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
  };

  const clearRetryTimer = () => {
    if (retryTimer === null) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };

  /**
   * One cycle, with §7.5's two refusals in front of it.
   *
   * **No backend, or nobody signed in, and nothing happens at all** — no RPC, no error, no
   * flag touched. `supabase.ts`'s contract is that a build with no credentials behaves exactly
   * as it did before that file existed, and §1's is that a diver who never signs in has a
   * complete offline logbook; a guest whose every save reached for the network would break
   * both. The session is read **here**, at the moment the cycle runs, rather than remembered
   * from whenever the trigger was armed: a save-window timer armed while signed in fires ten
   * seconds later, and sign-out is one tap.
   *
   * A keychain that will not answer reads as *nobody is signed in*, which is the same rule
   * `useAuthSession.ts` states for the same read: there is no diver-facing difference between
   * "no session" and "no readable session", and treating it as a failure would arm a retry
   * ladder against a device that has nothing to sync.
   */
  const cycle = async (): Promise<SyncOutcome> => {
    const client = deps.client();
    if (client === null) return { kind: 'skipped' };

    let signedIn: boolean;
    try {
      const { data } = await client.auth.getSession();
      signedIn = data.session !== null;
    } catch {
      signedIn = false;
    }
    if (!signedIn) return { kind: 'skipped' };

    try {
      return { kind: 'synced', report: await syncNow(deps.db, client) };
    } catch {
      // Swallowed here and nowhere else. §1: a sync failure costs the sync, never the logbook,
      // and never a screen. The rows keep their flags, the watermark keeps its value, and the
      // retry below is what tries again.
      return { kind: 'failed' };
    }
  };

  const armRetry = () => {
    clearRetryTimer();
    const delay = Math.min(RETRY_FIRST_MS * 2 ** retryFailures, RETRY_CEILING_MS);
    retryFailures += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void request();
    }, delay);
  };

  const runOnce = async (): Promise<SyncOutcome> => {
    const outcome = await cycle();
    if (outcome.kind === 'failed') {
      armRetry();
      return outcome;
    }
    // A cycle that ran — or that was correctly refused — settles the ladder. Refused counts,
    // because a retry against a device with no session is a timer with nothing to do.
    clearRetryTimer();
    retryFailures = 0;
    return outcome;
  };

  function request(): Promise<SyncOutcome> {
    if (waiting !== null) return waiting;
    const job = enqueue(() => {
      waiting = null;
      return runOnce();
    });
    waiting = job;
    return job;
  }

  return {
    request,

    requestAfterSave: () => {
      // Already inside a window: this save rides the cycle that window is going to ask for.
      // Not `clearTimeout` and re-arm — see `SAVE_DEBOUNCE_MS` for why a restarting window is
      // the one shape of this that can starve.
      if (saveTimer !== null) return;
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void request();
      }, SAVE_DEBOUNCE_MS);
    },

    runExclusive: (work) => {
      clearSaveTimer();
      clearRetryTimer();
      retryFailures = 0;
      return enqueue(work);
    },

    stop: () => {
      clearSaveTimer();
      clearRetryTimer();
      retryFailures = 0;
    },
  };
}

/**
 * **The app's one sync engine.**
 *
 * A module-scope constant for `cloud`'s own reason (supabase.ts, "Why a module-scope
 * constant") and `localLogbook`'s: there is nothing to memoise wrongly and no second instance
 * reachable — and a *second* engine would be two serialisers, which is no serialiser at all.
 * Building it reads nothing, opens nothing and starts no timer; the first thing that happens
 * is whatever the first trigger asks for.
 */
export const syncEngine: SyncEngine = createSyncEngine({
  db,
  client: () => (cloud.configured ? cloud.client : null),
});
