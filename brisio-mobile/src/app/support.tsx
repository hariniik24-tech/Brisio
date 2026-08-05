import { ScrollView, StyleSheet } from 'react-native';
import { Link } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export default function SupportScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedView style={styles.container}>
        <Link href="/" asChild>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Link>
        <ThemedText type="subtitle">Support</ThemedText>
        <ThemedText type="small">Contact: support@brisio.app</ThemedText>
        <ThemedText type="small">
          For App Review, use the supplied reviewer account to create an account and test both
          business and nonprofit flows.
        </ThemedText>
        <ThemedText type="small">
          If a feature requires location, allow it on device so nearby listings and distance-based
          matching can work correctly.
        </ThemedText>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    alignItems: 'center',
  },
  container: {
    width: '100%',
    maxWidth: MaxContentWidth,
    gap: Spacing.three,
  },
});