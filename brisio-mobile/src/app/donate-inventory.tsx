import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Share, StyleSheet, TextInput, View } from 'react-native';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import {
  exportDonationRecordsCsv,
  generateDonationHandoffToken,
  getDonationImpactSummary,
  getDonations,
  updateDonationRecord,
  type ApiDonation,
} from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';

const HANDOFF_QR_PREFIX = 'BRISIO_HANDOFF:';
const INPUT_PLACEHOLDER_COLOR = '#6A7685';

type DonationEdit = {
  id: string;
  productName: string;
  productBrand: string;
  productCategory: string;
  quantity: string;
  unit: string;
  estimatedUnitValue: string;
  conditionNotes: string;
};

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
  const [editing, setEditing] = useState<DonationEdit | null>(null);
  const [editBusy, setEditBusy] = useState(false);
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

  function startEditing(record: ApiDonation) {
    setEditing({
      id: record.id,
      productName: record.productName || '',
      productBrand: record.productBrand || '',
      productCategory: record.productCategory || 'food',
      quantity: String(record.quantity),
      unit: record.unit || 'units',
      estimatedUnitValue: typeof record.estimatedUnitValue === 'number' ? String(record.estimatedUnitValue) : '',
      conditionNotes: record.conditionNotes || '',
    });
    setMessage('');
  }

  async function saveEditing() {
    if (!session.token || !editing || editBusy) return;
    const quantity = Number(editing.quantity);
    const estimatedUnitValue = editing.estimatedUnitValue.trim() === '' ? undefined : Number(editing.estimatedUnitValue);
    if (!editing.productName.trim() || !editing.unit.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      setMessage('Product name, quantity greater than zero, and quantity type are required.');
      return;
    }
    if (estimatedUnitValue !== undefined && (!Number.isFinite(estimatedUnitValue) || estimatedUnitValue < 0)) {
      setMessage('Estimated value must be zero or greater.');
      return;
    }

    setEditBusy(true);
    setMessage('');
    try {
      await updateDonationRecord(session.token, editing.id, {
        productName: editing.productName.trim(),
        productBrand: editing.productBrand.trim(),
        productCategory: editing.productCategory.trim() || 'food',
        quantity,
        unit: editing.unit.trim(),
        estimatedUnitValue,
        conditionNotes: editing.conditionNotes.trim(),
      });
      setEditing(null);
      await loadRecords();
      setMessage('Donation record updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update the donation record.');
    } finally {
      setEditBusy(false);
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

            {editing?.id === record.id ? (
              <View style={styles.editForm}>
                <ThemedText type="smallBold">Product name</ThemedText>
                <TextInput style={styles.input} value={editing.productName} onChangeText={(productName) => setEditing({ ...editing, productName })} placeholder="Product name" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
                <ThemedText type="smallBold">Brand</ThemedText>
                <TextInput style={styles.input} value={editing.productBrand} onChangeText={(productBrand) => setEditing({ ...editing, productBrand })} placeholder="Brand" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
                <ThemedText type="smallBold">Category</ThemedText>
                <TextInput style={styles.input} value={editing.productCategory} onChangeText={(productCategory) => setEditing({ ...editing, productCategory })} autoCapitalize="words" placeholder="Food" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
                <View style={styles.actionRow}>
                  <View style={styles.editField}>
                    <ThemedText type="smallBold">Quantity</ThemedText>
                    <TextInput style={styles.input} value={editing.quantity} onChangeText={(quantity) => setEditing({ ...editing, quantity })} keyboardType="decimal-pad" placeholder="12" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
                  </View>
                  <View style={styles.editField}>
                    <ThemedText type="smallBold">Quantity type</ThemedText>
                    <TextInput style={styles.input} value={editing.unit} onChangeText={(unit) => setEditing({ ...editing, unit })} placeholder="Cases" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
                  </View>
                </View>
                <ThemedText type="smallBold">Estimated value per unit</ThemedText>
                <TextInput style={styles.input} value={editing.estimatedUnitValue} onChangeText={(estimatedUnitValue) => setEditing({ ...editing, estimatedUnitValue })} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
                <ThemedText type="smallBold">Condition notes</ThemedText>
                <TextInput style={[styles.input, styles.textArea]} value={editing.conditionNotes} onChangeText={(conditionNotes) => setEditing({ ...editing, conditionNotes })} multiline placeholder="Sealed case, best-by date" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
                <View style={styles.actionRow}>
                  <Pressable style={[styles.primaryBtn, styles.actionBtn, editBusy && styles.disabledBtn]} onPress={saveEditing} disabled={editBusy}>
                    {editBusy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Save changes</ThemedText>}
                  </Pressable>
                  <Pressable style={[styles.secondaryBtn, styles.actionBtn]} onPress={() => setEditing(null)} disabled={editBusy}>
                    <ThemedText type="smallBold">Cancel</ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : record.status === 'posted' ? (
              <Pressable style={styles.secondaryBtn} onPress={() => startEditing(record)}>
                <ThemedText type="smallBold">Edit record</ThemedText>
              </Pressable>
            ) : null}

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
  editForm: { gap: Spacing.one, paddingTop: Spacing.two },
  editField: { flex: 1, gap: Spacing.one },
  input: { borderWidth: 1, borderColor: '#C3CDDB', borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 14, backgroundColor: '#FFFFFF', color: '#1C2735' },
  textArea: { minHeight: 84, textAlignVertical: 'top' },
  qrBox: { alignItems: 'center', gap: Spacing.one, padding: Spacing.two, borderRadius: Spacing.three, backgroundColor: '#F3F8FF' },
  secondaryBtn: { alignItems: 'center', borderRadius: Spacing.three, paddingVertical: Spacing.three, paddingHorizontal: Spacing.two, borderWidth: 1, borderColor: '#CDD5E1', backgroundColor: '#F7F9FC' },
  primaryBtn: { alignItems: 'center', borderRadius: Spacing.three, paddingVertical: Spacing.three, borderWidth: 1, borderColor: '#476C9D', backgroundColor: '#CFE1F8' },
  disabledBtn: { opacity: 0.5 },
  message: { color: '#49596D' },
});
