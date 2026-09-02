import type { SupabaseClient } from '@supabase/supabase-js';

import { createDive, listDives } from '../db/dives';
import { createTestDb, type TestDb } from '../db/testDb';
import { fakeSupabaseClient, FakeSyncServer } from '../testing/fakeSyncServer';
import {
  createSyncEngine,
  RETRY_CEILING_MS,
  RETRY_FIRST_MS,
  SAVE_DEBOUNCE_MS,
  syncEngine,
  type SyncEngine,
} from './syncEngine';

/**
 * **DESIGN.md §7.5's engine: when a cycle runs, and the guarantee that only one does.**
 *
 * **No round trip has ever been performed from this repository** — see `cloud/sync.test.ts`
 * for what that means. The database below is real and in memory with the real migrations on
 * it; the server is `src/testing/fakeSyncServer.ts`.
 *
 * ── What is aimed at here, and why none of it would show in a diff ────────────────────────
 *
 * Every failure this file is about is silent, and three of them are silent in the direction
 * that looks like success:
 *
 * · **A trigger that fires while signed out** reaches for the network from a device §1 says
 *   is a complete offline logbook, and on a guest's phone it would do so after every save,
 *   for ever, with nothing on any screen different.
 * · **Two cycles overlapping** is not two syncs. Both push the same rows and both clear flags
 *   against clocks the other has had restamped, so a flag is cleared for a row the server took
 *   a different version of and a diver's edit stays on one phone. Nothing raises.
 * · **A debounce that never fires** is a logbook that never syncs. The textbook
 *   trailing-edge shape produces it exactly, on a diver who keeps working.
 * · **A retry that never stops** is a phone dialling a dead server every thirty seconds until
 *   its battery goes.
 */

let db: TestDb;
let server: FakeSyncServer;
let client: SupabaseClient;

beforeEach(() => {
  jest.useFakeTimers();
  db = createTestDb();
  server = new FakeSyncServer();
  client = fakeSupabaseClient(server) as unknown as SupabaseClient;
});

afterEach(() => {
  jest.useRealTimers();
});

/** An engine over the real database and whichever backend a test hands it. */
function engineOver(backend: SupabaseClient | null = client): SyncEngine {
  return createSyncEngine({ db, client: () => backend });
}

/**
 * Lets every already-scheduled microtask run, without advancing a timer.
 *
 * `jest.useFakeTimers()` leaves promises alone — they are microtasks, not timers — so this is
 * a real `await` on an immediately-resolved promise, repeated enough times to drain a whole
 * cycle's chain of them. **Deliberately far more than a cycle needs.** A whole cycle is on the
 * order of forty awaits (the queue, `getSession`, four pending reads, the push, four flag
 * clears, four applies, the pull, the watermark), and the assertions this helper is riskiest
 * for are the *negative* ones — "nothing happened yet" — where too few iterations is a false
 * pass. The positive tests in this file use the identical helper, so a count too small to
 * drain a cycle would turn them red rather than leaving the negatives quietly vacuous.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}

/** Moves the fake clock and then drains what the timers started. */
async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await settle();
}

/** The RPCs the server was actually asked for, in order. */
function calls(): string[] {
  return server.calls.map((call) => call.rpc);
}

/** How many complete cycles reached the server. Each is one push (only when something is
 * pending) and one pull, so pulls are what a cycle can always be counted by. */
function cycles(): number {
  return calls().filter((rpc) => rpc === 'pull_changes').length;
}

