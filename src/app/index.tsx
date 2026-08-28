import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';

import { depthBand, depthColor } from '../theme/depth';
import { resolveScheme } from '../theme/resolve';

const SAMPLE_DEPTHS = [4.5, 9.2, 14.8, 24.6, 32.4, 44.0];

export default function Index() {
  const scheme = resolveScheme(useColorScheme());

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="p-5 gap-6">
      <View className="gap-1 pt-12">
        <Text className="font-mono text-[11px] tracking-[3px] text-fg-muted">M0 · SKELETON</Text>
        <Text className="font-sans-bold text-4xl tracking-[6px] text-fg">PONOR</Text>
        <Text className="font-sans text-base text-fg-muted">
          Following the system: {scheme}
        </Text>
      </View>

      <View className="gap-2">
        <Text className="font-mono text-[11px] tracking-[2px] text-fg-muted">DEPTH SCALE</Text>
        {SAMPLE_DEPTHS.map((metres) => (
          <View
            key={metres}
            className="flex-row items-center justify-between rounded-xl border border-border bg-surface px-4 py-3"
          >
            <Text className="font-sans-semibold text-base text-fg">Band {depthBand(metres)}</Text>
            <Text
              className="font-mono-semibold text-lg"
              style={{ color: depthColor(metres, scheme), fontVariant: ['tabular-nums'] }}
            >
              {metres.toFixed(1)} m
            </Text>
          </View>
        ))}
      </View>

      <View className="gap-2">
        <Text className="font-mono text-[11px] tracking-[2px] text-fg-muted">TYPE</Text>
        <Text className="font-sans text-lg text-fg">Archivo Regular — Příliš žluťoučký kůň</Text>
        <Text className="font-sans-medium text-lg text-fg">Archivo Medium — Příliš žluťoučký kůň</Text>
        <Text className="font-sans-semibold text-lg text-fg">Archivo SemiBold — Příliš žluťoučký kůň</Text>
        <Text className="font-sans-bold text-lg text-fg">Archivo Bold — Příliš žluťoučký kůň</Text>
        <Text className="font-mono text-base text-fg">IBM Plex Mono 32.4 m · 200 bar</Text>
        <Text className="font-mono-medium text-base text-fg">IBM Plex Mono Medium 44 min</Text>
        <Text className="font-mono-semibold text-base text-fg">IBM Plex Mono SemiBold 26 °C</Text>
      </View>

      <Pressable className="min-h-[48px] items-center justify-center rounded-xl bg-action px-5">
        <Text className="font-sans-bold text-base text-action-fg">Log a dive</Text>
      </Pressable>
    </ScrollView>
  );
}
