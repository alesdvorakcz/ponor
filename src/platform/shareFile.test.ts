import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { shareTextFile } from './shareFile';

/**
 * **What the app does with a file it has just written, and what it does when it cannot.**
 *
 * Two native modules stand between the export and the diver, and neither can run under Jest —
 * so both are faked here, and the fakes are the shape of the guarantees rather than of the
 * libraries. What is asserted is the order (`nothing is shared that was not fully written`),
 * the recovery (`a failed write leaves nothing behind`) and the third outcome (`this platform
 * cannot share at all`), because those are the three things this module decides.
 *
 * The `expo-file-system` fake keeps its state inside the factory rather than in a module-scope
 * `const`, for the reason `babel-plugin-jest-hoist` makes necessary: every `jest.mock` call is
 * hoisted above every import, so a factory closing over a `const` declared below would run
 * before that binding is initialised.
 */

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-file-system', () => {
  const state = {
    created: [] as string[],
    written: [] as { name: string; text: string }[],
    deleted: [] as string[],
    writeError: null as Error | null,
  };
  class File {
    readonly name: string;
    constructor(_directory: unknown, name: string) {
      this.name = name;
    }
    get uri(): string {
      return `file:///cache/${this.name}`;
    }
    get extension(): string {
      const dot = this.name.lastIndexOf('.');
      return dot < 0 ? '' : this.name.slice(dot);
    }
    create(): void {
      state.created.push(this.name);
    }
    write(text: string): void {
      if (state.writeError !== null) throw state.writeError;
      state.written.push({ name: this.name, text });
    }
    delete(): void {
      state.deleted.push(this.name);
    }
  }
  return { File, Paths: { cache: 'file:///cache' }, __state: state };
});

interface FakeState {
  created: string[];
  written: { name: string; text: string }[];
  deleted: string[];
  writeError: Error | null;
}

const state = (FileSystem as unknown as { __state: FakeState }).__state;
const mockIsAvailable = Sharing.isAvailableAsync as jest.Mock;
const mockShare = Sharing.shareAsync as jest.Mock;

beforeEach(() => {
  state.created.length = 0;
  state.written.length = 0;
  state.deleted.length = 0;
  state.writeError = null;
  mockIsAvailable.mockClear();
  mockIsAvailable.mockImplementation(async () => true);
  mockShare.mockClear();
  mockShare.mockImplementation(async () => undefined);
});

describe('shareTextFile', () => {
  it('writes the text exactly as given and opens the sheet on it', async () => {
    await expect(shareTextFile('ponor-dives-2026-09-06.csv', 'a,b\r\nc,d\r\n')).resolves.toBe(
      'shared',
    );
    expect(state.written).toEqual([
      { name: 'ponor-dives-2026-09-06.csv', text: 'a,b\r\nc,d\r\n' },
    ]);
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare.mock.calls[0]?.[0]).toBe('file:///cache/ponor-dives-2026-09-06.csv');
  });

  it('tells the platform what a CSV is', async () => {
    await shareTextFile('dives.csv', 'a\r\n');
    expect(mockShare.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ UTI: 'public.comma-separated-values-text', mimeType: 'text/csv' }),
    );
  });

  it('tells the platform what a JSON file is', async () => {
    await shareTextFile('logbook.json', '{}\n');
    expect(mockShare.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ UTI: 'public.json', mimeType: 'application/json' }),
    );
  });

  it('falls back to plain text for an extension it does not name', async () => {
    await shareTextFile('logbook.uddf', '<uddf/>');
    expect(mockShare.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ UTI: 'public.plain-text', mimeType: 'text/plain' }),
    );
  });

  it('writes nothing at all where the platform cannot share', async () => {
    mockIsAvailable.mockImplementation(async () => false);

    await expect(shareTextFile('dives.csv', 'a\r\n')).resolves.toBe('unavailable');

    expect(state.created).toEqual([]);
    expect(state.written).toEqual([]);
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('shares nothing when the write failed', async () => {
    state.writeError = new Error('disk full');

    await expect(shareTextFile('dives.csv', 'a\r\n')).rejects.toThrow('disk full');

    // The guarantee this file exists for: a partial file must never reach a share sheet, where
    // a diver would keep it and throw the original away.
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('deletes what the failed write left behind', async () => {
    state.writeError = new Error('disk full');

    await expect(shareTextFile('dives.csv', 'a\r\n')).rejects.toThrow('disk full');

    expect(state.deleted).toEqual(['dives.csv']);
  });

  it('reports a sheet that would not open, and leaves the whole file alone', async () => {
    mockShare.mockImplementation(async () => {
      throw new Error('no view controller');
    });

    await expect(shareTextFile('dives.csv', 'a\r\n')).rejects.toThrow('no view controller');

    // By this point the file is complete and correct, and on iOS the sheet's own consumer may
    // still be reading it — deleting here would break an AirDrop to save a cache entry.
    expect(state.deleted).toEqual([]);
  });
});
