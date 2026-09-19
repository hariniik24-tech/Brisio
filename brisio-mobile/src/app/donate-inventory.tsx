import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import {
  exportDonationRecordsCsv,
  generateDonationHandoffToken,
  getDonationImpactSummary,
  getDonations,
  type ApiDonation,
} from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';

const HANDOFF_QR_PREFIX = 'BRISIO_HANDOFF:';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function DonateInventoryScreen() {
  const router = useRouter();
  const session = useSessionContext();
  const [records, setRecords] = useState<ApiDonation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [handoffBusyId, setHandoffBusyId] = useState('');
  const [handoffTokenById, setHandoffTokenById] = useState<Record<string, string>>({});
  const [handoffExpiresAtById, setHandoffExpiresAtById] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState({
    itemsDonated: 0,
    estimatedInventoryValue: 0,
    recipientCount: 0,
    completedPickups: 0,
  });

  const loadRecords = useCallback(async () => {
    if (!session.token || session.user?.role !== 'business') return;
    setLoading(true);
    setMessage('');
    try {
      const [recordsResponse, summaryResponse] = await Promise.all([
        getDonations(session.token),
        getDonationImpactSummary(session.token),
      ]);
      setRecords(recordsResponse.donations || []);
      setSummary(summaryResponse.summary);
    } catch (err) {
      setRecords([]);
      setMessage(err instanceof Error ? err.message : 'Could not load your donation records.');
    } finally {
      setLoading(false);
    }
  }, [session.token, session.user?.role]);

  useFocusEffect(
    useCallback(() => {
      loadRecords();
    }, [loadRecords])
  );

  async function generateHandoffToken(recordId: string) {
    if (!session.token) return;
    setHandoffBusyId(recordId);
    setMessage('');
    try {
      const response = await generateDonationHandoffToken(session.token, recordId);
      setHandoffTokenById((previous) => ({ ...previous, [recordId]: response.handoffToken }));
      setHandoffExpiresAtById((previous) => ({ ...previous, [recordId]: response.expiresAt }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not generate the handoff token.');
    } finally {
      setHandoffBusyId('');
    }
  }

  async function exportRecords() {
    if (!session.token || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const csv = await exportDonationRecordsCsv(session.token);
      if (Platform.OS === 'web') {
        const href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
        const webDoc = (globalThis as { document?: { createElement: (tag: string) => { href: string; download: string; click: () => void } } }).document;
        if (webDoc) {
          const anchor = webDoc.createElement('a');
          anchor.href = href;
          anchor.download = 'my-donation-records.csv';
          anchor.click();
        }
      } else {
        await Share.share({ title: 'My donation records', message: csv });
      }
      setMessage('Your private record export is ready.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not export your records.');
    } finally {
      setBusy(false);
    }
  }

  if (!session.isAuthenticated || !session.user) {
    return (
      <StackScreenShell>
        <ThemedText type="subtitle">My donation records</ThemedText>
        <ThemedText type="small">Sign in as a business to view your records.</ThemedText>
      </StackScreenShell>
    );
  }

  if (session.user.role !== 'business') {
    return (
      <StackScreenShell>
        <ThemedText type="subtitle">My donation records</ThemedText>
        <ThemedText type="small">Business donation records are private to the business account that created them.</ThemedText>
        <Pressable style={styles.secondaryBtn} onPress={() => router.replace('/')}>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Pressable>
      </StackScreenShell>
    );
  }

  return (
    <StackScreenShell>
      <Pressable style={styles.backBtn} onPress={() => router.replace('/')} hitSlop={10}>
        <ThemedText type="smallBold">Back to Home</ThemedText>
      </Pressable>
      <View style={styles.headingRow}>
        <View style={styles.headingText}>
          <ThemedText type="subtitle">My donation records</ThemedText>
          <ThemedText type="small" style={styles.helperText}>Only records created by this account appear here.</ThemedText>
        </View>
        <Pressable style={styles.createBtn} onPress={() => router.push('/create-donation-record' as Href)}>
          <ThemedText type="smallBold">Create record</ThemedText>
        </Pressable>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.metricsRow}>
          <View style={styles.metric}><ThemedText type="small">Items</ThemedText><ThemedText type="smallBold">{summary.itemsDonated}</ThemedText></View>
          <View style={styles.metric}><ThemedText type="small">Recipients</ThemedText><ThemedText type="smallBold">{summary.recipientCount}</ThemedText></View>
          <View style={styles.metric}><ThemedText type="small">Received</ThemedText><ThemedText type="smallBold">{summary.completedPickups}</ThemedText></View>
        </View>
        <ThemedText type="small">Recorded value: {formatCurrency(summary.estimatedInventoryValue)}</ThemedText>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={[styles.secondaryBtn, styles.actionBtn]} onPress={loadRecords} disabled={loading}>
          <ThemedText type="smallBold">Refresh</ThemedText>
        </Pressable>
        <Pressable style={[styles.secondaryBtn, styles.actionBtn, busy && styles.disabledBtn]} onPress={exportRecords} disabled={busy}>
          <ThemedText type="smallBold">Export CSV</ThemedText>
        </Pressable>
      </View>

      {!!message ? <ThemedText style={styles.message}>{message}</ThemedText> : null}
      {loading ? (
        <View style={styles.loadingRow}><ActivityIndicator size="small" /><ThemedText type="small">Loading your records...</ThemedText></View>
      ) : records.length === 0 ? (
        <View style={styles.emptyCard}>
          <ThemedText type="smallBold">No donation records yet</ThemedText>
          <ThemedText type="small">Create your first record to scan an item and assign an eligible nonprofit.</ThemedText>
          <Pressable style={styles.primaryBtn} onPress={() => router.push('/create-donation-record' as Href)}>
            <ThemedText type="smallBold">Create donation record</ThemedText>
          </Pressable>
        </View>
      ) : (
        records.map((record) => (
          <View key={record.id} style={styles.recordCard}>
            <View style={styles.recordHeading}>
              <ThemedText type="smallBold" style={styles.recordName}>{record.productName || 'Donated inventory'}</ThemedText>
              <ThemedText type="small" style={styles.status}>{record.status}</ThemedText>
            </View>
            <ThemedText type="small">Recipient: {record.recipientName || 'Assigned nonprofit'}</ThemedText>
            <ThemedText type="small">Quantity: {record.quantity} {record.unit}</ThemedText>
            <ThemedText type="small">Created: {formatDate(record.createdAt)}</ThemedText>
            {typeof record.estimatedTotalValue === 'number' ? <ThemedText type="small">Recorded value: {formatCurrency(record.estimatedTotalValue)}</ThemedText> : null}

            {record.status === 'accepted' ? (
              <>
                <Pressable
                  style={[styles.secondaryBtn, handoffBusyId === record.id && styles.disabledBtn]}
                  onPress={() => generateHandoffToken(record.id)}
                  disabled={handoffBusyId === record.id}>
                  {handoffBusyId === record.id ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Generate handoff QR</ThemedText>}
                </Pressable>
                {!!handoffTokenById[record.id] ? (
                  <View style={styles.qrBox}>
                    <QRCode value={`${HANDOFF_QR_PREFIX}${handoffTokenById[record.id]}`} size={148} backgroundColor="#F3F8FF" color="#1C2735" />
                    <ThemedText type="small">Expires: {handoffExpiresAtById[record.id]}</ThemedText>
                  </View>
                ) : null}
              </>
            ) : null}

            {record.status === 'received' ? (
              <Pressable style={styles.secondaryBtn} onPress={() => router.push({ pathname: '/donation-acknowledgment', params: { donationId: record.id } })}>
                <ThemedText type="smallBold">View acknowledgment</ThemedText>
              </Pressable>
            ) : null}
          </View>
        ))
      )}
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  backBtn: { alignSelf: 'flex-start' },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  headingText: { flex: 1, gap: Spacing.one },
  helperText: { color: '#5B6778', lineHeight: 18 },
  createBtn: { borderWidth: 1, borderColor: '#476C9D', borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, backgroundColor: '#CFE1F8' },
  summaryCard: { borderWidth: 1, borderColor: '#BFD4EA', borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two, backgroundColor: '#F3F8FF' },
  metricsRow: { flexDirection: 'row', gap: Spacing.one },
  metric: { flex: 1, gap: 2 },
  actionRow: { flexDirection: 'row', gap: Spacing.two },
  actionBtn: { flex: 1 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  emptyCard: { borderWidth: 1, borderColor: '#D6DFEA', borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two, backgroundColor: '#FAFCFF' },
  recordCard: { borderWidth: 1, borderColor: '#D6DFEA', borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one, backgroundColor: '#FAFCFF' },
  recordHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  recordName: { flex: 1 },
  status: { textTransform: 'capitalize', color: '#355A48' },
  qrBox: { alignItems: 'center', gap: Spacing.one, padding: Spacing.two, borderRadius: Spacing.three, backgroundColor: '#F3F8FF' },
  secondaryBtn: { alignItems: 'center', borderRadius: Spacing.three, paddingVertical: Spacing.three, paddingHorizontal: Spacing.two, borderWidth: 1, borderColor: '#CDD5E1', backgroundColor: '#F7F9FC' },
  primaryBtn: { alignItems: 'center', borderRadius: Spacing.three, paddingVertical: Spacing.three, borderWidth: 1, borderColor: '#476C9D', backgroundColor: '#CFE1F8' },
  disabledBtn: { opacity: 0.5 },
  message: { color: '#49596D' },
});
