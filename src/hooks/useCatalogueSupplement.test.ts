import { renderHook, waitFor } from '@testing-library/react-native';

import { useNearbySupplement } from './useCatalogueSupplement';

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
