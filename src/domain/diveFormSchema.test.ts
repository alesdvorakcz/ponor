import { diveFormSchema, toNewDiveInput } from './diveFormSchema';

const base = { date: '2026-08-16' };

describe('the coercion contract', () => {
  it('turns an empty numeric field into null, never zero', () => {
    const v = diveFormSchema.parse({ ...base, maxDepthM: '', durationMin: '', weightsKg: '' });
    expect(v.maxDepthM).toBeNull();
    expect(v.durationMin).toBeNull();
    expect(v.weightsKg).toBeNull();
    // the specific failure this guards: Number('') === 0
    expect(v.maxDepthM).not.toBe(0);
  });

  it('turns an empty cylinder size into null, because zero would void the dive gas figure', () => {
    const v = diveFormSchema.parse({ ...base, tanks: [{ sizeL: '', count: '', o2Pct: '' }] });
    expect(v.tanks[0]?.sizeL).toBeNull();
    expect(v.tanks[0]?.count).toBeNull();
    expect(v.tanks[0]?.sizeL).not.toBe(0);
  });

  it('keeps a real zero when the diver actually typed one', () => {
    const v = diveFormSchema.parse({ ...base, waterTempC: '0' });
    expect(v.waterTempC).toBe(0);
  });

  it('turns whitespace into null too', () => {
    expect(diveFormSchema.parse({ ...base, maxDepthM: '   ' }).maxDepthM).toBeNull();
  });

  it('turns unparseable text into null rather than NaN reaching the database', () => {
    expect(diveFormSchema.parse({ ...base, maxDepthM: 'abc' }).maxDepthM).toBeNull();
  });
});

describe('never blocking a save', () => {
  it('accepts a dive carrying nothing but a date', () => {
    expect(() => diveFormSchema.parse({ date: '2026-08-16' })).not.toThrow();
  });

  it('accepts a negative depth as a value rather than refusing the dive', () => {
    // §1: validation may correct or warn; it must not refuse the save.
    expect(() => diveFormSchema.parse({ ...base, maxDepthM: '-5' })).not.toThrow();
  });
});

describe('toNewDiveInput', () => {
  it('omits fields the diver left empty rather than sending nulls for all of them', () => {
    const input = toNewDiveInput(diveFormSchema.parse({ date: '2026-08-16' }));
    expect(input.date).toBe('2026-08-16');
    expect(Object.values(input).every((v) => v !== 0)).toBe(true);
  });
});
