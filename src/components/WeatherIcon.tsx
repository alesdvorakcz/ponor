import { SymbolView } from 'expo-symbols';
import { type ColorValue } from 'react-native';

import { type Weather } from '../domain/types';
import { symbolName, type PlatformSymbol } from './symbolName';

/**
 * The symbol for one `Weather` value — and unlike `EntryIcon`'s table, this one is complete.
 *
 * **Weather is the easy case, and it is easy for a reason worth naming.** §0.6's bar for an
 * *ordered scale* is that the mark encode the scale in itself, because a set of unrelated
 * glyphs standing for levels is a legend. Weather is not an ordered scale: `sunny` is not
 * *less* than `rainy`, they are six different skies. So the test that applies is the one
 * §0.6 states first — "whether the mark carries the meaning or merely labels it" — which is
 * the *shore* and *boat* test, and a sun, a cloud and rain pass it as trivially as a ferry
 * does. Nobody has to be taught that a cloud means cloud.
 *
 * That is also why every member has one, where `Entry` leaves `other` bare: there is no
 * weather nobody has drawn. If `WEATHER_VALUES` ever grows a member with no obvious sky, the
 * honest move is to leave it out of this record — `Partial` would allow that silently, so
 * this is a **total** `Record` instead and TypeScript will demand an answer, which is §4.1's
 * "derive, or tie at compile time" applied to a judgement rather than to a list.
 *
 * The pairs are Apple's and Google's own weather vocabularies, and both halves were checked
 * against `expo-symbols`' unions rather than assumed to exist (`EntryIcon`'s docblock records
 * why that matters: a name neither library has fails `tsc` instead of rendering an empty box
 * on a device). The two cloud levels take the distinction §10 built into the vocabulary
 * itself — `cloudy` is *some* cloud, so it draws sun behind cloud; `overcast` is solid grey,
 * so it draws cloud alone.
 */
const WEATHER_SYMBOLS: Record<Weather, PlatformSymbol> = {
  sunny: { ios: 'sun.max.fill', android: 'sunny' },
  cloudy: { ios: 'cloud.sun.fill', android: 'partly_cloudy_day' },
  overcast: { ios: 'cloud.fill', android: 'cloud' },
  rainy: { ios: 'cloud.rain.fill', android: 'rainy' },
  windy: { ios: 'wind', android: 'air' },
  foggy: { ios: 'cloud.fog.fill', android: 'foggy' },
};

export interface WeatherIconProps {
  weather: Weather;
  /** The ink the mark is drawn in — handed over by `OptionChips`, never chosen here. See
   * `EntryIcon`'s own prop for the full reason: a mark that kept its own colour would stay
   * `fg` on a selected chip's `action` ground and disappear on exactly the chip the diver
   * picked. */
  tintColor: ColorValue;
  /** Matched to the chip label's cap height, as `EntryIcon`'s is. */
  size?: number;
}

/**
 * A `Weather` value's symbol. The mechanism is `EntryIcon`'s and `SearchCapsule`'s, not a
 * third one: `SymbolView` with `name` built by `symbolName`, so iOS resolves an SF Symbol
 * and Android and the browser resolve Material Symbols' own equivalent.
 *
 * No `accessibilityLabel`: the chip around it already announces `` `${label}: ${displayLabel
 * (option)}` ``, and §0.6 makes the mark a supplement to a word that is always there, so
 * announcing it again would have a screen reader read "Weather: Sunny, sun max fill" for a
 * control offering one thing.
 *
 * Returns an element for every value rather than `null` for some, which is why there is no
 * `undefined` branch here and `EntryIcon` has one — see the record above.
 */
export function WeatherIcon({ weather, tintColor, size = 15 }: WeatherIconProps) {
  const symbol = WEATHER_SYMBOLS[weather];
  if (symbol === undefined) return null;
  return <SymbolView name={symbolName(symbol)} size={size} tintColor={tintColor} />;
}
