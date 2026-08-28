import { resolveScheme, themeFor } from './resolve';

describe('resolveScheme', () => {
  it('follows the system when there is no override', () => {
    expect(resolveScheme('light')).toBe('light');
    expect(resolveScheme('dark')).toBe('dark');
  });

  it('falls back to dark when the system reports no preference', () => {
    // RN 0.86's useColorScheme() returns 'unspecified'; older versions and
    // Appearance.getColorScheme() can still give null or undefined.
    expect(resolveScheme('unspecified')).toBe('dark');
    expect(resolveScheme(null)).toBe('dark');
    expect(resolveScheme(undefined)).toBe('dark');
  });

  it('lets an explicit override win over the system', () => {
    expect(resolveScheme('dark', 'light')).toBe('light');
    expect(resolveScheme('light', 'dark')).toBe('dark');
  });

  it('treats the "system" override as no override', () => {
    expect(resolveScheme('light', 'system')).toBe('light');
    expect(resolveScheme('unspecified', 'system')).toBe('dark');
  });

  it('lets an override win even when the system is unspecified', () => {
    expect(resolveScheme('unspecified', 'light')).toBe('light');
  });
});

describe('themeFor', () => {
  it('returns the dark token set', () => {
    expect(themeFor('dark').bg).toBe('#080B0F');
    expect(themeFor('dark').actionFg).toBe('#080B0F');
  });

  it('returns the light token set', () => {
    expect(themeFor('light').bg).toBe('#EDEEEA');
    expect(themeFor('light').action).toBe('#0D1216');
  });
});
