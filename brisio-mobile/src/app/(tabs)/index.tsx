import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ApiListing, deleteListing, getDonationImpactSummary, getListings, updateListing } from '@/constants/api';
import { API_BASE_URL } from '@/constants/config';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';
import { Link, useRouter } from 'expo-router';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';

function capitalizeWords(value: string) {
  return value.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
const DONATION_SUMMARY_FALLBACK_MESSAGE = 'Donation metrics are temporarily unavailable. Please refresh shortly.';

type DonationSummary = {
  itemsDonated: number;
  estimatedInventoryValue: number;
  recipientCount: number;
  completedPickups: number;
};

const emptyDonationSummary: DonationSummary = {
  itemsDonated: 0,
  estimatedInventoryValue: 0,
  recipientCount: 0,
  completedPickups: 0,
};
export default function HomeScreen() {
  const router = useRouter();
  const session = useSessionContext();
  const [listings, setListings] = useState<ApiListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [donationSummary, setDonationSummary] = useState<DonationSummary>(emptyDonationSummary);
  const [donationSummaryLoading, setDonationSummaryLoading] = useState(false);
  const [donationSummaryError, setDonationSummaryError] = useState('');
  const [donationSummaryUpdatedAt, setDonationSummaryUpdatedAt] = useState('');

  const [deletingListingId, setDeletingListingId] = useState('');
  const [editingListingId, setEditingListingId] = useState('');
  const [editForm, setEditForm] = useState({ category: '', description: '', contact: '', availabilityNotes: '' });
  const [listingUpdating, setListingUpdating] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSummary, setAiSummary] = useState('');
  const [aiActions, setAiActions] = useState<string[]>([]);
  const [aiError, setAiError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  const myListings = useMemo(
    () => listings.filter((listing) => listing.ownerUserId === session.user?.id),
    [listings, session.user?.id]
  );

  async function loadListings() {
    if (!session.token) return;
    setListingsLoading(true);
    try {
      const response = await getListings(session.token);
      setListings(response.listings || []);
    } catch {
      setListings([]);
    } finally {
      setListingsLoading(false);
    }
  }

  async function loadDonationSummary() {
    if (!session.token || !session.isAuthenticated) return;
    setDonationSummaryLoading(true);
    setDonationSummaryError('');
    try {
      const response = await getDonationImpactSummary(session.token);
      setDonationSummary(response.summary || emptyDonationSummary);
      setDonationSummaryUpdatedAt(new Date().toISOString());
    } catch {
      setDonationSummary(emptyDonationSummary);
      setDonationSummaryError(DONATION_SUMMARY_FALLBACK_MESSAGE);
    } finally {
      setDonationSummaryLoading(false);
    }
  }

  useEffect(() => {
    if (!session.isAuthenticated || !session.token) return;
    let isActive = true;
    (async () => {
      try {
        const response = await getListings(session.token);
        if (!isActive) return;
        setListings(response.listings || []);
      } catch {
        if (isActive) setListings([]);
      } finally {
        if (isActive) setListingsLoading(false);
      }
    })();
    return () => {
      isActive = false;
    };
  }, [session.isAuthenticated, session.token]);

  useEffect(() => {
    if (!session.isAuthenticated || !session.token) return;
    let active = true;
    (async () => {
      setDonationSummaryLoading(true);
      setDonationSummaryError('');
      try {
        const response = await getDonationImpactSummary(session.token);
        if (!active) return;
        setDonationSummary(response.summary || emptyDonationSummary);
        setDonationSummaryUpdatedAt(new Date().toISOString());
      } catch {
        if (!active) return;
        setDonationSummary(emptyDonationSummary);
        setDonationSummaryError(DONATION_SUMMARY_FALLBACK_MESSAGE);
      } finally {
        if (active) setDonationSummaryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [session.isAuthenticated, session.token]);

  function confirmDeleteListing(listing: ApiListing) {
    if (!session.token || listing.ownerUserId !== session.user?.id) return;

    Alert.alert('Delete listing?', 'This listing will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingListingId(listing.id);
          setFormError('');
          setFormSuccess('');
          try {
            await deleteListing(session.token!, listing.id);
            setFormSuccess('Listing deleted.');
            await loadListings();
          } catch (err) {
            setFormError(err instanceof Error ? err.message : 'Could not delete listing.');
          } finally {
            setDeletingListingId('');
          }
        },
      },
    ]);
  }

  function beginEditListing(listing: ApiListing) {
    setEditingListingId(listing.id);
    setEditForm({
      category: listing.category,
      description: listing.description,
      contact: listing.contact,
      availabilityNotes: listing.availabilityNotes || '',
    });
    setFormError('');
    setFormSuccess('');
  }

  async function saveListingEdits() {
    if (!session.token || !editingListingId || listingUpdating) return;
    if (!editForm.category.trim() || !editForm.description.trim()) {
      setFormError('Category and description are required.');
      return;
    }

    setListingUpdating(true);
    setFormError('');
    setFormSuccess('');
    try {
      await updateListing(session.token, editingListingId, {
        category: editForm.category.trim().toLowerCase(),
        description: editForm.description.trim(),
        contact: editForm.contact.trim(),
        availabilityNotes: editForm.availabilityNotes.trim(),
      });
      setEditingListingId('');
      setFormSuccess('Listing updated.');
      await loadListings();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not update listing.');
    } finally {
      setListingUpdating(false);
    }
  }

  async function runAiAssistant() {
    if (!session.token) return;

    const fallbackPrompt = session.user?.role === 'organization'
      ? `Recommend the best current support options near ${session.user.location || 'my area'}`
      : `Recommend where we can help most right now near ${session.user?.location || 'our area'}`;
    const prompt = aiPrompt.trim() || fallbackPrompt;

    setAiBusy(true);
    setAiError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/recommend/${encodeURIComponent(prompt)}`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });
      const payload = await response.json();
      if (!response.ok || !payload.success || !payload.assistant) {
        throw new Error(payload.error || 'AI request failed');
      }

      const actions = (payload.assistant.actions || [])
        .map((item: { title?: string; action?: string }) => `${item.title || 'Suggestion'}: ${item.action || ''}`)
        .filter(Boolean)
        .slice(0, 4);

      setAiSummary(payload.assistant.summary || 'No summary available yet.');
      setAiActions(actions);
      setAiPrompt(prompt);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Could not run AI assistant.');
    } finally {
      setAiBusy(false);
    }
  }

  if (session.booting) {
    return (
      <ThemedView style={styles.centerLoader}>
        <ActivityIndicator size="small" />
      </ThemedView>
    );
  }

  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <View pointerEvents="none" style={styles.backgroundArtwork}>
            <View style={[styles.blob, styles.blobTopRight]} />
            <View style={[styles.blob, styles.blobTopLeft]} />
            <View style={[styles.blob, styles.blobBottom]} />
          </View>

          <ThemedView style={styles.heroSection}>
            <View style={styles.brandRow}>
              <Image source={require('@/assets/images/icon.png')} style={styles.heroLogo} resizeMode="contain" />
              <ThemedText type="title" style={styles.title}>Brisio</ThemedText>
            </View>
            <ThemedText type="small" style={styles.subtitle}>
              Bridging resources. Strengthening communities.
            </ThemedText>
          </ThemedView>

          {!session.isAuthenticated || !session.user ? (
            <ThemedView type="backgroundElement" style={[styles.panel, styles.authPanel]}>
              <ThemedText type="smallBold">Account access</ThemedText>
              <ThemedText type="small" style={styles.helperText}>
                Sign in to continue, or create an account to join Brisio.
              </ThemedText>
              <View style={styles.modeRow}>
                <Pressable style={styles.modeBtn} onPress={() => router.push('/auth?mode=login')}>
                  <ThemedText type="smallBold">Sign in</ThemedText>
                </Pressable>
                <Pressable style={styles.modeBtn} onPress={() => router.push('/auth?mode=register')}>
                  <ThemedText type="smallBold">Create account</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          ) : (
            <>
              <ThemedView type="backgroundElement" style={styles.panel}>
                {session.user.role === 'business' ? (
                  <Link href="/donate-inventory" asChild>
                    <Pressable style={styles.secondaryBtn}>
                      <ThemedText type="smallBold">Open donate inventory</ThemedText>
                    </Pressable>
                  </Link>
                ) : null}
                {session.user.role === 'organization' ? (
                  <Link href="/donation-inbox" asChild>
                    <Pressable style={styles.secondaryBtn}>
                      <ThemedText type="smallBold">Open donation inbox & QR scanner</ThemedText>
                    </Pressable>
                  </Link>
                ) : null}
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.panel}>
                <ThemedText type="smallBold">AI assistant</ThemedText>
                <ThemedText type="small" style={styles.helperText}>
                  Ask for recommendations based on current listings.
                </ThemedText>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  placeholder="Ask AI where to help next or what to request first"
                  placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                  multiline
                  value={aiPrompt}
                  onChangeText={setAiPrompt}
                />
                <Pressable style={styles.primaryBtn} onPress={runAiAssistant}>
                  <ThemedText type="smallBold">{aiBusy ? 'Analyzing...' : 'Get AI recommendation'}</ThemedText>
                </Pressable>
                {!!aiSummary && <ThemedText type="small">{aiSummary}</ThemedText>}
                {aiActions.map((item) => (
                  <ThemedText key={item} type="small" style={styles.helperText}>
                    • {item}
                  </ThemedText>
                ))}
                {!!aiError && <ThemedText style={styles.errorText}>{aiError}</ThemedText>}
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.panel}>
                <View style={styles.sectionHeadingRow}>
                  <ThemedText type="smallBold">My listings</ThemedText>
                  <Pressable style={styles.createListingBtn} onPress={() => router.push('/create-listing')}>
                    <ThemedText type="smallBold">Create listing</ThemedText>
                  </Pressable>
                </View>
                {!!formError && <ThemedText style={styles.errorText}>{formError}</ThemedText>}
                {!!formSuccess && <ThemedText style={styles.successText}>{formSuccess}</ThemedText>}
                {listingsLoading ? (
                  <ThemedView style={styles.loadingRow}>
                    <ActivityIndicator size="small" />
                    <ThemedText type="small">Loading your listings...</ThemedText>
                  </ThemedView>
                ) : myListings.length === 0 ? (
                  <ThemedText type="small">You have not posted any listings yet.</ThemedText>
                ) : (
                  myListings.map((item) => (
                    <ThemedView key={item.id} style={styles.listingItem}>
                      {editingListingId === item.id ? (
                        <>
                          <TextInput
                            accessibilityLabel="Listing category"
                            style={styles.input}
                            placeholder="Category"
                            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                            autoCapitalize="words"
                            value={editForm.category}
                            onChangeText={(value) => setEditForm((previous) => ({ ...previous, category: capitalizeWords(value) }))}
                          />
                          <TextInput
                            accessibilityLabel="Listing description"
                            style={[styles.input, styles.multilineInput]}
                            placeholder="Description"
                            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                            multiline
                            value={editForm.description}
                            onChangeText={(value) => setEditForm((previous) => ({ ...previous, description: value }))}
                          />
                          <TextInput
                            accessibilityLabel="Listing contact"
                            style={styles.input}
                            placeholder="Contact"
                            placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                            value={editForm.contact}
                            onChangeText={(value) => setEditForm((previous) => ({ ...previous, contact: value }))}
                          />
                          {item.type === 'supply' ? (
                            <TextInput
                              accessibilityLabel="Delivery or pickup timing"
                              style={styles.input}
                              placeholder="Today at 4 PM, in 30 minutes, tomorrow morning..."
                              placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                              value={editForm.availabilityNotes}
                              onChangeText={(value) => setEditForm((previous) => ({ ...previous, availabilityNotes: value }))}
                            />
                          ) : null}
                          <View style={styles.modeRow}>
                            <Pressable style={[styles.primaryBtn, listingUpdating && styles.disabledBtn]} onPress={saveListingEdits} disabled={listingUpdating}>
                              <ThemedText type="smallBold">{listingUpdating ? 'Saving...' : 'Save changes'}</ThemedText>
                            </Pressable>
                            <Pressable style={styles.secondaryBtn} onPress={() => setEditingListingId('')} disabled={listingUpdating}>
                              <ThemedText type="smallBold">Cancel</ThemedText>
                            </Pressable>
                          </View>
                        </>
                      ) : (
                        <>
                          <ThemedText type="smallBold" style={styles.categoryText}>{item.category}</ThemedText>
                          <ThemedText type="small">Business: {item.businessName}</ThemedText>
                          <ThemedText type="small">
                            {item.type === 'supply' ? 'Available resource' : 'Resource request'}
                          </ThemedText>
                          <ThemedText type="small">{item.description}</ThemedText>
                          {!!item.availabilityNotes && <ThemedText type="small">Timing: {item.availabilityNotes}</ThemedText>}
                          <ThemedText type="small">Address: {item.location || 'Address not set'}</ThemedText>
                          <View style={styles.listingActionRow}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Edit ${item.category} listing`}
                              style={[styles.secondaryBtn, styles.listingActionBtn]}
                              onPress={() => beginEditListing(item)}>
                              <ThemedText type="smallBold">Edit</ThemedText>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Delete ${item.category} listing`}
                              style={[styles.deleteListingBtn, styles.listingActionBtn, deletingListingId === item.id && styles.disabledBtn]}
                              onPress={() => confirmDeleteListing(item)}
                              disabled={Boolean(deletingListingId)}>
                              <ThemedText type="smallBold" style={styles.deleteListingText}>
                                {deletingListingId === item.id ? 'Deleting...' : 'Delete'}
                              </ThemedText>
                            </Pressable>
                          </View>
                        </>
                      )}
                    </ThemedView>
                  ))
                )}
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.panel}>
                <ThemedText type="smallBold">Donation impact summary</ThemedText>
                {donationSummaryLoading ? (
                  <ThemedView style={styles.loadingRow}>
                    <ActivityIndicator size="small" />
                    <ThemedText type="small">Loading donation metrics...</ThemedText>
                  </ThemedView>
                ) : (
                  <ThemedText type="small">
                    {session.user.role === 'business'
                      ? 'Track shared inventory value and completed pickups.'
                      : 'Track incoming resources and partner activity.'}
                  </ThemedText>
                )}

                {!!donationSummaryError && <ThemedText style={styles.errorText}>{donationSummaryError}</ThemedText>}
                {!donationSummaryLoading && !!donationSummaryUpdatedAt ? (
                  <ThemedText type="small" style={styles.helperText}>
                    Last refreshed: {new Date(donationSummaryUpdatedAt).toLocaleString()}
                  </ThemedText>
                ) : null}

                <ThemedView style={styles.impactGrid}>
                  <ThemedView style={styles.impactTile}>
                    <ThemedText type="small">
                      {session.user.role === 'business' ? 'Items donated' : 'Items in pipeline'}
                    </ThemedText>
                    <ThemedText type="smallBold">{donationSummary.itemsDonated}</ThemedText>
                  </ThemedView>
                  <ThemedView style={styles.impactTile}>
                    <ThemedText type="small">
                      {session.user.role === 'business' ? 'Inventory value (USD)' : 'Shared value (USD)'}
                    </ThemedText>
                    <ThemedText type="smallBold">{donationSummary.estimatedInventoryValue.toFixed(2)}</ThemedText>
                  </ThemedView>
                  <ThemedView style={styles.impactTile}>
                    <ThemedText type="small">
                      {session.user.role === 'business' ? 'Recipients served' : 'Donor partners'}
                    </ThemedText>
                    <ThemedText type="smallBold">{donationSummary.recipientCount}</ThemedText>
                  </ThemedView>
                  <ThemedView style={styles.impactTile}>
                    <ThemedText type="small">
                      {session.user.role === 'business' ? 'Completed pickups' : 'Confirmed handoffs'}
                    </ThemedText>
                    <ThemedText type="smallBold">{donationSummary.completedPickups}</ThemedText>
                  </ThemedView>
                </ThemedView>

                <Pressable style={styles.secondaryBtn} onPress={loadDonationSummary}>
                  <ThemedText type="smallBold">Refresh donation metrics</ThemedText>
                </Pressable>
              </ThemedView>

              <Pressable style={styles.secondaryBtn} onPress={session.signOut}>
                <ThemedText type="smallBold">Sign out</ThemedText>
              </Pressable>
            </>
          )}

        </SafeAreaView>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centerLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#F2F6FB',
  },
  contentContainer: {
    flexGrow: 1,
    alignItems: 'center',
    paddingBottom: BottomTabInset + Spacing.six,
  },
  container: {
    width: '100%',
    maxWidth: MaxContentWidth,
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    paddingTop: Platform.OS === 'web' ? Spacing.four : Spacing.two,
    position: 'relative',
    overflow: 'hidden',
  },
  backgroundArtwork: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  blob: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.42,
  },
  blobTopRight: {
    width: 240,
    height: 240,
    right: -90,
    top: -60,
    backgroundColor: '#D8ECFA',
  },
  blobTopLeft: {
    width: 180,
    height: 180,
    left: -72,
    top: 80,
    backgroundColor: '#F8E8DA',
  },
  blobBottom: {
    width: 260,
    height: 260,
    left: 40,
    bottom: -170,
    backgroundColor: '#E2F2EA',
  },
  heroSection: {
    gap: Spacing.one,
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: '#EEF5FD',
    borderWidth: 1,
    borderColor: '#DCE5F0',
    shadowColor: '#244264',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  heroLogo: {
    width: 42,
    height: 42,
    borderRadius: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    textAlign: 'left',
    fontSize: 30,
    lineHeight: 34,
    color: '#1E2F46',
  },
  subtitle: {
    opacity: 0.9,
    color: '#2F4967',
    letterSpacing: 0.2,
  },
  panel: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#E0E5EC',
    shadowColor: '#1B3A5A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  authPanel: {
    backgroundColor: '#FFFFFF',
  },
  modeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  modeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CDD5E1',
    borderRadius: Spacing.four,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#FAFBFD',
  },
  modeBtnActive: {
    backgroundColor: '#E6EDF8',
    borderColor: '#9CB4D6',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#D6DFEA',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    backgroundColor: '#F9FCFF',
  },
  checkboxRowActive: {
    borderColor: '#90A8C8',
    backgroundColor: '#EFF5FD',
  },
  checkboxIndicator: {
    color: '#2F4B6A',
    marginTop: 1,
  },
  checkboxText: {
    flex: 1,
    color: '#3A526E',
  },
  inlineLinkRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  inlineLinkText: {
    color: '#2E5E96',
  },
  inputLabel: {
    color: '#2A3A4F',
    fontWeight: '700',
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
  multilineInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderColor: '#476C9D',
    backgroundColor: '#CFE1F8',
    marginTop: Spacing.one,
    shadowColor: '#2D4D74',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  secondaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#CDD5E1',
    backgroundColor: '#F7F9FC',
  },
  forgotLinkBtn: {
    alignSelf: 'flex-start',
    marginTop: Spacing.one,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  errorText: {
    color: '#B54840',
  },
  helperText: {
    color: '#5B6778',
    lineHeight: 18,
  },
  successText: {
    color: '#256A4A',
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  createListingBtn: {
    borderWidth: 1,
    borderColor: '#9CB4D6',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: '#EAF2FC',
  },
  impactGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  impactTile: {
    width: '48%',
    minWidth: 140,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
    borderWidth: 1,
    borderColor: '#D8E4F1',
    backgroundColor: '#F7FBFF',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  listingItem: {
    borderWidth: 1,
    borderColor: '#D7E0EA',
    borderRadius: Spacing.three,
    padding: Spacing.two,
    gap: Spacing.one,
    backgroundColor: '#FBFCFE',
  },
  listingActionRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  categoryText: {
    textTransform: 'capitalize',
  },
  listingActionBtn: {
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
  },
  deleteListingBtn: {
    borderWidth: 1,
    borderColor: '#C94A43',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    backgroundColor: '#FFF5F4',
  },
  deleteListingText: {
    color: '#A12A2A',
  },
});
