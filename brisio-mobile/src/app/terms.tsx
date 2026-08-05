import { ScrollView, StyleSheet } from 'react-native';
import { Link } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export default function TermsScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedView style={styles.container}>
        <Link href="/" asChild>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Link>
        <ThemedText type="subtitle">Terms of Service</ThemedText>
        <ThemedText type="small">
          Brisio is a community resource marketplace for businesses and nonprofits. You agree to
          use it responsibly and provide accurate information when posting listings or sending
          messages.
        </ThemedText>
        <ThemedText type="small">
          Do not post unlawful, misleading, harmful, or unauthorized content. Listings and messages
          may be moderated or removed if they violate these terms or applicable law.
        </ThemedText>
        <ThemedText type="small">
          You are responsible for your account security, and you may delete your account at any
          time from inside the app.
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