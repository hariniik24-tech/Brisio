import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';

import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import {
  createDonationRecord,
  exportDonationRecordsCsv,
  generateDonationHandoffToken,
  getDonations,
  getOrganizations,
  lookupProductByBarcode,
  type ApiDonation,
  type ApiOrganization,
  type ApiScannedProduct,
} from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';
const HANDOFF_QR_PREFIX = 'BRISIO_HANDOFF:';

export default function DonateInventoryScreen() {
  const router = useRouter();
  const session = useSessionContext();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [barcode, setBarcode] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scannerLocked, setScannerLocked] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [product, setProduct] = useState<ApiScannedProduct | null>(null);

  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('units');
  const [donorLocationId, setDonorLocationId] = useState('store-001');
  const [conditionNotes, setConditionNotes] = useState('');

  const [organizations, setOrganizations] = useState<ApiOrganization[]>([]);
  const [recipientOrgId, setRecipientOrgId] = useState('');
  const [myDonations, setMyDonations] = useState<ApiDonation[]>([]);
  const [handoffTokenById, setHandoffTokenById] = useState<Record<string, string>>({});
  const [handoffExpiresAtById, setHandoffExpiresAtById] = useState<Record<string, string>>({});
  const [handoffBusyId, setHandoffBusyId] = useState('');

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const canSubmit = useMemo(() => {
    const qty = Number(quantity);
    return !!product && !!recipientOrgId && Number.isFinite(qty) && qty > 0 && !!donorLocationId.trim();
  }, [product, quantity, recipientOrgId, donorLocationId]);

  useEffect(() => {
    if (!session.token) return;
    let active = true;
    (async () => {
      try {
        const response = await getOrganizations(session.token!);
        if (!active) return;
        const list = response.organizations || [];
        setOrganizations(list);
        if (!recipientOrgId && list.length > 0) {
          setRecipientOrgId(list[0].id);
        }
      } catch {
        if (active) setOrganizations([]);
      }
    })();

    return () => {
      active = false;
    };
  }, [session.token, recipientOrgId]);

  useEffect(() => {
    if (!session.token) return;
    let active = true;
    (async () => {
      try {
        const response = await getDonations(session.token);
        if (!active) return;
        setMyDonations(response.donations || []);
      } catch {
        if (active) setMyDonations([]);
      }
    })();

    return () => {
      active = false;
    };
  }, [session.token]);

  async function runLookup(cleanedBarcode: string) {
    if (!session.token) return;
    const cleaned = cleanedBarcode.replace(/\D/g, '');
    if (!cleaned) {
      setMessage('Enter or scan a barcode first.');
      return;
    }

    setLookupBusy(true);
    setMessage('');
    try {
      const response = await lookupProductByBarcode(session.token, { barcode: cleaned, format: 'upc-a' });
      setProduct(response.product);
      setBarcode(cleaned);
      setMessage('Item identified. Confirm quantity and recipient below.');
    } catch (err) {
      setProduct(null);
      setMessage(err instanceof Error ? err.message : 'Could not identify that barcode.');
    } finally {
      setLookupBusy(false);
    }
  }

  async function handleLookup() {
    await runLookup(barcode);
  }

  async function openScanner() {
    if (Platform.OS === 'web') {
      setMessage('Camera barcode scanning is available on iOS/Android app builds.');
      return;
    }
    if (!cameraPermission?.granted) {
      const permissionResult = await requestCameraPermission();
      if (!permissionResult.granted) {
        setMessage('Camera permission is required to scan barcodes.');
        return;
      }
    }
    setShowScanner(true);
    setScannerLocked(false);
    setMessage('Point camera at UPC/EAN barcode.');
  }

  async function handleBarcodeScanned(scan: BarcodeScanningResult) {
    if (scannerLocked) return;
    const code = String(scan.data || '').replace(/\D/g, '');
    if (!code) return;

    setScannerLocked(true);
    setShowScanner(false);
    setBarcode(code);
    await runLookup(code);
    setScannerLocked(false);
  }

  async function handleCreateDonation() {
    if (!session.token || !product) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setMessage('Enter a valid quantity greater than zero.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const response = await createDonationRecord(session.token, {
        donorLocationId: donorLocationId.trim(),
        recipientOrgId,
        item: product,
        quantity: qty,
        unit: unit.trim() || 'units',
        conditionNotes: conditionNotes.trim(),
      });

      setMessage(`Donation record created: ${response.donation.id}`);
      setQuantity('');
      setConditionNotes('');
      try {
        const latest = await getDonations(session.token);
        setMyDonations(latest.donations || []);
      } catch {
        setMyDonations((prev) => prev);
      }
      router.push({ pathname: '/donation-success', params: { donationId: response.donation.id } });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create donation record.');
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateHandoffToken(donationId: string) {
    if (!session.token) return;
    setHandoffBusyId(donationId);
    setMessage('');
    try {
      const response = await generateDonationHandoffToken(session.token, donationId);
      setHandoffTokenById((prev) => ({ ...prev, [donationId]: response.handoffToken }));
      setHandoffExpiresAtById((prev) => ({ ...prev, [donationId]: response.expiresAt }));
      setMessage('Handoff token generated. Share it securely with the recipient during pickup.');
      const latest = await getDonations(session.token);
      setMyDonations(latest.donations || []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not generate handoff token.');
    } finally {
      setHandoffBusyId('');
    }
  }

  function getHandoffQrValue(donationId: string) {
    const token = handoffTokenById[donationId];
    return token ? `${HANDOFF_QR_PREFIX}${token}` : '';
  }

  async function handleExportCsv() {
    if (!session.token) return;
    setBusy(true);
    setMessage('');
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
      setMessage('Donation CSV export prepared.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not export donation records.');
    } finally {
      setBusy(false);
    }
  }

  if (!session.isAuthenticated || !session.token) {
    return (
      <StackScreenShell>
        <ThemedText type="subtitle">Donate Inventory</ThemedText>
        <ThemedText type="small">Sign in as a business account to post donation records.</ThemedText>
        <Pressable style={styles.secondaryBtn} onPress={() => router.push('/auth?mode=login')}>
          <ThemedText type="smallBold">Sign in</ThemedText>
        </Pressable>
      </StackScreenShell>
    );
  }

  return (
    <StackScreenShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.backBtn} onPress={() => router.push('/(tabs)')}>
          <ThemedText type="smallBold">Back to Home</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Donate Inventory</ThemedText>
        <ThemedText type="small">Scan or enter an existing UPC barcode to start a donation.</ThemedText>

        <ThemedText type="small" style={styles.label}>UPC or GTIN</ThemedText>
        <TextInput
          style={styles.input}
          value={barcode}
          onChangeText={setBarcode}
          keyboardType="number-pad"
          placeholder="Example: 012345678905"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        />

        {showScanner ? (
          <View style={styles.scannerCard}>
            <ThemedText type="smallBold">Scanner active</ThemedText>
            <CameraView
              style={styles.cameraView}
              facing="back"
              onBarcodeScanned={handleBarcodeScanned}
              barcodeScannerSettings={{
                barcodeTypes: ['upc_a', 'upc_e', 'ean13', 'ean8'],
              }}
            />
            <Pressable style={styles.secondaryBtn} onPress={() => setShowScanner(false)}>
              <ThemedText type="smallBold">Close scanner</ThemedText>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.secondaryBtn} onPress={openScanner} disabled={lookupBusy || busy}>
            <ThemedText type="smallBold">Open barcode scanner</ThemedText>
          </Pressable>
        )}

        <Pressable style={styles.secondaryBtn} onPress={handleLookup} disabled={lookupBusy || busy}>
          {lookupBusy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Identify item</ThemedText>}
        </Pressable>

        {product ? (
          <View style={styles.card}>
            <ThemedText type="smallBold">Scanned item</ThemedText>
            <ThemedText type="small">Name: {product.name}</ThemedText>
            <ThemedText type="small">Brand: {product.brand || 'Unknown'}</ThemedText>
            <ThemedText type="small">UPC: {product.upc}</ThemedText>
            <ThemedText type="small">GTIN: {product.gtin}</ThemedText>
          </View>
        ) : null}

        <ThemedText type="small" style={styles.label}>Quantity</ThemedText>
        <TextInput
          style={styles.input}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="number-pad"
          placeholder="12"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        />

        <ThemedText type="small" style={styles.label}>Unit</ThemedText>
        <TextInput
          style={styles.input}
          value={unit}
          onChangeText={setUnit}
          placeholder="units"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        />

        <ThemedText type="small" style={styles.label}>Donor location ID</ThemedText>
        <TextInput
          style={styles.input}
          value={donorLocationId}
          onChangeText={setDonorLocationId}
          placeholder="store-001"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
        />

        <ThemedText type="small" style={styles.label}>Recipient nonprofit</ThemedText>
        <View style={styles.orgList}>
          {organizations.length === 0 ? (
            <ThemedText type="small">No nonprofit accounts available yet.</ThemedText>
          ) : (
            organizations.map((org) => {
              const selected = org.id === recipientOrgId;
              return (
                <Pressable
                  key={org.id}
                  style={[styles.orgItem, selected && styles.orgItemSelected]}
                  onPress={() => setRecipientOrgId(org.id)}>
                  <ThemedText type="smallBold">{org.organizationName || org.displayName}</ThemedText>
                  <ThemedText type="small">{org.location || 'Location not set'}</ThemedText>
                </Pressable>
              );
            })
          )}
        </View>

        <ThemedText type="small" style={styles.label}>Condition notes (optional)</ThemedText>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={conditionNotes}
          onChangeText={setConditionNotes}
          placeholder="Sealed case, best by 2026-10-01"
          placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
          multiline
        />

        <Pressable
          style={[styles.primaryBtn, (!canSubmit || busy) && styles.primaryBtnDisabled]}
          onPress={handleCreateDonation}
          disabled={!canSubmit || busy}>
          {busy ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Create donation record</ThemedText>}
        </Pressable>

        <Pressable style={[styles.secondaryBtn, busy && styles.primaryBtnDisabled]} onPress={handleExportCsv} disabled={busy}>
          <ThemedText type="smallBold">Export my donations as CSV</ThemedText>
        </Pressable>

        <View style={styles.sectionDivider} />
        <ThemedText type="smallBold">Accepted donations awaiting pickup</ThemedText>
        <ThemedText type="small">Generate a one-time token after the nonprofit accepts your donation.</ThemedText>

        {myDonations.filter((d) => String((d as unknown as Record<string, unknown>).status || '') === 'accepted').length === 0 ? (
          <ThemedText type="small">No accepted donations yet.</ThemedText>
        ) : (
          myDonations
            .filter((d) => String((d as unknown as Record<string, unknown>).status || '') === 'accepted')
            .slice(0, 8)
            .map((donation) => {
              const row = donation as unknown as Record<string, unknown>;
              const donationId = String(row.id || '');
              const productName = String(row.productName || row.productname || 'Unknown item');
              const quantityValue = Number(row.quantity || 0);
              const unitValue = String(row.unit || 'units');
              return (
                <View key={donationId} style={styles.card}>
                  <ThemedText type="smallBold">{productName}</ThemedText>
                  <ThemedText type="small">Quantity: {Number.isFinite(quantityValue) ? quantityValue : 0} {unitValue}</ThemedText>
                  <ThemedText type="small">Donation ID: {donationId}</ThemedText>

                  <Pressable
                    style={[styles.secondaryBtn, handoffBusyId === donationId && styles.primaryBtnDisabled]}
                    onPress={() => handleGenerateHandoffToken(donationId)}
                    disabled={handoffBusyId === donationId}>
                    {handoffBusyId === donationId ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <ThemedText type="smallBold">Generate handoff token</ThemedText>
                    )}
                  </Pressable>

                  {!!handoffTokenById[donationId] ? (
                    <View style={styles.tokenBox}>
                      <ThemedText type="smallBold">One-time token</ThemedText>
                      <ThemedText type="small">{handoffTokenById[donationId]}</ThemedText>
                      <ThemedText type="small">Expires: {handoffExpiresAtById[donationId]}</ThemedText>
                      <View style={styles.qrBox}>
                        <ThemedText type="smallBold">QR handoff code</ThemedText>
                        <QRCode value={getHandoffQrValue(donationId)} size={148} backgroundColor="#F3F8FF" color="#1C2735" />
                        <ThemedText type="small">Recipient can scan this QR or type the token.</ThemedText>
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })
        )}

        {!!message ? <ThemedText type="small">{message}</ThemedText> : null}
      </ScrollView>
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  label: {
    color: '#2A3A4F',
    fontWeight: '700',
  },
  backBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#CDD5E1',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: '#F7F9FC',
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
  textArea: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  card: {
    borderWidth: 1,
    borderColor: '#D6DFEA',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: 4,
    backgroundColor: '#FAFCFF',
  },
  sectionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#D6DFEA',
    marginVertical: Spacing.two,
  },
  tokenBox: {
    borderWidth: 1,
    borderColor: '#C9D8EC',
    borderRadius: Spacing.three,
    padding: Spacing.two,
    backgroundColor: '#F3F8FF',
    gap: 2,
  },
  qrBox: {
    marginTop: Spacing.two,
    alignItems: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: '#D7E4F5',
  },
  scannerCard: {
    borderWidth: 1,
    borderColor: '#D6DFEA',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    backgroundColor: '#FAFCFF',
  },
  cameraView: {
    width: '100%',
    height: 260,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  secondaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderColor: '#CDD5E1',
    backgroundColor: '#F7F9FC',
  },
  primaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderColor: '#476C9D',
    backgroundColor: '#CFE1F8',
  },
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  orgList: {
    gap: 8,
  },
  orgItem: {
    borderWidth: 1,
    borderColor: '#D2DCE8',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    backgroundColor: '#FFFFFF',
    gap: 3,
  },
  orgItemSelected: {
    borderColor: '#476C9D',
    backgroundColor: '#EEF4FC',
  },
});
