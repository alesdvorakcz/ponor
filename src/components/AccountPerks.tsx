import { SymbolView } from 'expo-symbols';
import { Text, View } from 'react-native';

import { t, type TranslationKey } from '../i18n';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { symbolName, type PlatformSymbol } from './symbolName';

/**
 * The three things an account adds (issue #24, §1's "back up, sync a second device, and contribute
 * named sites"), in the one order every place that names them uses: a backup, the logbook on other
 * devices, and sites and centres shared with other divers.
 *
 * Exported for `symbolName.test.tsx`, which is where the Android half — the browser's half too —
 * is checked against a real Material name.
 */
export const ACCOUNT_PERK_GLYPHS: readonly [PlatformSymbol, PlatformSymbol, PlatformSymbol] = [
  { ios: 'icloud.and.arrow.up', android: 'backup' },
  { ios: 'ipad.and.iphone', android: 'devices' },
  // The community is the shared catalogue, and the catalogue is what the map draws — the Map
  // tab's own subject, so its glyph rather than a crowd of people.
  { ios: 'map', android: 'map' },
];

const [BACKUP_GLYPH, DEVICES_GLYPH, COMMUNITY_GLYPH] = ACCOUNT_PERK_GLYPHS;

/** Each perk at its two lengths — a word for the offer card, a sentence for the account screen —
 * with its glyph. */
const PERKS: readonly { word: TranslationKey; sentence: TranslationKey; glyph: PlatformSymbol }[] = [
  { word: 'accountPerks.backupWord', sentence: 'accountPerks.backup', glyph: BACKUP_GLYPH },
  { word: 'accountPerks.devicesWord', sentence: 'accountPerks.devices', glyph: DEVICES_GLYPH },
  { word: 'accountPerks.communityWord', sentence: 'accountPerks.community', glyph: COMMUNITY_GLYPH },
];

const GLYPH_SIZE = 18;

interface AccountPerksProps {
  scheme: ColorScheme;
  /** `words` — one row on the offer card, wrapping in Czech; `sentences` — one to a line, the
   * account screen's head. Same three, same order, same glyphs. */
  variant: 'words' | 'sentences';
}

/**
 * What an account adds, said once for the app: the offer card (the empty logbook and Settings)
 * and the account screen it opens draw this one list, so the offer and the place it leads can
 * never say two different things.
 *
 * Monochrome, like every control and glyph in Ponor (§0.1): the glyphs take the text's own ink.
 * Each glyph is hidden from a screen reader — the words beside it carry everything it says.
 */
export function AccountPerks({ scheme, variant }: AccountPerksProps) {
  const styles = makeStyles(scheme);
  const ink = themeFor(scheme).fg;
  const words = variant === 'words';
  return (
    <View style={words ? styles.accountPerkWords : styles.accountPerkList}>
      {PERKS.map((perk) => (
        <View key={perk.word} style={words ? styles.accountPerkWord : styles.accountPerkSentence}>
          <SymbolView
            name={symbolName(perk.glyph)}
            size={GLYPH_SIZE}
            tintColor={ink}
            accessible={false}
          />
          <Text style={words ? styles.accountPerkWordLabel : styles.accountPerkSentenceLabel}>
            {t(words ? perk.word : perk.sentence)}
          </Text>
        </View>
      ))}
    </View>
  );
}
