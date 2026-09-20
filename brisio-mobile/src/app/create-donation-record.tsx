import { useEffect, useRef, useState } from 'react';
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
const IOS_RETAIL_BARCODE_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_e'];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function parseDecimalInput(value: string) {
  const normalized = value.trim().replace(',', '.').replace(/[^0-9.-]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDecimalInput(value: string) {
  const normalized = value.replace(',', '.').replace(/[^0-9.]/g, '');
  const [whole = '', ...decimalParts] = normalized.split('.');
  return decimalParts.length ? `${whole}.${decimalParts.join('')}` : whole;
}

export default function CreateDonationRecordScreen() {
  const router = useRouter();
  const session = useSessionContext();
  const submittingRef = useRef(false);
  const scanHandledRef = useRef(false);
  const scannerSubscriptionRef = useRef<ReturnType<typeof CameraView.onModernBarcodeScanned> | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [barcode, setBarcode] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [product, setProduct] = useState<ApiScannedProduct | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [estimatedUnitValue, setEstimatedUnitValue] = useState('');
  const [conditionNotes, setConditionNotes] = useState('');
  const [organizations, setOrganizations] = useState<ApiOrganization[]>([]);
  const [recipientOrgId, setRecipientOrgId] = useState('');
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const parsedQuantity = parseDecimalInput(quantity);
  const parsedUnitValue = parseDecimalInput(estimatedUnitValue);
  const estimatedTotal = parsedQuantity !== null && parsedQuantity > 0 && parsedUnitValue !== null && parsedUnitValue >= 0
    ? parsedQuantity * parsedUnitValue
    : null;

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

  useEffect(() => () => {
    scannerSubscriptionRef.current?.remove();
    scannerSubscriptionRef.current = null;
  }, []);

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
      if (typeof response.product.estimatedUnitValue === 'number') {
        setEstimatedUnitValue(response.product.estimatedUnitValue.toFixed(2));
        setMessage('Item and estimated retail value found. Review the value before saving.');
      } else {
        setEstimatedUnitValue('');
        setMessage('Product found, but no recent retail estimate was available. Enter the current value.');
      }
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
    setTorchEnabled(false);
    setMessage('');

    if (Platform.OS === 'android' && CameraView.isModernBarcodeScannerAvailable) {
      scannerSubscriptionRef.current?.remove();
      scannerSubscriptionRef.current = CameraView.onModernBarcodeScanned((result) => {
        if (scanHandledRef.current) return;
        scannerSubscriptionRef.current?.remove();
        scannerSubscriptionRef.current = null;
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
        scannerSubscriptionRef.current?.remove();
        scannerSubscriptionRef.current = null;
        setMessage(err instanceof Error ? err.message : 'Could not start the barcode scanner.');
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
    if (!session.token || !session.user || submittingRef.current) return;
    if (!product || !product.name.trim()) {
      setMessage('Identify the product and enter its product name before saving.');
      return;
    }
    if (parsedQuantity === null || parsedQuantity <= 0) {
      setMessage('Enter a quantity greater than zero.');
      return;
    }
    if (estimatedUnitValue.trim() && (parsedUnitValue === null || parsedUnitValue < 0)) {
      setMessage('Enter a valid estimated value per unit, such as 1.25.');
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      const response = await createDonationRecord(session.token, {
        donorLocationId: session.user.id,
        recipientOrgId,
        item: product,
        quantity: parsedQuantity,
        unit: unit.trim() || 'units',
        conditionNotes: conditionNotes.trim(),
        estimatedUnitValue: parsedUnitValue !== null && parsedUnitValue >= 0 ? parsedUnitValue : undefined,
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
              autofocus="off"
              enableTorch={torchEnabled}
              onCameraReady={() => setMessage('Scanner ready. Hold the phone 6-10 inches away and keep the entire barcode in the frame.')}
              onMountError={({ message: cameraError }) => setMessage(cameraError || 'Could not start the camera.')}
              onBarcodeScanned={hasScanned ? undefined : handleBarcodeScanned}
              barcodeScannerSettings={{ barcodeTypes: Platform.OS === 'ios' ? IOS_RETAIL_BARCODE_TYPES : RETAIL_BARCODE_TYPES }}
            />
            <View style={styles.scanGuide} pointerEvents="none">
              <View style={styles.scanTarget} />
              <ThemedText type="smallBold" style={styles.scanGuideText}>Keep the whole barcode visible</ThemedText>
              <ThemedText type="small" style={styles.scanDistanceText}>Move farther away if the lines look blurry</ThemedText>
            </View>
          </View>
          <View style={styles.scannerActions}>
            <Pressable style={[styles.secondaryBtn, styles.actionBtn]} onPress={() => setTorchEnabled((enabled) => !enabled)}>
              <ThemedText type="smallBold">{torchEnabled ? 'Turn light off' : 'Turn light on'}</ThemedText>
            </Pressable>
            <Pressable style={[styles.secondaryBtn, styles.actionBtn]} onPress={() => setScannerOpen(false)}>
              <ThemedText type="smallBold">Cancel scan</ThemedText>
            </Pressable>
          </View>
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
          <ThemedText type="smallBold">Product name</ThemedText>
          <TextInput
            style={styles.input}
            value={product.name}
            onChangeText={(name) => setProduct((current) => current ? { ...current, name } : current)}
            placeholder="Product name"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          />
          <ThemedText type="smallBold">Brand</ThemedText>
          <TextInput
            style={styles.input}
            value={product.brand}
            onChangeText={(brand) => setProduct((current) => current ? { ...current, brand } : current)}
            placeholder="Brand name"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          />
          <ThemedText type="small">UPC: {product.upc}</ThemedText>
          {product.priceSource ? <ThemedText type="small">Value source: {product.priceSource}</ThemedText> : null}
        </View>
      ) : null}

      <ThemedText type="smallBold">Quantity</ThemedText>
      <TextInput style={styles.input} value={quantity} onChangeText={(value) => setQuantity(normalizeDecimalInput(value))} keyboardType="decimal-pad" placeholder="12" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
      <ThemedText type="smallBold">Quantity type</ThemedText>
      <TextInput style={styles.input} value={unit} onChangeText={setUnit} placeholder="Cases, boxes, pounds, or items" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
      <ThemedText type="smallBold">Estimated value per unit (optional)</ThemedText>
      <View style={styles.currencyInputRow}>
        <ThemedText type="smallBold" style={styles.currencyPrefix}>$</ThemedText>
        <TextInput style={styles.currencyInput} value={estimatedUnitValue} onChangeText={(value) => setEstimatedUnitValue(normalizeDecimalInput(value))} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={INPUT_PLACEHOLDER_COLOR} />
      </View>
      {estimatedTotal !== null ? (
        <ThemedText type="smallBold" style={styles.totalValue}>Estimated total: {formatCurrency(estimatedTotal)}</ThemedText>
      ) : null}

      <ThemedText type="smallBold">Recipient nonprofit</ThemedText>
      {recipientsLoading ? (
        <ActivityIndicator size="small" />
      ) : organizations.length === 0 ? (
        <View style={styles.card}>
          <ThemedText type="smallBold">No nonprofit accounts available</ThemedText>
          <ThemedText type="small">You can save this record unassigned and select a nonprofit later.</ThemedText>
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
      <Pressable style={[styles.primaryBtn, busy && styles.disabledBtn]} onPress={submitRecord} disabled={busy}>
        {busy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">{recipientOrgId ? 'Create record' : 'Save unassigned record'}</ThemedText>}
      </Pressable>
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  backBtn: { alignSelf: 'flex-start' },
  helperText: { color: '#5B6778', lineHeight: 18 },
  input: { borderWidth: 1, borderColor: '#C3CDDB', borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 14, backgroundColor: '#FFFFFF', color: '#1C2735' },
  currencyInputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#C3CDDB', borderRadius: Spacing.three, backgroundColor: '#FFFFFF' },
  currencyPrefix: { paddingLeft: Spacing.three, color: '#445164' },
  currencyInput: { flex: 1, paddingHorizontal: Spacing.two, paddingVertical: 12, fontSize: 14, color: '#1C2735' },
  totalValue: { color: '#244F3D' },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  card: { borderWidth: 1, borderColor: '#D6DFEA', borderRadius: Spacing.three, padding: Spacing.three, gap: 4, backgroundColor: '#FAFCFF' },
  scannerCard: { borderWidth: 1, borderColor: '#C9D8EC', borderRadius: Spacing.three, overflow: 'hidden', gap: Spacing.two, paddingBottom: Spacing.two, backgroundColor: '#F3F8FF' },
  cameraFrame: { position: 'relative' },
  camera: { height: 360, width: '100%' },
  scanGuide: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  scanTarget: { width: '90%', height: 132, borderWidth: 2, borderColor: '#FFFFFF', borderRadius: Spacing.two, backgroundColor: 'transparent' },
  scanGuideText: { color: '#FFFFFF', backgroundColor: '#1C2735CC', paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.two },
  scanDistanceText: { color: '#FFFFFF', backgroundColor: '#1C2735CC', paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.two },
  scannerActions: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.two },
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