import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

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
    <>
      {/* DESIGN.md §7.5's triggers (cloud/syncTriggers.tsx). It draws nothing and is mounted
          HERE, below the migration gate above, rather than as a hook in this component: the
          early return means a hook would arm a sync against a database whose tables have not
          been created yet. */}
      <SyncTriggers />
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
    </>
  );
}
