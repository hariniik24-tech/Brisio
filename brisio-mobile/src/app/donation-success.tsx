import { Pressable, StyleSheet, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export default function DonationSuccessScreen() {
  const params = useLocalSearchParams<{ donationId?: string }>();
  const donationId = String(params.donationId || '').trim();

  return (
    <StackScreenShell>
      <ThemedText type="subtitle">Donation Recorded</ThemedText>
      <ThemedText type="small">Your donation entry has been created and assigned to a nonprofit recipient.</ThemedText>

      <View style={styles.card}>
        <ThemedText type="smallBold">Record ID</ThemedText>
        <ThemedText type="small">{donationId || 'Unavailable'}</ThemedText>
        <ThemedText type="small">Status: posted</ThemedText>
      </View>

      <Link href="/donate-inventory" asChild>
        <Pressable style={styles.primaryBtn}>
          <ThemedText type="smallBold">Create another donation</ThemedText>
        </Pressable>
      </Link>

      <Link href="/(tabs)" asChild>
        <Pressable style={styles.secondaryBtn}>
          <ThemedText type="smallBold">Back to home</ThemedText>
        </Pressable>
      </Link>
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#D6DFEA',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: 4,
    backgroundColor: '#FAFCFF',
  },
  primaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderColor: '#476C9D',
    backgroundColor: '#CFE1F8',
  },
  secondaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderColor: '#CDD5E1',
    backgroundColor: '#F7F9FC',
  },
});