describe('the two refusals in front of every cycle (§7.5)', () => {
  it('does nothing at all on a build with no backend — no call, no error, no throw', async () => {
    await createDive(db, { date: '2026-08-16' });

    expect(await engineOver(null).request()).toEqual({ kind: 'skipped' });

    expect(server.calls).toEqual([]);
  });

  /**
   * **The one that matters on the commonest device there is.** Every local write sets the
   * dirty flag whether or not anybody is signed in (`db/dirty.ts` — the flag is about the row),
   * so a guest's whole logbook is pending, and a trigger that did not ask this question would
   * dial the server after every save a guest ever made. §1: the app runs offline and an account
   * is only needed to back up.
   */
  it('does nothing when nobody is signed in, however much is waiting to go up', async () => {
    await createDive(db, { date: '2026-08-16' });
    const guest = fakeSupabaseClient(server, { session: null }) as unknown as SupabaseClient;

    expect(await engineOver(guest).request()).toEqual({ kind: 'skipped' });

    expect(server.calls).toEqual([]);
  });

  /** A keychain that will not answer reads as nobody being signed in — `useAuthSession.ts`'s
   * own rule for the same read — and, being a refusal rather than a failure, arms no retry. */
  it('treats an unreadable session as nobody, and arms no retry over it', async () => {
    const locked = fakeSupabaseClient(server, { session: 'unreadable' }) as unknown as SupabaseClient;
    const engine = engineOver(locked);

    expect(await engine.request()).toEqual({ kind: 'skipped' });

    await advance(RETRY_CEILING_MS * 4);
    expect(server.calls).toEqual([]);
  });

  /**
   * **The session is read afresh on every cycle, not once and remembered**, which is the whole
   * reason the guard lives in the engine rather than at the four trigger sites. A save window
   * is ten seconds long and signing out is one tap.
   *
   * The first cycle is what makes this falsifiable rather than decorative: an engine that read
   * the session once and cached it would answer this test's *second* question with the first
   * answer, and every trigger after a sign-out would go on syncing. Without a successful cycle
   * in front of it there is nothing for a cache to have cached, and the mutation survives —
   * which is exactly what happened the first time this was written.
   */
  it('re-reads the session on every cycle, so one after a sign-out is refused', async () => {
    let signedIn = true;
    const leaving = {
      rpc: (rpc: string, args: Record<string, unknown>) => server.call(rpc, args),
      auth: { getSession: async () => ({ data: { session: signedIn ? { user: {} } : null } }) },
    } as unknown as SupabaseClient;
    const engine = engineOver(leaving);

    // A whole cycle while signed in, so the engine has had a session in its hands.
    await createDive(db, { date: '2026-08-16' });
    expect((await engine.request()).kind).toBe('synced');
    const whileSignedIn = server.calls.length;
    expect(whileSignedIn).toBeGreaterThan(0);

    // Now the diver signs out with a save window already armed.
    await createDive(db, { date: '2026-08-17' });
    engine.requestAfterSave();
    signedIn = false;

    await advance(SAVE_DEBOUNCE_MS);

    expect(server.calls.length).toBe(whileSignedIn);
    expect(await engine.request()).toEqual({ kind: 'skipped' });
    expect(server.calls.length).toBe(whileSignedIn);
  });
});

