import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export default function SupportScreen() {
  const router = useRouter();

  async function callSupport() {
    const url = 'tel:5315419424';
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  }

  async function emailSupport() {
    const subject = encodeURIComponent('Brisio support request');
    const body = encodeURIComponent('Hi, I need help with Brisio.');
    const url = `mailto:brisiohelp@gmail.com?subject=${subject}&body=${body}`;
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  }

  return (
    <StackScreenShell>
        <Pressable onPress={() => router.push('/')} style={styles.backBtn} hitSlop={10}>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Support</ThemedText>
        <ThemedText type="small">Need help? Contact support directly:</ThemedText>
        <Pressable onPress={callSupport} style={styles.inlineContact} hitSlop={12}>
          <Text style={styles.inlineContactText}>Phone: 531-541-9424</Text>
        </Pressable>
        <Pressable onPress={emailSupport} style={styles.inlineContact} hitSlop={12}>
          <Text style={styles.inlineContactText}>Email: brisiohelp@gmail.com</Text>
        </Pressable>
        <View style={styles.contactRow}>
          <Pressable style={styles.contactBtn} onPress={callSupport} hitSlop={12}>
            <ThemedText type="smallBold">Call 531-541-9424</ThemedText>
          </Pressable>
          <Pressable style={styles.contactBtn} onPress={emailSupport} hitSlop={12}>
            <ThemedText type="smallBold">Email brisiohelp@gmail.com</ThemedText>
          </Pressable>
        </View>
        <ThemedText type="small">
          If a feature requires location, allow it on device so nearby listings and distance-based
          matching can work correctly.
        </ThemedText>
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  contactRow: {
    gap: Spacing.two,
  },
  inlineContact: {
    alignSelf: 'flex-start',
  },
  inlineContactText: {
    color: '#2E5E96',
    textDecorationLine: 'underline',
  },
  backBtn: {
    alignSelf: 'flex-start',
  },
  contactBtn: {
    borderWidth: 1,
    borderColor: '#CFD9E6',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: '#F8FBFF',
  },
});