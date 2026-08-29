import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { useMigrations } from '../db/client';
import { resolveScheme, themeFor } from '../theme/resolve';

export default function RootLayout() {
  const scheme = resolveScheme(useColorScheme());
  const theme = themeFor(scheme);

  const { success, error } = useMigrations();
  if (error) throw error;
  if (!success) return null;

  return (
    <>
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