describe('one cycle at a time (§7.5)', () => {
  /**
   * Four triggers arriving together are one sync. The engine is idle, so the first request
   * schedules a cycle that has not read anything yet — every other request in the same tick
   * therefore gets exactly what it wanted from that one.
   */
  it('coalesces a burst of triggers into a single cycle', async () => {
    const engine = engineOver();
    await createDive(db, { date: '2026-08-16' });

    const outcomes = await Promise.all([
      engine.request(),
      engine.request(),
      engine.request(),
      engine.request(),
    ]);

    expect(cycles()).toBe(1);
    expect(calls()).toEqual(['push_changes', 'pull_changes']);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['synced', 'synced', 'synced', 'synced']);
  });

  /**
   * **A request made while a cycle is running gets one of its own, and it runs afterwards
   * rather than beside it.** Both halves are load-bearing: the running cycle has already read
   * its push set, so a dive saved a moment later would be dropped by a coalescing that went
   * this far — and two cycles at once is the flag-clearing corruption in this file's docblock.
   *
   * The lock is proved by holding the first cycle open: while it is held, the second has made
   * no call at all.
   */
  it('queues a request made mid-cycle behind it instead of running both', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstCall = true;
    const slow = {
      rpc: async (rpc: string, args: Record<string, unknown>) => {
        if (firstCall) {
          firstCall = false;
          await held;
        }
        return server.call(rpc, args);
      },
      auth: { getSession: async () => ({ data: { session: { user: {} } } }) },
    } as unknown as SupabaseClient;
    const engine = createSyncEngine({ db, client: () => slow });

    const first = engine.request();
    await settle();
    // The first cycle has started and is stuck inside its first RPC.
    expect(server.calls.length).toBe(0);

    const second = engine.request();
    await settle();
    expect(second).not.toBe(first);
    expect(server.calls.length).toBe(0);

    release();
    await first;
    await second;
    expect(cycles()).toBe(2);
  });

  /** `runExclusive` shares the same lock, which is what §7.4's wipe is built on
   * (`cloud/localLogbook.ts`): nothing syncs inside it. */
  it('runs nothing while exclusive work holds the engine', async () => {
    const engine = engineOver();
    await createDive(db, { date: '2026-08-16' });

    let release = () => {};
    const work = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exclusive = engine.runExclusive(() => work);
    await settle();

    void engine.request();
    await settle();
    expect(server.calls).toEqual([]);

    release();
    await exclusive;
    await settle();
    expect(cycles()).toBe(1);
  });

  /** And it drops what was already scheduled, because the caller is about to change the same
   * rows and a window armed before it cannot know that (§7.4's erase). */
  it('drops an armed save window when exclusive work takes the engine', async () => {
    const engine = engineOver();
    await createDive(db, { date: '2026-08-16' });
    engine.requestAfterSave();

    await engine.runExclusive(async () => undefined);

    await advance(SAVE_DEBOUNCE_MS * 4);
    expect(server.calls).toEqual([]);
  });

  /** A cycle that fails must not strand the queue behind it. */
  it('keeps running after a failed cycle rather than wedging the queue', async () => {
    const engine = engineOver();
    server.refusal = { message: 'fetch failed' };

    expect(await engine.request()).toEqual({ kind: 'failed' });
    expect(await engine.request()).toEqual({ kind: 'synced', report: { pushed: 0, pulled: 0 } });
  });

  /**
   * **And nor must exclusive work that *rejects*, which is the case the queue's own release is
   * written for.** A cycle never rejects — it swallows its failure and reports `failed` (§1) —
   * so the only thing that can leave a rejected promise on the lock is `runExclusive`, and
   * §7.4's wipe rejects whenever the erase itself could not run (`cloud/localLogbook.ts`, and
   * `auth.ts` turns that into `WIPE_FAILED`). Released on a *settled* job rather than a
   * successful one, or a diver whose sign-out failed once never syncs again for the life of
   * the process.
   */
  it('keeps running after exclusive work rejects', async () => {
    const engine = engineOver();

    await expect(
      engine.runExclusive(() => Promise.reject(new Error('the erase could not run'))),
    ).rejects.toThrow('the erase could not run');

    expect(await engine.request()).toEqual({ kind: 'synced', report: { pushed: 0, pulled: 0 } });
    expect(cycles()).toBe(1);
  });
});

