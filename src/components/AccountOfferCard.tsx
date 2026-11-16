import { Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { AccountPerks } from './AccountPerks';

interface AccountOfferCardProps {
  scheme: ColorScheme;
  /** Opens the account screen. The caller owns the route, as every caller of a button here does. */
  onPress: () => void;
}

/**
 * **The account offer** (issue #24) — one card, drawn in two places while nobody is signed in:
 * under *Log your first dive* on the empty logbook, and at the top of Settings. Whether it shows
 * at all is `useAccountOffer`'s to say, never this component's.
 *
 * **What it says, in the order the owner asked for it** (2026-11-16): that Ponor is better with an
 * account, that the account is optional and the app works fully without one, and what it adds.
 * The title promises no backup on purpose — on the first-run screen there is nothing to back up
 * yet, and *Back up with an account* was turned down for saying so.
 *
 * **Its button is outlined, never filled** (`secondaryAction`'s treatment, a size down). On the
 * empty logbook the inverted fill belongs to *Log your first dive*, directly above, and logging
 * must stay the loudest thing on that screen. The label covers both divers who meet it: one who
 * wants an account, and one who already has one — on a new phone, or after signing out, the empty
 * logbook is the screen they see, and this is their way back to their dives.
 *
 * Nothing to dismiss: §1 makes the account optional, so the card simply stands while the diver is
 * a guest, and signing in is what takes it away.
 */
export function AccountOfferCard({ scheme, onPress }: AccountOfferCardProps) {
  const styles = makeStyles(scheme);
  return (
    <View style={styles.accountOfferCard}>
      <View style={styles.accountOfferHead}>
        <Text style={styles.accountOfferTitle}>{t('accountOffer.title')}</Text>
        <Text style={styles.accountOfferLine}>{t('accountOffer.optional')}</Text>
      </View>
      <AccountPerks scheme={scheme} variant="words" />
      <Pressable
        style={styles.accountOfferButton}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('accountOffer.action')}
      >
        <Text style={styles.accountOfferButtonLabel}>{t('accountOffer.action')}</Text>
      </Pressable>
    </View>
  );
}

/**
 * *or*, between *Log your first dive* and the card: two hairlines and a muted word. It says the
 * two are alternatives — log now, or make the logbook an account's first — which air alone would
 * not, and it is what keeps the card off the teaching block above (the owner's call, 2026-11-16).
 */
export function OrRule({ scheme }: { scheme: ColorScheme }) {
  const styles = makeStyles(scheme);
  return (
    <View style={styles.orRule} accessible={false}>
      <View style={styles.orRuleLine} />
      <Text style={styles.orRuleLabel}>{t('accountOffer.or')}</Text>
      <View style={styles.orRuleLine} />
    </View>
  );
}
