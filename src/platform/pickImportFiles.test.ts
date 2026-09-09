import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

import { pickImportFiles } from './pickImportFiles';

/**
 * **What comes back when a diver hands this app a file from outside it**, `shareFile.test.ts`'s
 * own question turned around: that file asserts what this app hands *out*, and the guarantees
 * here are its mirror — the three-state result (`ImportFile[]`, `'cancelled'`, `'unavailable'`)
 * so a screen never has to wrap this call in a `try`/`catch` for an ordinary outcome, and the
 * one genuine failure (a chosen file that will not read) is left to reject, exactly as a failed
 * *write* is left to reject there.
 *
 * Both native modules are faked, for `shareFile.test.ts`'s own reason: neither runs under Jest.
 * `expo-file-system`'s fake keeps its state inside the factory rather than a module-scope
 * `const`, for the `babel-plugin-jest-hoist` reason that file's own comment records.
 */

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

jest.mock('expo-file-system', () => {
  const state = {
    bytesByUri: {} as Record<string, Uint8Array>,
    readError: null as Error | null,
  };
  class File {
    readonly uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async bytes(): Promise<Uint8Array> {
      if (state.readError !== null) throw state.readError;
      return state.bytesByUri[this.uri] ?? new Uint8Array();
    }
  }
  return { File, __state: state };
});

interface FakeState {
  bytesByUri: Record<string, Uint8Array>;
  readError: Error | null;
}

const state = (FileSystem as unknown as { __state: FakeState }).__state;
const mockGetDocumentAsync = DocumentPicker.getDocumentAsync as jest.Mock;

beforeEach(() => {
  state.bytesByUri = {};
  state.readError = null;
  mockGetDocumentAsync.mockReset();
});

/** A picked asset, with only the fields this module reads. */
const asset = (name: string, uri: string) => ({ name, uri, lastModified: 0 });

describe('pickImportFiles', () => {
  it('hands back the bytes of every file the diver picked', async () => {
    state.bytesByUri['file:///cache/a.json'] = new Uint8Array([1, 2, 3]);
    state.bytesByUri['file:///cache/b.json'] = new Uint8Array([4, 5]);
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [asset('a.json', 'file:///cache/a.json'), asset('b.json', 'file:///cache/b.json')],
    });

    await expect(pickImportFiles()).resolves.toEqual([
      { name: 'a.json', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'b.json', bytes: new Uint8Array([4, 5]) },
    ]);
  });

  it('says the diver backed out, rather than handing back an empty list', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null });

    await expect(pickImportFiles()).resolves.toBe('cancelled');
  });

  it('asks for every file at once, since a diver is handing over a folder', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null });

    await pickImportFiles();

    expect(mockGetDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
  });

  it('does not filter by type, since a format is recognised by its content and not its name', async () => {
    // registry.ts's own reasoning: two of §9's formats already share the `.json` extension, so
    // filtering this picker by name or MIME type could hide a file this app can read.
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null });

    await pickImportFiles();

    const options = mockGetDocumentAsync.mock.calls[0]?.[0] as { type?: unknown };
    expect(options.type).toBeUndefined();
  });

  it('says no picker is available, rather than throwing, when the attempt to show one fails', async () => {
    // Unlike `expo-sharing`, this library has no `isAvailableAsync` to ask first — the one call
    // that would show the picker is the only thing there is to ask, so failing it is how
    // "there is no picker here" is told apart from a diver's own files being unreadable.
    mockGetDocumentAsync.mockRejectedValue(new Error('no activity found'));

    await expect(pickImportFiles()).resolves.toBe('unavailable');
  });

  it('still rejects when a chosen file cannot be read, rather than reporting it as unavailable', async () => {
    // A file the OS just copied into this app's own cache failing to read is not the ordinary
    // "there is no picker" outcome above — it is a genuine, unexpected failure, and
    // `shareFile.ts` leaves the same shape of failure (a write that does not complete) to
    // reject rather than folding it into a named outcome.
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [asset('a.json', 'file:///cache/a.json')],
    });
    state.readError = new Error('disk full');

    await expect(pickImportFiles()).rejects.toThrow('disk full');
  });
});
