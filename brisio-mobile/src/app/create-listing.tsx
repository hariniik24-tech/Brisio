import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import { ApiScannedProduct, createListing, lookupProductByBarcode } from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';
const RETAIL_BARCODE_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'];

function capitalizeWords(value: string) {
  return value.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function parseDonationDetails(description: string) {
  const match = description.trim().match(/^(\d+(?:\.\d+)?)\s+([^\s]+)\s+(?:of\s+)?(.+)$/i);
  if (!match) return {};
  return {
    quantity: match[1],
    resourceType: match[2],
    resourceName: match[3],
  };
}

export default function CreateListingScreen() {
  const router = useRouter();
  const session = useSessionContext();
  const submittingRef = useRef(false);
  const scanningRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [identifiedProduct, setIdentifiedProduct] = useState<ApiScannedProduct | null>(null);
  const [priceSource, setPriceSource] = useState('');
  const [estimatedUnitValue, setEstimatedUnitValue] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState(session.user?.phone || session.user?.email || '');
  const [deliveryTiming, setDeliveryTiming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function identifyProduct(value: string) {
    if (!session.token) return;
    const cleanedBarcode = value.replace(/\D/g, '');
    if (!cleanedBarcode) {
      setError('Enter or scan a product barcode first.');
      return;
    }
    setLookupBusy(true);
    setError('');
    try {
      const response = await lookupProductByBarcode(session.token, { barcode: cleanedBarcode, format: 'upc-a' });
      const product = response.product;
      setBarcode(cleanedBarcode);
      setIdentifiedProduct(product);
      setPriceSource(product.priceSource || 'No current price source found');
      setEstimatedUnitValue(typeof product.estimatedUnitValue === 'number' ? product.estimatedUnitValue.toFixed(2) : '');
      if (!category.trim() && product.category) setCategory(capitalizeWords(product.category));
      const parsedDetails = parseDonationDetails(description);
      const quantity = parsedDetails.quantity || '1';
      const unit = parsedDetails.resourceType || 'item';
      setDescription(`${quantity} ${unit} of ${product.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not identify that barcode.');
    } finally {
      setLookupBusy(false);
    }
  }

  async function openScanner() {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        setError('Camera permission is required to scan a barcode. You can enter the UPC instead.');
        return;
      }
    }
    scanningRef.current = false;
    setError('');
    setScannerOpen(true);
  }

  async function handleBarcodeScanned({ data }: { data: string }) {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScannerOpen(false);
    await identifyProduct(data);
  }

  async function submitListing() {
    if (!session.token || !session.user || submittingRef.current) return;
    if (!category.trim() || !description.trim()) {
      setError('Category and description are required.');
      return;
    }
    const parsedEstimatedUnitValue = estimatedUnitValue.trim() === '' ? undefined : Number(estimatedUnitValue);
    if (parsedEstimatedUnitValue !== undefined && (!Number.isFinite(parsedEstimatedUnitValue) || parsedEstimatedUnitValue < 0)) {
      setError('Estimated unit value must be a nonnegative number.');
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const donationDetails = parseDonationDetails(description);
      await createListing(session.token, {
        category: category.trim().toLowerCase(),
        description: description.trim(),
        contact: contact.trim(),
        location: session.user.location,
        ...donationDetails,
        ...(identifiedProduct?.name ? { resourceName: identifiedProduct.name } : {}),
        ...(identifiedProduct?.brand ? { productBrand: identifiedProduct.brand } : {}),
        ...(identifiedProduct?.upc ? { upc: identifiedProduct.upc } : {}),
        ...(identifiedProduct?.gtin ? { gtin: identifiedProduct.gtin } : {}),
        ...(parsedEstimatedUnitValue !== undefined ? { estimatedUnitValue: parsedEstimatedUnitValue } : {}),
        ...(deliveryTiming.trim() ? { availabilityNotes: deliveryTiming.trim() } : {}),
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

  if (session.user.role !== 'business') {
    return (
      <StackScreenShell>
        <Pressable onPress={() => router.replace('/')} style={styles.backBtn} hitSlop={10}>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Business listings</ThemedText>
        <ThemedText type="small">
          Only business accounts create listings. Nonprofit accounts browse business offers and choose whether to accept or decline them.
        </ThemedText>
        <Pressable style={styles.primaryBtn} onPress={() => router.replace('/explore')}>
          <ThemedText type="smallBold">Browse business listings</ThemedText>
        </Pressable>
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
        Share a resource that is available for nonprofits.
      </ThemedText>
      <ThemedText type="smallBold">
        Posting as {session.user.organizationName || session.user.displayName}
      </ThemedText>
      <ThemedText type="small">Address: {session.user.location || 'No account address set'}</ThemedText>

      <ThemedText type="smallBold">Scan product (optional)</ThemedText>
      <ThemedText type="small" style={styles.helperText}>
        Identify a packaged product and prefill its available market-value estimate.
      </ThemedText>
      {scannerOpen ? (
        <View style={styles.scannerCard}>
          <CameraView
            style={styles.camera}
            facing="back"
            onBarcodeScanned={handleBarcodeScanned}
            barcodeScannerSettings={{ barcodeTypes: RETAIL_BARCODE_TYPES }}
          />
          <ThemedText type="small" style={styles.scannerHelp}>Keep the whole product barcode visible.</ThemedText>
          <Pressable style={styles.secondaryBtn} onPress={() => setScannerOpen(false)}>
            <ThemedText type="smallBold">Cancel scan</ThemedText>
          </Pressable>
        </View>
      ) : null}
      <TextInput
        accessibilityLabel="Product barcode"
        style={styles.input}
        value={barcode}
        onChangeText={setBarcode}
        keyboardType="number-pad"
        placeholder="Enter UPC"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
      />
      <View style={styles.actionRow}>
        <Pressable style={[styles.secondaryBtn, styles.actionBtn]} onPress={openScanner} disabled={lookupBusy || busy}>
          <ThemedText type="smallBold">Scan barcode</ThemedText>
        </Pressable>
        <Pressable style={[styles.secondaryBtn, styles.actionBtn]} onPress={() => identifyProduct(barcode)} disabled={lookupBusy || busy}>
          {lookupBusy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Identify product</ThemedText>}
        </Pressable>
      </View>
      {identifiedProduct ? (
        <View style={styles.productResult}>
          <ThemedText type="smallBold">{identifiedProduct.name}</ThemedText>
          {!!identifiedProduct.brand && <ThemedText type="small">Brand: {identifiedProduct.brand}</ThemedText>}
          <ThemedText type="small">Value source: {priceSource}</ThemedText>
        </View>
      ) : null}

      <ThemedText type="smallBold">Estimated value per unit (optional)</ThemedText>
      <TextInput
        accessibilityLabel="Estimated value per unit"
        style={styles.input}
        value={estimatedUnitValue}
        onChangeText={setEstimatedUnitValue}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
      />
      <ThemedText type="small" style={styles.helperText}>
        Verify this donor-reported estimate before publishing. The acknowledgment records the value but does not determine tax deductibility.
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

      <ThemedText type="smallBold">Donation details</ThemedText>
      <TextInput
        accessibilityLabel="Listing description"
        style={[styles.input, styles.multilineInput]}
        placeholder="Example: 20 sealed cases of assorted canned vegetables"
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

      <ThemedText type="smallBold">Delivery timing</ThemedText>
      <TextInput
        accessibilityLabel="Delivery or pickup timing"
        style={styles.input}
        placeholder="Today at 4 PM, in 30 minutes, tomorrow morning..."
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        value={deliveryTiming}
        onChangeText={setDeliveryTiming}
      />

      <ThemedText type="small" style={styles.helperText}>
        Your business name, account address, and phone number are added automatically.
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
    height: 300,
    width: '100%',
  },
  scannerHelp: {
    paddingHorizontal: Spacing.two,
    color: '#3A4A60',
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  actionBtn: {
    flex: 1,
  },
  secondaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    borderWidth: 1,
    borderColor: '#CDD5E1',
    backgroundColor: '#F7F9FC',
  },
  productResult: {
    borderWidth: 1,
    borderColor: '#B9D4C2',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
    backgroundColor: '#EDF7F0',
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