describe('§7.5’s save window', () => {
  it('runs no cycle until the window is up, and exactly one when it is', async () => {
    const engine = engineOver();
    await createDive(db, { date: '2026-08-16' });

    engine.requestAfterSave();
    await advance(SAVE_DEBOUNCE_MS - 1);
    expect(server.calls).toEqual([]);

    await advance(1);
    expect(cycles()).toBe(1);
  });

  /** Eight saves inside one window are one sync — §7.5's whole point. */
  it('collapses a burst of saves into one cycle', async () => {
    const engine = engineOver();
    await createDive(db, { date: '2026-08-16' });

    for (let i = 0; i < 8; i += 1) {
      engine.requestAfterSave();
      jest.advanceTimersByTime(1_000);
    }
    await settle();
    await advance(SAVE_DEBOUNCE_MS);

    expect(cycles()).toBe(1);
  });

  /**
   * **And a diver who keeps working still syncs**, which is what a resetting window cannot
   * promise. Saves arrive every 8 s for two minutes; a trailing-edge debounce would push the
   * timer forward each time and never fire at all.
   */
  it('is not restarted by a later save, so a diver saving steadily is never starved', async () => {
    const engine = engineOver();
    await createDive(db, { date: '2026-08-16' });

    for (let i = 0; i < 15; i += 1) {
      engine.requestAfterSave();
      await advance(8_000);
    }

    // 120 s of saving at 8 s intervals. A window opens on a save, fires 10 s later, and the
    // next save after that opens the next one — so a cycle roughly every 16 s, seven of them
    // here. **The number that matters is that it is not zero**, which is exactly what a
    // trailing-edge debounce would have produced: every save inside 10 s of the last would
    // have pushed the timer out again, for the whole two minutes.
    expect(cycles()).toBeGreaterThanOrEqual(6);
    expect(cycles()).toBeLessThanOrEqual(9);
  });

  it('opens a fresh window for a save made after the last one fired', async () => {
    const engine = engineOver();
    engine.requestAfterSave();
    await advance(SAVE_DEBOUNCE_MS);

    engine.requestAfterSave();
    await advance(SAVE_DEBOUNCE_MS);

    expect(cycles()).toBe(2);
  });
});

describe('§7.5’s "connectivity restored", as a retry ladder', () => {
  /**
   * A backend that is signed in and refuses everything, **counting how often it was asked**.
   *
   * `server.calls` cannot be used for these: a call the fake server never sees leaves no trace
   * there, and a retry ladder is exactly a sequence of calls that fail. Counted here so an
   * assertion about "one more attempt" is about an attempt and not about a side effect of one.
   */
  function deadBackend() {
    const attempts = { count: 0 };
    const client = {
      rpc: async () => {
        attempts.count += 1;
        return { data: null, error: { message: 'fetch failed' } };
      },
      auth: { getSession: async () => ({ data: { session: { user: {} } } }) },
    } as unknown as SupabaseClient;
    return { attempts, client };
  }

  /** Nothing observes the radio, so what is checked is the consequence: a failed cycle is
   * tried again without anybody asking. */
  it('tries again by itself after a cycle fails', async () => {
    const { attempts, client: dead } = deadBackend();
    const engine = createSyncEngine({ db, client: () => dead });

    expect(await engine.request()).toEqual({ kind: 'failed' });
    expect(attempts.count).toBe(1);

    await advance(RETRY_FIRST_MS - 1);
    expect(attempts.count).toBe(1);

    await advance(1);
    expect(attempts.count).toBe(2);
  });

  /** It backs off rather than hammering: the second wait is twice the first, so the delay that
   * was enough last time is not enough this time. */
  it('doubles the wait after each further failure', async () => {
    const { attempts, client: dead } = deadBackend();
    const engine = createSyncEngine({ db, client: () => dead });

    await engine.request();
    await advance(RETRY_FIRST_MS);
    expect(attempts.count).toBe(2);

    // The same wait again buys nothing, because the second rung is twice as long.
    await advance(RETRY_FIRST_MS);
    expect(attempts.count).toBe(2);

    await advance(RETRY_FIRST_MS);
    expect(attempts.count).toBe(3);
  });

  /**
   * The ladder has a ceiling, so a device against a server that will never answer settles into
   * one call every five minutes rather than doubling into a timer nobody will ever see fire.
   * Ten failures at 30 s doubling would put the eleventh wait over eight hours.
   */
  it('stops doubling at the ceiling', async () => {
    const { attempts, client: dead } = deadBackend();
    const engine = createSyncEngine({ db, client: () => dead });

    await engine.request();
    for (let i = 0; i < 10; i += 1) await advance(RETRY_CEILING_MS);

    const before = attempts.count;
    expect(before).toBeGreaterThan(5);
    await advance(RETRY_CEILING_MS);
    expect(attempts.count).toBe(before + 1);
  });

  /**
   * A cycle that works clears the ladder, so the next failure starts at the bottom of it again
   * rather than at whatever the last outage climbed to. Without the reset the second retry
   * would be sixty seconds out and this advance would find nothing.
   */
  it('resets the ladder once a cycle succeeds', async () => {
    const engine = engineOver();
    server.refusal = { message: 'fetch failed' };
    expect(await engine.request()).toEqual({ kind: 'failed' });

    await advance(RETRY_FIRST_MS);
    const afterRecovery = server.calls.length;
    expect(afterRecovery).toBe(2);

    server.refusal = { message: 'fetch failed' };
    expect(await engine.request()).toEqual({ kind: 'failed' });
    await advance(RETRY_FIRST_MS);
    expect(server.calls.length).toBe(afterRecovery + 2);
  });

  it('drops the retry when the session ends (`stop`)', async () => {
    const engine = engineOver();
    server.refusal = { message: 'fetch failed' };
    await engine.request();
    const before = server.calls.length;

    engine.stop();
    await advance(RETRY_CEILING_MS * 4);

    expect(server.calls.length).toBe(before);
  });

  it('drops an armed save window too', async () => {
    const engine = engineOver();
    engine.requestAfterSave();
    engine.stop();

    await advance(SAVE_DEBOUNCE_MS * 4);
    expect(server.calls).toEqual([]);
  });
});

