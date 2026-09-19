import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import {
  createDonationRecord,
  getDonationRecipients,
  lookupProductByBarcode,
  type ApiOrganization,
  type ApiScannedProduct,
} from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';
const RETAIL_BARCODE_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export default function CreateDonationRecordScreen() {
  const router = useRouter();
  const session = useSessionContext();
  const submittingRef = useRef(false);
  const scanHandledRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [barcode, setBarcode] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [product, setProduct] = useState<ApiScannedProduct | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [estimatedUnitValue, setEstimatedUnitValue] = useState('');
  const [conditionNotes, setConditionNotes] = useState('');
  const [organizations, setOrganizations] = useState<ApiOrganization[]>([]);
  const [recipientOrgId, setRecipientOrgId] = useState('');
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const canSubmit = useMemo(() => {
    const parsedQuantity = Number(quantity);
    return !!product && !!recipientOrgId && Number.isFinite(parsedQuantity) && parsedQuantity > 0;
  }, [product, quantity, recipientOrgId]);

  useEffect(() => {
    if (!session.token || session.user?.role !== 'business') {
      return;
    }
    let active = true;
    getDonationRecipients(session.token)
      .then((response) => {
        if (!active) return;
        const recipients = response.organizations || [];
        setOrganizations(recipients);
        setRecipientOrgId(recipients[0]?.id || '');
      })
      .catch((err) => {
        if (!active) return;
        setOrganizations([]);
        setMessage(err instanceof Error ? err.message : 'Could not load eligible nonprofits.');
      })
      .finally(() => {
        if (active) setRecipientsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.token, session.user?.role]);

  async function runLookup(value: string) {
    if (!session.token) return;
    const cleanedBarcode = value.replace(/\D/g, '');
    if (!cleanedBarcode) {
      setMessage('Enter or scan a product barcode first.');
      return;
    }
    setLookupBusy(true);
    setMessage('');
    try {
      const response = await lookupProductByBarcode(session.token, { barcode: cleanedBarcode, format: 'upc-a' });
      setProduct(response.product);
      setBarcode(cleanedBarcode);
      setMessage('Item identified. Complete the record below.');
    } catch (err) {
      setProduct(null);
      setMessage(err instanceof Error ? err.message : 'Could not identify that barcode.');
    } finally {
      setLookupBusy(false);
    }
  }

  async function openScanner() {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        setMessage('Camera permission is required to scan product barcodes.');
        return;
      }
    }
    scanHandledRef.current = false;
    setHasScanned(false);
    setMessage('');

    if (Platform.OS !== 'web' && CameraView.isModernBarcodeScannerAvailable) {
      const subscription = CameraView.onModernBarcodeScanned((result) => {
        if (scanHandledRef.current) return;
        subscription.remove();
        if (Platform.OS === 'ios') {
          void CameraView.dismissScanner();
        }
        void handleBarcodeScanned(result);
      });
      try {
        await CameraView.launchScanner({
          barcodeTypes: RETAIL_BARCODE_TYPES,
          isGuidanceEnabled: true,
          isHighlightingEnabled: true,
          isPinchToZoomEnabled: true,
        });
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Could not start the barcode scanner.');
      } finally {
        subscription.remove();
      }
      return;
    }

    setScannerOpen(true);
  }

  async function handleBarcodeScanned({ data }: { data: string }) {
    if (scanHandledRef.current) return;
    scanHandledRef.current = true;
    setHasScanned(true);
    setScannerOpen(false);
    setMessage('Barcode detected. Identifying item...');
    await runLookup(data);
  }

  async function submitRecord() {
    if (!session.token || !session.user || !product || submittingRef.current) return;
    const parsedQuantity = Number(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || !recipientOrgId) {
      setMessage('Choose a recipient and enter a quantity greater than zero.');
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      const parsedUnitValue = Number(estimatedUnitValue);
      const response = await createDonationRecord(session.token, {
        donorLocationId: session.user.id,
        recipientOrgId,
        item: product,
        quantity: parsedQuantity,
        unit: unit.trim() || 'units',
        conditionNotes: conditionNotes.trim(),
        estimatedUnitValue: Number.isFinite(parsedUnitValue) && parsedUnitValue >= 0 ? parsedUnitValue : undefined,
      });
      router.replace({ pathname: '/donation-success', params: { donationId: response.donation.id } });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create donation record.');
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  if (!session.isAuthenticated || !session.user) {
    return (
      <StackScreenShell>
        <ThemedText type="subtitle">Create donation record</ThemedText>
        <ThemedText type="small">Sign in as a business to create a private donation record.</ThemedText>
      </StackScreenShell>
    );
  }

  if (session.user.role !== 'business') {
    return (
      <StackScreenShell>
        <ThemedText type="subtitle">Create donation record</ThemedText>
        <ThemedText type="small">Only business accounts can create donation records.</ThemedText>
        <Pressable style={styles.secondaryBtn} onPress={() => router.replace('/')}>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Pressable>
      </StackScreenShell>
    );
  }

  return (
    <StackScreenShell>
      <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
        <ThemedText type="smallBold">Back to my records</ThemedText>
      </Pressable>
      <ThemedText type="subtitle">Create donation record</ThemedText>
      <ThemedText type="small" style={styles.helperText}>
        Scan a grocery or retail product barcode, then complete the donation details.
      </ThemedText>

      {scannerOpen ? (
        <View style={styles.scannerCard}>
          <View style={styles.cameraFrame}>
            <CameraView
              style={styles.camera}
              facing="back"
              onCameraReady={() => setMessage('Scanner ready. Center the product barcode in the frame.')}
              onMountError={({ message: cameraError }) => setMessage(cameraError || 'Could not start the camera.')}
              onBarcodeScanned={hasScanned ? undefined : handleBarcodeScanned}
              barcodeScannerSettings={{ barcodeTypes: RETAIL_BARCODE_TYPES }}
            />
            <View style={styles.scanGuide} pointerEvents="none">
              <View style={styles.scanTarget} />
              <ThemedText type="smallBold" style={styles.scanGuideText}>Center the product barcode</ThemedText>
            </View>
          </View>
          <Pressable style={styles.secondaryBtn} onPress={() => setScannerOpen(false)}>
            <ThemedText type="smallBold">Cancel scan</ThemedText>
          </Pressable>
        </View>
      ) : null}

      <ThemedText type="smallBold">UPC or GTIN</ThemedText>
      <TextInput
        style={styles.input}
        value={barcode}
        onChangeText={setBarcode}
        keyboardType="number-pad"
        placeholder="Example: 012345678905"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
      />
      <View style={styles.actionRow}>
        <Pressable style={[styles.secondaryBtn, styles.actionBtn]} onPress={openScanner} disabled={lookupBusy || busy}>
          <ThemedText type="smallBold">Scan barcode</ThemedText>
        </Pressable>
        <Pressable style={[styles.secondaryBtn, styles.actionBtn]} onPress={() => runLookup(barcode)} disabled={lookupBusy || busy}>
          {lookupBusy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Identify item</ThemedText>}
        </Pressable>
      </View>

      {product ? (
        <View style={styles.card}>
          <ThemedText type="smallBold">{product.name}</ThemedText>
          <ThemedText type="small">Brand: {product.brand || 'Unknown'}</ThemedText>
          <ThemedText type="small">UPC: {product.upc}</ThemedText>
        </View>
      ) : null}

      <ThemedText type="smallBold">Quantity</ThemedText>
      <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="12" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
      <ThemedText type="smallBold">Quantity type</ThemedText>
      <TextInput style={styles.input} value={unit} onChangeText={setUnit} placeholder="Cases, boxes, pounds, or items" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
      <ThemedText type="smallBold">Estimated value per unit (optional)</ThemedText>
      <TextInput style={styles.input} value={estimatedUnitValue} onChangeText={setEstimatedUnitValue} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
      {Number(quantity) > 0 && Number(estimatedUnitValue) >= 0 && estimatedUnitValue.trim() ? (
        <ThemedText type="small">Recorded total: {formatCurrency(Number(quantity) * Number(estimatedUnitValue))}</ThemedText>
      ) : null}

      <ThemedText type="smallBold">Recipient nonprofit</ThemedText>
      {recipientsLoading ? (
        <ActivityIndicator size="small" />
      ) : organizations.length === 0 ? (
        <View style={styles.card}>
          <ThemedText type="smallBold">No eligible nonprofit requests</ThemedText>
          <ThemedText type="small">A nonprofit appears here only while it has an active resource-request listing in Explore.</ThemedText>
        </View>
      ) : (
        <View style={styles.orgList}>
          {organizations.map((organization) => (
            <Pressable
              key={organization.id}
              style={[styles.orgItem, organization.id === recipientOrgId && styles.orgItemSelected]}
              onPress={() => setRecipientOrgId(organization.id)}>
              <ThemedText type="smallBold">{organization.organizationName || organization.displayName}</ThemedText>
              <ThemedText type="small">{organization.location || 'Location not set'}</ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      <ThemedText type="smallBold">Condition notes (optional)</ThemedText>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={conditionNotes}
        onChangeText={setConditionNotes}
        placeholder="Sealed case, best by 2026-10-01"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        multiline
      />
      {!!message ? <ThemedText style={styles.message}>{message}</ThemedText> : null}
      <Pressable style={[styles.primaryBtn, (!canSubmit || busy) && styles.disabledBtn]} onPress={submitRecord} disabled={!canSubmit || busy}>
        {busy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Create record</ThemedText>}
      </Pressable>
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  backBtn: { alignSelf: 'flex-start' },
  helperText: { color: '#5B6778', lineHeight: 18 },
  input: { borderWidth: 1, borderColor: '#C3CDDB', borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 14, backgroundColor: '#FFFFFF', color: '#1C2735' },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  card: { borderWidth: 1, borderColor: '#D6DFEA', borderRadius: Spacing.three, padding: Spacing.three, gap: 4, backgroundColor: '#FAFCFF' },
  scannerCard: { borderWidth: 1, borderColor: '#C9D8EC', borderRadius: Spacing.three, overflow: 'hidden', gap: Spacing.two, paddingBottom: Spacing.two, backgroundColor: '#F3F8FF' },
  cameraFrame: { position: 'relative' },
  camera: { height: 280, width: '100%' },
  scanGuide: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  scanTarget: { width: '78%', height: 108, borderWidth: 2, borderColor: '#FFFFFF', borderRadius: Spacing.two, backgroundColor: 'transparent' },
  scanGuideText: { color: '#FFFFFF', backgroundColor: '#1C2735CC', paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.two },
  actionRow: { flexDirection: 'row', gap: Spacing.two },
  actionBtn: { flex: 1 },
  orgList: { gap: Spacing.two },
  orgItem: { borderWidth: 1, borderColor: '#D2DCE8', borderRadius: Spacing.three, padding: Spacing.three, backgroundColor: '#FFFFFF', gap: 3 },
  orgItemSelected: { borderColor: '#476C9D', backgroundColor: '#EEF4FC' },
  secondaryBtn: { alignItems: 'center', borderRadius: Spacing.three, paddingVertical: Spacing.three, paddingHorizontal: Spacing.two, borderWidth: 1, borderColor: '#CDD5E1', backgroundColor: '#F7F9FC' },
  primaryBtn: { alignItems: 'center', borderRadius: Spacing.three, paddingVertical: Spacing.three, borderWidth: 1, borderColor: '#476C9D', backgroundColor: '#CFE1F8' },
  disabledBtn: { opacity: 0.5 },
  message: { color: '#49596D' },
});