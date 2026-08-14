import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import { confirmPasswordReset } from '@/constants/api';
import { Spacing } from '@/constants/theme';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';

function getPasswordPolicyError(password: string) {
  const value = password.trim();
  if (value.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Z]/.test(value)) return 'Password must include at least one uppercase letter.';
  if (!/[a-z]/.test(value)) return 'Password must include at least one lowercase letter.';
  if (!/\d/.test(value)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must include at least one special character.';
  return '';
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const initialEmail = useMemo(() => {
    const value = Array.isArray(params.email) ? params.email[0] : params.email;
    return value || '';
  }, [params.email]);

  const [email, setEmail] = useState(initialEmail);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function handleResetPassword() {
    const trimmedEmail = email.trim();
    const trimmedCode = resetCode.trim();
    const passwordError = getPasswordPolicyError(newPassword);

    if (!trimmedEmail || !trimmedCode || !newPassword.trim()) {
      setMessage('Fill in the email, reset code, and new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('Passwords must match.');
      return;
    }
    if (passwordError) {
      setMessage(passwordError);
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const response = await confirmPasswordReset({
        email: trimmedEmail,
        resetCode: trimmedCode,
        password: newPassword,
      });
      setMessage(response.message || 'Password reset successful.');
      router.replace({
        pathname: '/auth',
        params: { mode: 'login', email: trimmedEmail },
      });
    } catch (err) {
      setMessage(err instanceof Error && err.message ? err.message : 'Unable to reset password right now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <StackScreenShell>
      <Pressable onPress={() => router.push('/forgot-password')} style={styles.backBtn} hitSlop={10}>
        <ThemedText type="smallBold">Back</ThemedText>
      </Pressable>
      <ThemedText type="subtitle">Enter Code and New Password</ThemedText>
      <ThemedText type="small">Use the reset code from your email to set your new password.</ThemedText>

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

      <ThemedText type="small" style={styles.label}>Reset code</ThemedText>
      <TextInput
        style={styles.input}
        placeholder="Enter reset code"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        value={resetCode}
        onChangeText={setResetCode}
      />

      <ThemedText type="small" style={styles.label}>New password</ThemedText>
      <TextInput
        style={styles.input}
        placeholder="Enter new password"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        secureTextEntry
        value={newPassword}
        onChangeText={setNewPassword}
      />

      <ThemedText type="small" style={styles.label}>Confirm new password</ThemedText>
      <TextInput
        style={styles.input}
        placeholder="Confirm new password"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        secureTextEntry
        value={confirmPassword}
        onChangeText={setConfirmPassword}
      />

      <Pressable style={styles.primaryBtn} onPress={handleResetPassword}>
        {busy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Reset my password</ThemedText>}
      </Pressable>

      {!!message ? <ThemedText type="small">{message}</ThemedText> : null}

      <View style={styles.helpBox}>
        <ThemedText type="smallBold">Password rules</ThemedText>
        <ThemedText type="small">At least 10 characters with uppercase, lowercase, number, and special character.</ThemedText>
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
  helpBox: {
    borderWidth: 1,
    borderColor: '#D6DFEA',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
    backgroundColor: '#FAFCFF',
  },
}
);