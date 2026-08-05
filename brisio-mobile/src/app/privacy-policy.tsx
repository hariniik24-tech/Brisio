import { ScrollView, StyleSheet } from 'react-native';
import { Link } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export default function PrivacyPolicyScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedView style={styles.container}>
        <Link href="/" asChild>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Link>
        <ThemedText type="subtitle">Privacy Policy</ThemedText>
        <ThemedText type="small">
          Brisio collects the information needed to create accounts, manage listings, coordinate
          requests, and support review and moderation workflows.
        </ThemedText>
        <ThemedText type="small">
          We may collect email address, display name, organization name, location, listing content,
          messages, report submissions, and basic device/app usage needed for the service.
        </ThemedText>
        <ThemedText type="small">
          Location is used to help find nearby resources and improve matching. You can control
          location permissions from your device settings.
        </ThemedText>
        <ThemedText type="small">
          Data is stored in the Brisio backend database and used to operate the platform, prevent
          abuse, and display active listings and engagement history.
        </ThemedText>
        <ThemedText type="small">
          Users can delete their account from inside the app on the Delete Account page. This will
          remove the account and associated listings, sessions, and related engagement data.
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