import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import { deleteUserAccount } from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const session = useSessionContext();
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function handleDelete() {
    if (!session.token) return;
    if (confirmText.trim().toLowerCase() !== 'delete account') {
      setMessage('Type DELETE ACCOUNT to confirm.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      await deleteUserAccount(session.token);
      await session.signOut();
      setMessage('Your account was deleted.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <StackScreenShell>
        <Pressable onPress={() => router.push('/')} style={styles.backBtn} hitSlop={10}>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Delete Account</ThemedText>
        <ThemedText type="small">
          This action permanently removes your account, your listings, sessions, and related
          engagement data from Brisio.
        </ThemedText>
        <ThemedText type="small">
          To confirm, type DELETE ACCOUNT below and tap the delete button.
        </ThemedText>
        <TextInput
          style={styles.input}
          value={confirmText}
          onChangeText={setConfirmText}
          placeholder="DELETE ACCOUNT"
          autoCapitalize="characters"
        />
        <Pressable style={styles.deleteBtn} onPress={handleDelete} hitSlop={12}>
          {busy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Delete my account</ThemedText>}
        </Pressable>
        {!!message && <ThemedText type="small">{message}</ThemedText>}
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    alignSelf: 'flex-start',
  },
  input: {
    borderWidth: 1,
    borderColor: '#C7D0DD',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
    backgroundColor: '#FFFFFF',
  },
  deleteBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: '#CF807A',
    backgroundColor: '#F9E5E3',
  },
});