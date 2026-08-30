import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Share, StyleSheet, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import {
  acceptDonation,
  confirmDonationHandoff,
  declineDonation,
  exportDonationRecordsCsv,
  getDonations,
  type ApiDonation,
} from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';
const HANDOFF_QR_PREFIX = 'BRISIO_HANDOFF:';

function getDonationText(donation: ApiDonation, keys: string[], fallback = ''): string {
  const row = donation as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return String(value);
    }
  }
  return fallback;
}

function getDonationNumber(donation: ApiDonation, keys: string[], fallback = 0): number {
  const row = donation as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = row[key];
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return fallback;
}

export default function DonationInboxScreen() {
  const router = useRouter();
  const session = useSessionContext();

  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [donations, setDonations] = useState<ApiDonation[]>([]);
  const [tokenByDonationId, setTokenByDonationId] = useState<Record<string, string>>({});
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannerDonationId, setScannerDonationId] = useState('');
  const [hasScanned, setHasScanned] = useState(false);

  const postedCount = useMemo(
    () => donations.filter((d) => getDonationText(d, ['status']) === 'posted').length,
    [donations]
  );

  async function loadDonations() {
    if (!session.token) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const response = await getDonations(session.token);
      setDonations(response.donations || []);
    } catch (err) {
      setDonations([]);
      setErrorMessage(err instanceof Error ? err.message : 'Could not load donations.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!session.isAuthenticated || !session.token || session.user?.role !== 'organization') return;
    let active = true;
    (async () => {
      try {
        const response = await getDonations(session.token!);
        if (!active) return;
        setDonations(response.donations || []);
      } catch (err) {
        if (!active) return;
        setDonations([]);
        setErrorMessage(err instanceof Error ? err.message : 'Could not load donations.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [session.isAuthenticated, session.token, session.user?.role]);

  async function handleAccept(donationId: string) {
    if (!session.token) return;
    setBusyId(donationId);
    setStatusMessage('');
    setErrorMessage('');
    try {
      await acceptDonation(session.token, donationId);
      setStatusMessage('Donation accepted. Ask donor for handoff token when pickup occurs.');
      await loadDonations();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not accept donation.');
    } finally {
      setBusyId('');
    }
  }

  async function handleDecline(donationId: string) {
    if (!session.token) return;
    setBusyId(donationId);
    setStatusMessage('');
    setErrorMessage('');
    try {
      await declineDonation(session.token, donationId, 'Capacity unavailable at this time.');
      setStatusMessage('Donation declined.');
      await loadDonations();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not decline donation.');
    } finally {
      setBusyId('');
    }
  }

  async function handleConfirmHandoff(donation: ApiDonation) {
    if (!session.token) return;
    const donationId = getDonationText(donation, ['id']);
    const token = (tokenByDonationId[donationId] || '').trim();
    if (!token) {
      setErrorMessage('Enter the one-time handoff token from the donor.');
      return;
    }

    setBusyId(donationId);
    setStatusMessage('');
    setErrorMessage('');
    try {
      const quantity = getDonationNumber(donation, ['quantity']);
      const unit = getDonationText(donation, ['unit'], 'units');
      await confirmDonationHandoff(session.token, donationId, {
        handoffToken: token,
        receivedQuantity: quantity,
        receivedUnit: unit,
      });
      setStatusMessage('Pickup confirmed and recorded as received.');
      setTokenByDonationId((prev) => ({ ...prev, [donationId]: '' }));
      await loadDonations();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not confirm handoff.');
    } finally {
      setBusyId('');
    }
  }

  async function handleOpenScanner(donationId: string) {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        setErrorMessage('Camera permission is required to scan the handoff QR code.');
        return;
      }
    }
    setErrorMessage('');
    setHasScanned(false);
    setScannerDonationId(donationId);
  }

  function handleHandoffQrScanned({ data }: { data: string }) {
    if (hasScanned || !scannerDonationId) return;
    const token = data.startsWith(HANDOFF_QR_PREFIX) ? data.slice(HANDOFF_QR_PREFIX.length) : '';
    if (!token) {
      setErrorMessage('This is not a Brisio handoff QR code.');
      return;
    }
    setHasScanned(true);
    setTokenByDonationId((previous) => ({ ...previous, [scannerDonationId]: token }));
    setScannerDonationId('');
    setStatusMessage('Handoff QR scanned. Confirm the handoff when the quantity is correct.');
  }

  async function handleExportCsv() {
    if (!session.token) return;
    setLoading(true);
    setStatusMessage('');
    setErrorMessage('');
    try {
      const csv = await exportDonationRecordsCsv(session.token);
      if (Platform.OS === 'web') {
        const encoded = encodeURIComponent(csv);
        const href = `data:text/csv;charset=utf-8,${encoded}`;
        const webDoc = (globalThis as { document?: { createElement: (tag: string) => { href: string; download: string; click: () => void } } }).document;
        if (webDoc) {
          const anchor = webDoc.createElement('a');
          anchor.href = href;
          anchor.download = 'donation-records.csv';
          anchor.click();
        }
      } else {
        await Share.share({
          title: 'Donation records CSV',
          message: csv,
        });
      }
      setStatusMessage('Donation CSV export prepared.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not export donation records.');
    } finally {
      setLoading(false);
    }
  }

  if (!session.isAuthenticated || !session.token) {
    return (
      <StackScreenShell>
        <ThemedText type="subtitle">Donation Inbox</ThemedText>
        <ThemedText type="small">Sign in as a nonprofit account to manage incoming donation offers.</ThemedText>
        <Pressable style={styles.secondaryBtn} onPress={() => router.push('/auth?mode=login')}>
          <ThemedText type="smallBold">Sign in</ThemedText>
        </Pressable>
      </StackScreenShell>
    );
  }

  if (session.user?.role !== 'organization') {
    return (
      <StackScreenShell>
        <ThemedText type="subtitle">Donation Inbox</ThemedText>
        <ThemedText type="small">This inbox is available only for nonprofit accounts.</ThemedText>
        <Link href="/donate-inventory" asChild>
          <Pressable style={styles.secondaryBtn}>
            <ThemedText type="smallBold">Open donate inventory</ThemedText>
          </Pressable>
        </Link>
      </StackScreenShell>
    );
  }

  return (
    <StackScreenShell>
      <ThemedText type="subtitle">Donation Inbox</ThemedText>
      <ThemedText type="small">Review each offer, accept it, then scan the donor&apos;s QR code to confirm the handoff.</ThemedText>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <ThemedText type="small">Total</ThemedText>
          <ThemedText type="smallBold">{donations.length}</ThemedText>
        </View>
        <View style={styles.metricCard}>
          <ThemedText type="small">Awaiting review</ThemedText>
          <ThemedText type="smallBold">{postedCount}</ThemedText>
        </View>
      </View>

      <Pressable style={styles.secondaryBtn} onPress={loadDonations}>
        <ThemedText type="smallBold">Refresh inbox</ThemedText>
      </Pressable>
      <Pressable style={styles.secondaryBtn} onPress={handleExportCsv}>
        <ThemedText type="smallBold">Export assigned donations as CSV</ThemedText>
      </Pressable>

      {!!statusMessage ? <ThemedText type="small" style={styles.successText}>{statusMessage}</ThemedText> : null}
      {!!errorMessage ? <ThemedText type="small" style={styles.errorText}>{errorMessage}</ThemedText> : null}

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" />
          <ThemedText type="small">Loading donations...</ThemedText>
        </View>
      ) : donations.length === 0 ? (
        <View style={styles.card}>
          <ThemedText type="small">No donation records assigned yet.</ThemedText>
        </View>
      ) : (
        donations.map((donation) => {
          const donationId = getDonationText(donation, ['id']);
          const status = getDonationText(donation, ['status']);
          const productName = getDonationText(donation, ['productName', 'productname'], 'Unknown item');
          const quantity = getDonationNumber(donation, ['quantity']);
          const unit = getDonationText(donation, ['unit'], 'units');
          const condition = getDonationText(donation, ['conditionNotes', 'conditionnotes']);

          return (
            <View key={donationId} style={styles.card}>
              <ThemedText type="smallBold">{productName}</ThemedText>
              <ThemedText type="small">Status: {status}</ThemedText>
              <ThemedText type="small">Quantity: {quantity} {unit}</ThemedText>
              {!!condition ? <ThemedText type="small">Condition: {condition}</ThemedText> : null}

              {status === 'posted' ? (
                <View style={styles.actionRow}>
                  <Pressable
                    style={[styles.actionBtn, busyId === donationId && styles.actionBtnDisabled]}
                    onPress={() => handleAccept(donationId)}
                    disabled={busyId === donationId}>
                    <ThemedText type="smallBold">Accept</ThemedText>
                  </Pressable>
                  <Pressable
                    style={[styles.actionBtn, styles.declineBtn, busyId === donationId && styles.actionBtnDisabled]}
                    onPress={() => handleDecline(donationId)}
                    disabled={busyId === donationId}>
                    <ThemedText type="smallBold">Decline</ThemedText>
                  </Pressable>
                </View>
              ) : null}

              {status === 'accepted' ? (
                <>
                  {scannerDonationId === donationId ? (
                    <View style={styles.scannerCard}>
                      <CameraView
                        style={styles.camera}
                        facing="back"
                        onBarcodeScanned={hasScanned ? undefined : handleHandoffQrScanned}
                        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                      />
                      <Pressable style={styles.secondaryBtn} onPress={() => setScannerDonationId('')}>
                        <ThemedText type="smallBold">Cancel scan</ThemedText>
                      </Pressable>
                    </View>
                  ) : null}
                  <ThemedText type="small" style={styles.label}>Handoff token from donor</ThemedText>
                  <TextInput
                    style={styles.input}
                    value={tokenByDonationId[donationId] || ''}
                    onChangeText={(value) =>
                      setTokenByDonationId((prev) => ({
                        ...prev,
                        [donationId]: value,
                      }))
                    }
                    placeholder="Paste one-time token"
                    placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                    autoCapitalize="none"
                  />
                  <Pressable style={styles.secondaryBtn} onPress={() => handleOpenScanner(donationId)}>
                    <ThemedText type="smallBold">Scan QR code</ThemedText>
                  </Pressable>
                  <Pressable
                    style={[styles.actionBtn, busyId === donationId && styles.actionBtnDisabled]}
                    onPress={() => handleConfirmHandoff(donation)}
                    disabled={busyId === donationId}>
                    {busyId === donationId ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Confirm handoff</ThemedText>}
                  </Pressable>
                </>
              ) : null}
            </View>
          );
        })
      )}
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  metricsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  metricCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D6DFEA',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    backgroundColor: '#FAFCFF',
    gap: 2,
  },
  card: {
    borderWidth: 1,
    borderColor: '#D6DFEA',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    backgroundColor: '#FFFFFF',
    gap: 4,
  },
  scannerCard: {
    borderWidth: 1,
    borderColor: '#C9D8EC',
    borderRadius: Spacing.three,
    overflow: 'hidden',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
    backgroundColor: '#F3F8FF',
  },
  camera: {
    height: 260,
    width: '100%',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  secondaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderColor: '#CDD5E1',
    backgroundColor: '#F7F9FC',
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  actionBtn: {
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: '#C7D0DD',
    backgroundColor: '#EEF4FC',
  },
  declineBtn: {
    backgroundColor: '#FFF5F3',
    borderColor: '#E8B7AE',
  },
  actionBtnDisabled: {
    opacity: 0.6,
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
  label: {
    color: '#2A3A4F',
    fontWeight: '700',
    marginTop: 4,
  },
  successText: {
    color: '#1C6B47',
  },
  errorText: {
    color: '#B54840',
  },
});
