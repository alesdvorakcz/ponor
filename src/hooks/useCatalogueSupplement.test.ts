import { act, renderHook, waitFor } from '@testing-library/react-native';

import { LIVE_SEARCH_DELAY_MS, useCatalogueSupplement, useNearbySupplement } from './useCatalogueSupplement';

/**
 * **`useNearbySupplement` — the point-shaped twin of `useCatalogueSupplement`** (the site
 * picker's *Near me* list). Same contract: nothing throws, a stale answer is never applied, and
 * there is no delay because a point is a settled value rather than a keystroke.
 *
 * `cloud/supabase` and `db/client` are replaced by inert objects: both are native-backed
 * singletons, and what is under test is only that the hook hands one to `search` and the other
 * to `apply`.
 */
jest.mock('../cloud/supabase', () => ({ cloud: { configured: false } }));
jest.mock('../db/client', () => ({ db: { marker: 'db' } }));

const POINT = { latitude: 43.06, longitude: 16.18 };

it('applies the rows found around the point once', async () => {
  const search = jest.fn().mockResolvedValue([{ id: 'a' }]);
  const apply = jest.fn().mockResolvedValue(undefined);

  await renderHook(() => useNearbySupplement(POINT, search, apply));

  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(search).toHaveBeenCalledWith({ configured: false }, POINT);
  expect(apply).toHaveBeenCalledWith({ marker: 'db' }, [{ id: 'a' }]);
  expect(search).toHaveBeenCalledTimes(1);
});

it('does nothing without a point', async () => {
  const search = jest.fn().mockResolvedValue([{ id: 'a' }]);
  const apply = jest.fn();

  await renderHook(() => useNearbySupplement(null, search, apply));
  await Promise.resolve();

  expect(search).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});

it('does not apply after unmount', async () => {
  let resolve: (rows: { id: string }[]) => void = () => {};
  const search = jest.fn().mockReturnValue(new Promise((r) => (resolve = r)));
  const apply = jest.fn();

  const { unmount } = await renderHook(() => useNearbySupplement(POINT, search, apply));
  await waitFor(() => expect(search).toHaveBeenCalled());
  await unmount();
  resolve([{ id: 'a' }]);
  await Promise.resolve();
  await Promise.resolve();

  expect(apply).not.toHaveBeenCalled();
});

it('swallows a write that refuses', async () => {
  const search = jest.fn().mockResolvedValue([{ id: 'a' }]);
  const apply = jest.fn().mockRejectedValue(new Error('disk full'));

  await renderHook(() => useNearbySupplement(POINT, search, apply));

  await waitFor(() => expect(apply).toHaveBeenCalled());
});

// --- Whether the server is still being asked (the picker's "Nothing within 50 km" waits on it) ---

it('says it is asking from the point until the rows are written, then not', async () => {
  let answer: (rows: { id: string }[]) => void = () => {};
  const search = jest.fn().mockReturnValue(new Promise((r) => (answer = r)));
  let written: () => void = () => {};
  const apply = jest.fn().mockReturnValue(new Promise<void>((r) => (written = r)));

  const { result } = await renderHook(() => useNearbySupplement(POINT, search, apply));
  expect(result.current).toBe(true);
  await waitFor(() => expect(search).toHaveBeenCalled());
  answer([{ id: 'a' }]);
  await waitFor(() => expect(apply).toHaveBeenCalled());
  // Still out while the rows are being written: the list has not got them yet.
  expect(result.current).toBe(true);
  written();
  await waitFor(() => expect(result.current).toBe(false));
});

it('stops asking once the server answers with nothing, and once a write refuses', async () => {
  const empty = jest.fn().mockResolvedValue([]);
  const none = await renderHook(() => useNearbySupplement(POINT, empty, jest.fn()));
  await waitFor(() => expect(none.result.current).toBe(false));

  const refused = jest.fn().mockRejectedValue(new Error('disk full'));
  const failing = await renderHook(() =>
    useNearbySupplement(POINT, jest.fn().mockResolvedValue([{ id: 'a' }]), refused),
  );
  await waitFor(() => expect(failing.result.current).toBe(false));
});

it('is not asking without a point, and asks again for a new one', async () => {
  let answer: (rows: { id: string }[]) => void = () => {};
  const search = jest.fn().mockReturnValueOnce(Promise.resolve([])).mockReturnValue(new Promise((r) => (answer = r)));
  const apply = jest.fn();
  let point: typeof POINT | null = null;

  const { result, rerender } = await renderHook(() => useNearbySupplement(point, search, apply));
  expect(result.current).toBe(false);

  point = POINT;
  await rerender({});
  await waitFor(() => expect(result.current).toBe(false));

  point = { latitude: 43.1, longitude: 16.2 };
  await rerender({});
  expect(result.current).toBe(true);
  answer([]);
  await waitFor(() => expect(result.current).toBe(false));
  expect(search).toHaveBeenCalledTimes(2);
});

// --- The name search reports nothing, so its answer costs its screen no render -----------------

// Sites, Centres and the picker each run a name search on every pause in typing. What it writes
// reaches the screen through the live query; whether it has answered is Near me's question alone,
// so an answer — rows or none — must not re-render the screen that asked.
describe('useCatalogueSupplement', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each([
    ['rows', [{ id: 'a' }]],
    ['nothing', []],
  ])('asks after the pause and re-renders nothing when the answer is %s', async (_, rows) => {
    const search = jest.fn().mockResolvedValue(rows);
    const apply = jest.fn().mockResolvedValue(undefined);
    let renders = 0;

    await renderHook(() => {
      renders += 1;
      useCatalogueSupplement('Ponorka', search, apply);
    });
    const before = renders;
    await act(async () => {
      jest.advanceTimersByTime(LIVE_SEARCH_DELAY_MS);
    });
    await act(async () => {});
    await act(async () => {});

    expect(search).toHaveBeenCalledWith({ configured: false }, 'Ponorka');
    expect(apply).toHaveBeenCalledTimes(rows.length === 0 ? 0 : 1);
    expect(renders).toBe(before);
  });
});