describe('what a cycle actually does, end to end', () => {
  /**
   * **The whole reason this task exists.** Nothing in the app pulled before M2h, so a device
   * that signed back in never asked for the rows that were safe on the server. One
   * `request()` is what asks.
   */
  it('brings down a logbook this device has never seen', async () => {
    server.seed('dives', {
      id: '01920000-0000-7000-8000-00000000d1ce',
      date: '2026-08-16',
      status: 'logged',
      max_depth_m: 18,
      tanks: [],
      equipment: [],
    });

    expect(await engineOver().request()).toEqual({ kind: 'synced', report: { pushed: 0, pulled: 1 } });
    expect((await listDives(db)).map((dive) => dive.date)).toEqual(['2026-08-16']);
  });

  it('sends what this device owes and reports it', async () => {
    await createDive(db, { date: '2026-08-16' });

    expect(await engineOver().request()).toEqual({ kind: 'synced', report: { pushed: 1, pulled: 0 } });
    expect(server.rows('dives').length).toBe(1);
  });

  /** §1: a failure costs the cycle and nothing else — the rows keep their flags and the
   * logbook is exactly where it was. */
  it('leaves the logbook and its flags alone when the server refuses', async () => {
    await createDive(db, { date: '2026-08-16' });
    server.refusal = { message: 'fetch failed' };

    expect(await engineOver().request()).toEqual({ kind: 'failed' });
    expect((await listDives(db)).length).toBe(1);
    expect(server.rows('dives')).toEqual([]);
  });
});

describe('the engine the app actually ships', () => {
  /**
   * There is exactly one, for the reason `cloud` and `localLogbook` are each one: a second
   * engine is a second serialiser, which is no serialiser at all. This pins that the module
   * exports a singleton rather than a factory the app calls twice.
   */
  it('is a single module constant', () => {
    expect(syncEngine).toBe(syncEngine);
    expect(typeof syncEngine.request).toBe('function');
    expect(typeof syncEngine.requestAfterSave).toBe('function');
    expect(typeof syncEngine.runExclusive).toBe('function');
    expect(typeof syncEngine.stop).toBe('function');
  });

  /** Building it starts nothing — `supabase.ts`'s contract, one module further out. A timer
   * armed at module scope would be a cycle nobody asked for, on a build with no account. */
  it('has armed no timer merely by existing', () => {
    expect(jest.getTimerCount()).toBe(0);
  });

  /** The two constants §7.5 is written in terms of, pinned so a "tidy-up" that turned 10 s
   * into 10 ms or the ceiling into a millisecond has to say so here. */
  it('waits ten seconds after a save and no more than five minutes between retries', () => {
    expect(SAVE_DEBOUNCE_MS).toBe(10_000);
    expect(RETRY_FIRST_MS).toBe(30_000);
    expect(RETRY_CEILING_MS).toBe(300_000);
  });
});
