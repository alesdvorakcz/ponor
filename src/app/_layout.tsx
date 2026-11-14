import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthLinks } from '../cloud/AuthLinks';
import { SyncTriggers } from '../cloud/syncTriggers';
import { useMigrations } from '../db/client';
import { LanguageSync } from '../i18n/LanguageSync';
import { resolveScheme, themeFor } from '../theme/resolve';

export default function RootLayout() {
  const scheme = resolveScheme(useColorScheme());
  const theme = themeFor(scheme);

  const { success, error } = useMigrations();
  if (error) throw error;
  if (!success) return null;

  return (
    /* **The app's one gesture root** (react-native-gesture-handler), and it is not optional:
       `GestureDetector` throws outright in a development build when nothing above it provides
       this context, so the dive detail's profile card — Ponor's first gesture — would take the
       screen down without it. The library's own installation guide asks for it "as close to the
       actual root of the app as possible", which under expo-router is this file.

       A nested root inside the same native view hierarchy is ignored in favour of this one, so
       adding one there buys nothing. The exception, if the app ever needs it, is a gesture
       inside React Native's `<Modal>`: that renders into a SEPARATE native hierarchy while
       staying in the same React context, so a root nested there degrades to a plain `View` and
       the gesture inside it never fires — which is precisely when a second root IS required.
       The app's one `Modal` today, the dive detail's record-actions sheet (issue #3), holds only
       `Pressable`s, which are React Native's own and need no root — so this is a note for
       whoever puts the first gesture in one rather than a rule anything here follows.

       No `style` prop, deliberately: with none it defaults to `flex: 1`, and the library warns
       that a custom style which forgets that renders an app of zero height. `SyncTriggers` and
       `LanguageSync` draw nothing and sit inside it rather than beside it, which keeps this
       component's tree a single element and the fragment unnecessary. */
    <GestureHandlerRootView>
      {/* DESIGN.md §7.5's triggers (cloud/syncTriggers.tsx). It draws nothing and is mounted
          HERE, below the migration gate above, rather than as a hook in this component: the
          early return means a hook would arm a sync against a database whose tables have not
          been created yet. */}
      <SyncTriggers />
      {/* The links in the confirmation and reset mails (cloud/AuthLinks.tsx). Draws nothing;
          below the migration gate for `SyncTriggers`' reason — a link that signs in adopts
          this phone's dives, which needs the tables to exist. */}
      <AuthLinks />
      {/* §3's language setting, applied (src/i18n/LanguageSync.tsx). Below the migration gate
          for `SyncTriggers`' own reason: it reads the `settings` table, and the tables do not
          exist until the migrations above have run. */}
      <LanguageSync />
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.bg },
        }}
      />
    </GestureHandlerRootView>
  );
}
