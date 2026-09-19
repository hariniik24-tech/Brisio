import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import { createListing } from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';

function capitalizeWords(value: string) {
  return value.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export default function CreateListingScreen() {
  const router = useRouter();
  const session = useSessionContext();
  const submittingRef = useRef(false);
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [deliverWithinHours, setDeliverWithinHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submitListing() {
    if (!session.token || !session.user || submittingRef.current) return;
    if (!category.trim() || !description.trim()) {
      setError('Category and description are required.');
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    setError('');
    try {
      await createListing(session.token, {
        category: category.trim().toLowerCase(),
        description: description.trim(),
        contact: contact.trim(),
        location: session.user.location,
        ...(session.user.role === 'business' && deliverWithinHours.trim()
          ? { deliverWithinHours: deliverWithinHours.trim() }
          : {}),
      });
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create listing.');
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  if (!session.isAuthenticated || !session.user) {
    return (
      <StackScreenShell>
        <Pressable onPress={() => router.replace('/')} style={styles.backBtn} hitSlop={10}>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Create listing</ThemedText>
        <ThemedText type="small">Sign in before creating a listing.</ThemedText>
      </StackScreenShell>
    );
  }

  return (
    <StackScreenShell>
      <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
        <ThemedText type="smallBold">Back</ThemedText>
      </Pressable>

      <ThemedText type="subtitle">Create listing</ThemedText>
      <ThemedText type="small" style={styles.helperText}>
        Share what is available or describe what your organization needs.
      </ThemedText>

      <ThemedText type="smallBold">Category</ThemedText>
      <TextInput
        accessibilityLabel="Listing category"
        style={styles.input}
        placeholder="Food, equipment, space, service..."
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        autoCapitalize="words"
        value={category}
        onChangeText={(value) => setCategory(capitalizeWords(value))}
      />

      <ThemedText type="smallBold">Description</ThemedText>
      <TextInput
        accessibilityLabel="Listing description"
        style={[styles.input, styles.multilineInput]}
        placeholder="Add the details someone needs to respond"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        multiline
        value={description}
        onChangeText={setDescription}
      />

      <ThemedText type="smallBold">Contact</ThemedText>
      <TextInput
        accessibilityLabel="Listing contact"
        style={styles.input}
        placeholder="Email or phone number"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        value={contact}
        onChangeText={setContact}
      />

      {session.user.role === 'business' ? (
        <>
          <ThemedText type="smallBold">Delivery timing</ThemedText>
          <TextInput
            accessibilityLabel="Delivery time in hours"
            style={styles.input}
            placeholder="Deliver within hours (optional)"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
            keyboardType="numeric"
            value={deliverWithinHours}
            onChangeText={setDeliverWithinHours}
          />
        </>
      ) : null}

      <ThemedText type="small" style={styles.helperText}>
        Your account location will be attached to this listing.
      </ThemedText>

      {!!error && <ThemedText style={styles.errorText}>{error}</ThemedText>}

      <Pressable
        accessibilityRole="button"
        style={[styles.primaryBtn, busy && styles.disabledBtn]}
        onPress={submitListing}
        disabled={busy}>
        {busy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Publish listing</ThemedText>}
      </Pressable>
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    alignSelf: 'flex-start',
  },
  helperText: {
    color: '#5B6778',
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: '#C3CDDB',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 14,
    backgroundColor: '#FFFFFF',
    color: '#1C2735',
  },
  multilineInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderColor: '#476C9D',
    backgroundColor: '#CFE1F8',
  },
  disabledBtn: {
    opacity: 0.55,
  },
  errorText: {
    color: '#B54840',
  },
});