import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';

import { createDive, listDives } from '../db/dives';
import { db } from '../db/client';
import { depthBand, depthColor } from '../theme/depth';
import { resolveScheme } from '../theme/resolve';
import { makeStyles } from '../theme/styles';

const SAMPLE_DEPTHS = [4.5, 9.2, 14.8, 24.6, 32.4, 44.0];

export default function Index() {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);

  const [count, setCount] = useState<number | null>(null);
  const refresh = () => listDives(db).then((d) => setCount(d.length));
  useEffect(() => { refresh(); }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>M0 · SKELETON</Text>
        <Text style={styles.wordmark}>PONOR</Text>
        <Text style={styles.subtitle}>Following the system: {scheme}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>DEPTH SCALE</Text>
        {SAMPLE_DEPTHS.map((metres) => (
          <View key={metres} style={styles.depthRow}>
            <Text style={styles.depthBandLabel}>Band {depthBand(metres)}</Text>
            <Text style={[styles.depthValue, { color: depthColor(metres, scheme) }]}>
              {metres.toFixed(1)} m
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>TYPE</Text>
        <Text style={styles.typeSans}>Archivo Regular — Příliš žluťoučký kůň</Text>
        <Text style={styles.typeSansMedium}>Archivo Medium — Příliš žluťoučký kůň</Text>
        <Text style={styles.typeSansSemibold}>Archivo SemiBold — Příliš žluťoučký kůň</Text>
        <Text style={styles.typeSansBold}>Archivo Bold — Příliš žluťoučký kůň</Text>
        <Text style={styles.typeMono}>IBM Plex Mono 32.4 m · 200 bar</Text>
        <Text style={styles.typeMonoMedium}>IBM Plex Mono Medium 44 min</Text>
        <Text style={styles.typeMonoSemibold}>IBM Plex Mono SemiBold 26 °C</Text>
      </View>

      <Pressable
        style={styles.action}
        onPress={() => createDive(db, { date: new Date().toISOString().slice(0, 10) }).then(refresh)}
      >
        <Text style={styles.actionLabel}>
          {count === null ? 'Log a dive' : `Log a dive · ${count} saved`}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
