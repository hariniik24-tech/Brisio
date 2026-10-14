import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import { createListing, lookupProductByBarcode } from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';
const RETAIL_BARCODE_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'];

function inferDonationCategory(description: string) {
  const normalized = description.toLowerCase();
  if (/coca-cola|soda|drink|beverage|water|juice|coffee|tea/.test(normalized)) return 'beverages';
  if (/food|meal|produce|vegetable|fruit|bread|grocery|canned/.test(normalized)) return 'food';
  if (/equipment|tool|machine|device|computer|furniture/.test(normalized)) return 'equipment';
  if (/space|room|office|venue|warehouse/.test(normalized)) return 'space';
  if (/service|training|consulting|volunteer/.test(normalized)) return 'service';
  return 'donation';
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
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('cases');
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
      setBarcode(cleanedBarcode);
      setDescription(response.product.name);
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
        setError('Camera permission is required to scan a product barcode. You can enter the UPC instead.');
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
    const parsedQuantity = Number(quantity);
    if (!description.trim() || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || !unit.trim()) {
      setError('Product, quantity, and quantity type are required.');
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    setError('');
    try {
      await createListing(session.token, {
        category: inferDonationCategory(description),
        description: `${parsedQuantity} ${unit.trim()} of ${description.trim()}`,
        contact: contact.trim(),
        location: session.user.location,
        resourceName: description.trim(),
        resourceType: unit.trim(),
        quantity: String(parsedQuantity),
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

      <ThemedText type="smallBold">Product barcode (optional)</ThemedText>
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
        <Pressable style={[styles.secondaryBtn, styles.actionBtn]} onPress={() => identifyProduct(barcode)} disabled={lookupBusy || busy}>
          {lookupBusy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Identify item</ThemedText>}
        </Pressable>
      </View>

      <ThemedText type="smallBold">Donation details</ThemedText>
      <TextInput
        accessibilityLabel="Listing description"
        style={styles.input}
        placeholder="Product or donation name"
        placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        multiline
        value={description}
        onChangeText={setDescription}
      />

      <View style={styles.actionRow}>
        <View style={styles.actionBtn}>
          <ThemedText type="smallBold">Quantity</ThemedText>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            placeholder="20"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          />
        </View>
        <View style={styles.actionBtn}>
          <ThemedText type="smallBold">Quantity type</ThemedText>
          <TextInput
            style={styles.input}
            value={unit}
            onChangeText={setUnit}
            placeholder="Cases"
            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          />
        </View>
      </View>

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
    height: 320,
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