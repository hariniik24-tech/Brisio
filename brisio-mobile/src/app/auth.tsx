import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';

type AuthMode = 'login' | 'register';

function getPasswordPolicyError(password: string) {
  const value = password.trim();
  if (value.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Z]/.test(value)) return 'Password must include at least one uppercase letter.';
  if (!/[a-z]/.test(value)) return 'Password must include at least one lowercase letter.';
  if (!/\d/.test(value)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must include at least one special character.';
  return '';
}

function formatAddress(street: string, city: string, stateCode: string, zip: string) {
  return [street.trim(), city.trim(), stateCode.trim(), zip.trim()].filter(Boolean).join(', ');
}

export default function AuthScreen() {
  const router = useRouter();
  const session = useSessionContext();
  const params = useLocalSearchParams<{ mode?: string; email?: string }>();

  const modeParam = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const emailParam = Array.isArray(params.email) ? params.email[0] : params.email;

  const [mode, setMode] = useState<AuthMode>(() => (modeParam === 'login' ? 'login' : 'register'));
  const [email, setEmail] = useState(() => emailParam || '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'business' | 'organization'>('business');
  const [organizationName, setOrganizationName] = useState('');
  const [authStreet, setAuthStreet] = useState('');
  const [authCity, setAuthCity] = useState('');
  const [authState, setAuthState] = useState('');
  const [authZip, setAuthZip] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!session.isAuthenticated) return;
    router.replace('/');
  }, [router, session.isAuthenticated]);

  async function submitAuth() {
    if (session.busy) return;
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setFormError('Email and password are required.');
      return;
    }

    session.clearError();
    setFormError('');

    if (mode === 'login') {
      await session.signIn(trimmedEmail, trimmedPassword);
      return;
    }

    if (!name.trim()) {
      setFormError('Your name is required.');
      return;
    }

    if (!acceptedTerms) {
      setFormError('Please accept the Privacy Policy and Terms to continue.');
      return;
    }

    const passwordError = getPasswordPolicyError(password);
    if (passwordError) {
      setFormError(passwordError);
      return;
    }

    const missingLocation = !authStreet.trim() || !authCity.trim() || !authState.trim() || !authZip.trim();
    if (missingLocation) {
      setFormError('Street, city, state, and ZIP code are required.');
      return;
    }

    const location = formatAddress(authStreet, authCity, authState, authZip);
    await session.signUp({
      email: trimmedEmail,
      password,
      role,
      name: name.trim(),
      organizationName: organizationName.trim(),
      location,
    });
  }

  function openForgotPassword() {
    const query = email.trim() ? `?email=${encodeURIComponent(email.trim())}` : '';
    router.push(`/forgot-password${query}`);
  }

  return (
    <StackScreenShell>
      <Pressable onPress={() => router.push('/')} style={styles.backBtn} hitSlop={10}>
        <ThemedText type="smallBold">Back to Home</ThemedText>
      </Pressable>

      <ThemedText type="subtitle">{mode === 'register' ? 'Create account' : 'Sign in'}</ThemedText>
      <ThemedText type="small" style={styles.helperText}>
        {mode === 'register'
          ? 'Create your Brisio account to start sharing or requesting resources.'
          : 'Welcome back. Sign in to continue to your dashboard.'}
      </ThemedText>

      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeBtn, mode === 'register' && styles.modeBtnActive]}
          onPress={() => {
            setMode('register');
            setFormError('');
            session.clearError();
          }}>
          <ThemedText type="smallBold">Create account</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, mode === 'login' && styles.modeBtnActive]}
          onPress={() => {
            setMode('login');
            setFormError('');
            session.clearError();
          }}>
          <ThemedText type="smallBold">Sign in</ThemedText>
        </Pressable>
      </View>

      <ThemedText type="small" style={styles.inputLabel}>Email</ThemedText>
      <TextInput
        style={styles.input}
        placeholder="name@email.com"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <ThemedText type="small" style={styles.inputLabel}>Password</ThemedText>
      <TextInput
        style={styles.input}
        placeholder="Enter your password"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {mode === 'register' ? (
        <ThemedText type="small" style={styles.helperText}>
          Password must be at least 10 characters and include uppercase, lowercase, number, and special character.
        </ThemedText>
      ) : null}

      {mode === 'register' ? (
        <>
          <ThemedText type="small" style={styles.inputLabel}>Your name</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
            value={name}
            onChangeText={setName}
          />

          <ThemedText type="small" style={styles.inputLabel}>Organization name</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Nonprofit or business name"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
            value={organizationName}
            onChangeText={setOrganizationName}
          />

          <ThemedText type="small" style={styles.inputLabel}>Street address</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="123 Main St"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
            value={authStreet}
            onChangeText={setAuthStreet}
          />

          <ThemedText type="small" style={styles.inputLabel}>City</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="City"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
            value={authCity}
            onChangeText={setAuthCity}
          />

          <ThemedText type="small" style={styles.inputLabel}>State</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="State"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
            value={authState}
            onChangeText={setAuthState}
          />

          <ThemedText type="small" style={styles.inputLabel}>ZIP code</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="ZIP code"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
            value={authZip}
            onChangeText={setAuthZip}
          />

          <View style={styles.modeRow}>
            <Pressable
              style={[styles.modeBtn, role === 'business' && styles.modeBtnActive]}
              onPress={() => setRole('business')}>
              <ThemedText type="smallBold">Business</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.modeBtn, role === 'organization' && styles.modeBtnActive]}
              onPress={() => setRole('organization')}>
              <ThemedText type="smallBold">Nonprofit</ThemedText>
            </Pressable>
          </View>

          <Pressable
            style={[styles.checkboxRow, acceptedTerms && styles.checkboxRowActive]}
            onPress={() => setAcceptedTerms((prev) => !prev)}>
            <ThemedText type="smallBold" style={styles.checkboxIndicator}>
              {acceptedTerms ? '☑' : '☐'}
            </ThemedText>
            <ThemedText type="small" style={styles.checkboxText}>
              I agree to the Privacy Policy and Terms of Service.
            </ThemedText>
          </Pressable>

          <View style={styles.inlineLinkRow}>
            <Pressable onPress={() => router.push('/privacy-policy')}>
              <ThemedText type="smallBold" style={styles.inlineLinkText}>Privacy Policy</ThemedText>
            </Pressable>
            <Pressable onPress={() => router.push('/terms')}>
              <ThemedText type="smallBold" style={styles.inlineLinkText}>Terms of Service</ThemedText>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Pressable style={styles.forgotLinkBtn} onPress={openForgotPassword}>
            <ThemedText type="smallBold" style={styles.inlineLinkText}>Forgot password?</ThemedText>
          </Pressable>
        </>
      )}

      <Pressable style={styles.primaryBtn} onPress={submitAuth}>
        {session.busy ? (
          <ActivityIndicator size="small" />
        ) : (
          <ThemedText type="smallBold">{mode === 'register' ? 'Create my account' : 'Continue to dashboard'}</ThemedText>
        )}
      </Pressable>

      {!!formError ? <ThemedText style={styles.errorText}>{formError}</ThemedText> : null}
      {!!session.error ? <ThemedText style={styles.errorText}>{session.error}</ThemedText> : null}
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    alignSelf: 'flex-start',
  },
  helperText: {
    color: '#3A4A60',
  },
  modeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  modeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CFD9E6',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    backgroundColor: '#F7FAFF',
  },
  modeBtnActive: {
    backgroundColor: '#D9EAFD',
    borderColor: '#6A8EBB',
  },
  inputLabel: {
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#D6DFEA',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: '#FAFCFF',
  },
  checkboxRowActive: {
    borderColor: '#6A8EBB',
    backgroundColor: '#ECF4FD',
  },
  checkboxIndicator: {
    minWidth: 22,
  },
  checkboxText: {
    flex: 1,
  },
  inlineLinkRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    flexWrap: 'wrap',
  },
  inlineLinkText: {
    color: '#2E5E96',
    textDecorationLine: 'underline',
  },
  forgotLinkBtn: {
    alignSelf: 'flex-start',
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
  errorText: {
    color: '#B54840',
  },
});
