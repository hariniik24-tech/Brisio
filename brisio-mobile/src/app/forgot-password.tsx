import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { requestPasswordReset } from '@/constants/api';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const initialEmail = useMemo(() => {
    const value = Array.isArray(params.email) ? params.email[0] : params.email;
    return value || '';
  }, [params.email]);

  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [canContinue, setCanContinue] = useState(false);

  async function handleSendCode() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setMessage('Enter your email to continue.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const response = await requestPasswordReset({ email: trimmedEmail });
      setMessage(response.message || 'If the email exists, a reset code has been sent.');
      setCanContinue(true);
    } catch {
      setMessage('If the email exists, a reset code has been sent.');
      setCanContinue(true);
    } finally {
      setBusy(false);
    }
  }

  function continueToReset() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setMessage('Enter your email to continue.');
      return;
    }
    router.push({
      pathname: '/reset-password',
      params: { email: trimmedEmail },
    });
  }

  return (
    <StackScreenShell>
        <Pressable onPress={() => router.push('/')} style={styles.backBtn} hitSlop={10}>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Reset Password</ThemedText>
        <ThemedText type="small">
          Enter your email and we will send you a reset code.
        </ThemedText>

        <ThemedText type="small" style={styles.label}>Email</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="name@email.com"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <Pressable style={styles.secondaryBtn} onPress={handleSendCode}>
          {busy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Send reset code</ThemedText>}
        </Pressable>

        <Pressable
          style={[styles.primaryBtn, !canContinue && styles.primaryBtnDisabled]}
          onPress={continueToReset}
          disabled={!canContinue}>
          <ThemedText type="smallBold">Continue to code entry</ThemedText>
        </Pressable>

        {!!message ? <ThemedText type="small">{message}</ThemedText> : null}

        <View style={styles.helpBox}>
          <ThemedText type="smallBold">How it works</ThemedText>
          <ThemedText type="small">
            1. Enter your email and send a reset code.
          </ThemedText>
          <ThemedText type="small">
            2. Check your email for the reset code.
          </ThemedText>
          <ThemedText type="small">
            3. Continue to the next screen and set a new password.
          </ThemedText>
        </View>
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    alignSelf: 'flex-start',
  },
  label: {
    color: '#2A3A4F',
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#C3CDDB',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#FFFFFF',
    color: '#1C2735',
  },
  primaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderColor: '#476C9D',
    backgroundColor: '#CFE1F8',
    marginTop: Spacing.one,
  },
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  secondaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderColor: '#CDD5E1',
    backgroundColor: '#F7F9FC',
  },
  helpBox: {
    borderWidth: 1,
    borderColor: '#D6DFEA',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
    backgroundColor: '#FAFCFF',
  },
});