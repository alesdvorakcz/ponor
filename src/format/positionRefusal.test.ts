import { setActiveLanguage } from '../i18n';
import { COARSEST_USABLE_FIX_M, POSITION_REFUSALS } from '../platform/location';
import { positionRefusalSentence } from './positionRefusal';

afterEach(() => {
  setActiveLanguage('en');
});

// Every refusal the device can give has its own sentence — a refusal with none would be a control that
// went quiet — and no two of them say the same thing.
it('says something different for every way of failing to get a pin', () => {
  const sentences = POSITION_REFUSALS.map(positionRefusalSentence);
  for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(0);
  expect(new Set(sentences).size).toBe(POSITION_REFUSALS.length);
});

// The threshold comes from the one place that owns it, not from a figure retyped in the sentence.
it('names the threshold a rough fix missed', () => {
  expect(positionRefusalSentence('imprecise')).toContain(`${String(COARSEST_USABLE_FIX_M)} m`);
});

it('speaks the language the app is in', () => {
  const english = positionRefusalSentence('denied');
  setActiveLanguage('cs');
  expect(positionRefusalSentence('denied')).not.toBe(english);
});
