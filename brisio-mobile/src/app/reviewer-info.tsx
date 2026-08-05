import { ScrollView, StyleSheet } from 'react-native';
import { Link } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export default function ReviewerInfoScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedView style={styles.container}>
        <Link href="/" asChild>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Link>
        <ThemedText type="subtitle">Reviewer Info</ThemedText>
        <ThemedText type="small">App name: Brisio</ThemedText>
        <ThemedText type="small">Bundle ID: com.brisio.app</ThemedText>
        <ThemedText type="small">Support email: support@brisio.app</ThemedText>
        <ThemedText type="small">
          App Review can use the supplied nonprofit account to create an account and view live listings.
        </ThemedText>
        <ThemedText type="small">
          Use the provided review account to test listing browsing, resource requests, reporting,
          and account deletion.
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