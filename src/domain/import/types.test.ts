import { decodeUtf8, ImportRefusal } from './types';

describe('decodeUtf8', () => {
  it('decodes valid UTF-8 text back to the original string', () => {
    const text = 'Suunto D5 — profondeur 42 m';
    expect(decodeUtf8(new TextEncoder().encode(text))).toBe(text);
  });

  it('returns the empty string for bytes that are not valid UTF-8, rather than throwing', () => {
    // The whole reason this function exists rather than a bare `new TextDecoder().decode()`:
    // a `recognises` built on substring matching (`decodeUtf8(file).includes(...)`) must
    // answer `false` for a file that is not text at all, not blow up the importer lookup that
    // called it. `{ fatal: true }` is what makes invalid UTF-8 throw in the first place —
    // without it `TextDecoder` silently replaces bad bytes with U+FFFD and this case could
    // never be reached.
    expect(decodeUtf8(new Uint8Array([0x00, 0x01, 0x02, 0xff]))).toBe('');
  });

  it('returns the empty string for a lone continuation byte', () => {
    // 0x80 is a UTF-8 continuation byte with no lead byte before it — invalid on its own, and
    // a different shape of invalid than arbitrary binary garbage.
    expect(decodeUtf8(new Uint8Array([0x80]))).toBe('');
  });
});

describe('ImportRefusal', () => {
  it('carries the reason as both its message and its own field, under a fixed name', () => {
    const refusal = new ImportRefusal('missing DeviceLog.Header.DateTime');
    expect(refusal.reason).toBe('missing DeviceLog.Header.DateTime');
    expect(refusal.message).toBe('missing DeviceLog.Header.DateTime');
    expect(refusal.name).toBe('ImportRefusal');
    expect(refusal).toBeInstanceOf(Error);
  });
});
