import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import { getDonationAcknowledgment, type ApiDonationAcknowledgment } from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';
import { buildDonationAcknowledgmentHtml } from '@/utils/donation-acknowledgment';

export default function DonationAcknowledgmentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ donationId?: string }>();
  const session = useSessionContext();
  const donationId = String(params.donationId || '').trim();
  const [receipt, setReceipt] = useState<ApiDonationAcknowledgment | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!session.token || !donationId) {
      return;
    }
    let active = true;
    getDonationAcknowledgment(session.token, donationId)
      .then((response) => {
        if (active) setReceipt(response.acknowledgment);
      })
      .catch((error) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Could not load the acknowledgment.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [donationId, session.token]);

  async function handlePdf() {
    if (!receipt) return;
    setSharing(true);
    setErrorMessage('');
    try {
      const html = buildDonationAcknowledgmentHtml(receipt);
      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
      } else {
        const file = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            UTI: 'com.adobe.pdf',
            mimeType: 'application/pdf',
            dialogTitle: 'Share donation acknowledgment',
          });
        } else {
          await Print.printAsync({ html });
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not prepare the PDF.');
    } finally {
      setSharing(false);
    }
  }

  if (!session.isAuthenticated || !session.token) {
    return (
      <StackScreenShell>
        <ThemedText type="subtitle">Donation acknowledgment</ThemedText>
        <ThemedText type="small">Sign in to access this record.</ThemedText>
      </StackScreenShell>
    );
  }

  if (!donationId) {
    return (
      <StackScreenShell>
        <ThemedText type="subtitle">Donation acknowledgment</ThemedText>
        <ThemedText type="small" style={styles.errorText}>No donation record was selected.</ThemedText>
      </StackScreenShell>
    );
  }

  return (
    <StackScreenShell>
      <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
        <ThemedText type="smallBold">Back</ThemedText>
      </Pressable>
      <ThemedText type="subtitle">Donation acknowledgment</ThemedText>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" />
          <ThemedText type="small">Loading acknowledgment...</ThemedText>
        </View>
      ) : errorMessage ? (
        <ThemedText type="small" style={styles.errorText}>{errorMessage}</ThemedText>
      ) : receipt ? (
        <>
          <View style={styles.card}>
            <ThemedText type="smallBold">{receipt.acknowledgmentId}</ThemedText>
            <ThemedText type="small">Donor: {receipt.donor.name}</ThemedText>
            <ThemedText type="small">Recipient: {receipt.recipient.name}</ThemedText>
            <ThemedText type="small">Item: {receipt.item.name}</ThemedText>
            <ThemedText type="small">Received: {receipt.item.quantity} {receipt.item.unit}</ThemedText>
            <ThemedText type="small">Date: {new Date(receipt.receivedAt).toLocaleString()}</ThemedText>
          </View>
          <ThemedText type="small" style={styles.notice}>
            This document records the confirmed transfer. It does not determine tax eligibility or the deductible amount.
          </ThemedText>
          <Pressable style={[styles.primaryBtn, sharing && styles.disabled]} onPress={handlePdf} disabled={sharing}>
            {sharing ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Download or share PDF</ThemedText>}
          </Pressable>
        </>
      ) : null}
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: {
    borderWidth: 1,
    borderColor: '#D6DFEA',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    backgroundColor: '#FFFFFF',
    gap: 5,
  },
  primaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderColor: '#476C9D',
    backgroundColor: '#CFE1F8',
  },
  secondaryBtn: {
    alignSelf: 'flex-start',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: '#CDD5E1',
    backgroundColor: '#F7F9FC',
  },
  disabled: { opacity: 0.6 },
  notice: { color: '#52616E' },
  errorText: { color: '#A23B31' },
});