import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ApiListing, createListing, getDonationImpactSummary, getListings, requestListingEngagement } from '@/constants/api';
import { API_BASE_URL } from '@/constants/config';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';
import { Link, useRouter } from 'expo-router';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';
const DONATION_SUMMARY_FALLBACK_MESSAGE = 'Donation metrics are temporarily unavailable. Please refresh shortly.';

type Stats = {
  supply: number;
  demand: number;
};

type DonationSummary = {
  itemsDonated: number;
  estimatedInventoryValue: number;
  recipientCount: number;
  completedPickups: number;
};

type ListingForm = {
  category: string;
  description: string;
  contact: string;
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
  deliverWithinHours: string;
};

const emptyStats: Stats = { supply: 0, demand: 0 };
const emptyDonationSummary: DonationSummary = {
  itemsDonated: 0,
  estimatedInventoryValue: 0,
  recipientCount: 0,
  completedPickups: 0,
};
const initialForm: ListingForm = {
  category: '',
  description: '',
  contact: '',
  urgencyLevel: 'medium',
  deliverWithinHours: '',
};

export default function HomeScreen() {
  const router = useRouter();
  const session = useSessionContext();
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState('');

  const [listings, setListings] = useState<ApiListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [chatBusyListingId, setChatBusyListingId] = useState('');
  const [donationSummary, setDonationSummary] = useState<DonationSummary>(emptyDonationSummary);
  const [donationSummaryLoading, setDonationSummaryLoading] = useState(false);
  const [donationSummaryError, setDonationSummaryError] = useState('');
  const [donationSummaryUpdatedAt, setDonationSummaryUpdatedAt] = useState('');

  const [form, setForm] = useState<ListingForm>(initialForm);
  const listingSubmittingRef = useRef(false);
  const [listingSubmitting, setListingSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSummary, setAiSummary] = useState('');
  const [aiActions, setAiActions] = useState<string[]>([]);
  const [aiError, setAiError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  const endpoint = useMemo(() => `${API_BASE_URL}/api/stats`, []);

  async function loadStats() {
    setStatsLoading(true);
    setStatsError('');
    try {
      const response = await fetch(endpoint);
      const payload = await response.json();
      if (!response.ok || !payload.success || !payload.stats) {
        throw new Error('Could not load stats');
      }
      setStats({
        supply: payload.stats.supply || 0,
        demand: payload.stats.demand || 0,
      });
    } catch {
      setStatsError('Unable to reach backend stats. Update apiBaseUrl in app.json for device testing.');
      setStats(emptyStats);
    } finally {
      setStatsLoading(false);
    }
  }

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
    let isActive = true;
    (async () => {
      if (!isActive) return;
      try {
        const response = await fetch(endpoint);
        const payload = await response.json();
        if (!response.ok || !payload.success || !payload.stats) {
          throw new Error('Could not load stats');
        }
        if (!isActive) return;
        setStats({
          supply: payload.stats.supply || 0,
          demand: payload.stats.demand || 0,
        });
      } catch {
        if (!isActive) return;
        setStatsError('Unable to reach backend stats. Update apiBaseUrl in app.json for device testing.');
        setStats(emptyStats);
      } finally {
        if (isActive) setStatsLoading(false);
      }
    })();
    return () => {
      isActive = false;
    };
  }, [endpoint]);

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

  async function submitListing() {
    if (!session.token || !session.user || listingSubmittingRef.current) return;
    setFormError('');
    setFormSuccess('');

    if (!form.category.trim() || !form.description.trim()) {
      setFormError('Category and description are required.');
      return;
    }

    listingSubmittingRef.current = true;
    setListingSubmitting(true);
    try {
      const payload: {
        category: string;
        description: string;
        contact: string;
        location: string;
        urgencyLevel?: 'low' | 'medium' | 'high' | 'critical';
        deliverWithinHours?: string;
      } = {
        category: form.category.trim().toLowerCase(),
        description: form.description.trim(),
        contact: form.contact.trim(),
        location: session.user.location,
      };

      if (session.user.role === 'organization') {
        payload.urgencyLevel = form.urgencyLevel;
      }
      if (session.user.role === 'business' && form.deliverWithinHours.trim()) {
        payload.deliverWithinHours = form.deliverWithinHours.trim();
      }

      await createListing(session.token, payload);
      setFormSuccess('Listing posted successfully.');
      setForm(initialForm);
      await Promise.all([loadListings(), loadStats()]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not post listing.');
    } finally {
      listingSubmittingRef.current = false;
      setListingSubmitting(false);
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

  async function startPrivateChatFromListing(listingId: string) {
    if (!session.token) return;
    setFormError('');
    setFormSuccess('');
    setChatBusyListingId(listingId);
    try {
      const response = await requestListingEngagement(session.token, listingId);
      setFormSuccess('Private chat request sent. Opening conversation...');
      router.push({
        pathname: '/chats',
        params: { engagementId: response.engagementId },
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not start private chat.');
    } finally {
      setChatBusyListingId('');
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
            <Image source={require('@/assets/images/icon.png')} style={styles.heroLogo} resizeMode="contain" />
            <ThemedText type="title" style={styles.title}>
              Brisio
            </ThemedText>
            <ThemedText type="small" style={styles.subtitle}>
              Bridging resources. Strengthening communities.
            </ThemedText>
            <ThemedText type="small" style={styles.heroCaption}>
              Brisio helps businesses and nonprofits share resources, post requests, and coordinate support in one place.
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
                <ThemedText type="smallBold">
                  Signed in as {session.user.organizationName || session.user.displayName}
                </ThemedText>
                <ThemedText type="small">
                  Role: {session.user.role === 'organization' ? 'nonprofit' : session.user.role}
                </ThemedText>
                <ThemedView style={styles.rolePathPanel}>
                  <ThemedText type="smallBold">
                    {session.user.role === 'organization' ? 'Nonprofit path: Explore + request' : 'Business path: Offer + deliver'}
                  </ThemedText>
                  <ThemedText type="small" style={styles.rolePathText}>
                    {session.user.role === 'organization'
                      ? 'Focus on exploring active offers and requesting what your organization needs.'
                      : 'Focus on posting available resources and coordinating delivery quickly.'}
                  </ThemedText>
                </ThemedView>
                <Link href="/chats" asChild>
                  <Pressable style={styles.primaryBtn}>
                    <ThemedText type="smallBold">Open private chats</ThemedText>
                  </Pressable>
                </Link>
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
                  Ask for live recommendations based on current listings and your role.
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

              <ThemedView
                type="backgroundElement"
                style={[
                  styles.panel,
                  session.user.role === 'business' ? styles.businessListingPanel : styles.nonprofitListingPanel,
                ]}>
                <ThemedText type="smallBold">
                  {session.user.role === 'business' ? 'Create business offer' : 'Create nonprofit need'}
                </ThemedText>
                <ThemedText type="small" style={styles.helperText}>
                  {session.user.role === 'business'
                    ? 'Post available resources for nonprofits to discover and request.'
                    : 'Post what your nonprofit needs so businesses can respond with support.'}
                </ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder="Category (space, time, equipment, service, food, other)"
                  placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                  value={form.category}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, category: value }))}
                />
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  placeholder="Description"
                  placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                  multiline
                  value={form.description}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, description: value }))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Contact"
                  placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                  value={form.contact}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, contact: value }))}
                />
                <ThemedText type="small" style={styles.helperText}>
                  Location: {session.user.location}
                </ThemedText>
                {session.user.role !== 'organization' ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Deliver within hours (optional)"
                    placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                    keyboardType="numeric"
                    value={form.deliverWithinHours}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, deliverWithinHours: value }))}
                  />
                ) : null}
                <Pressable
                  style={[styles.primaryBtn, listingSubmitting && styles.disabledBtn]}
                  onPress={submitListing}
                  disabled={listingSubmitting}>
                  <ThemedText type="smallBold">
                    {listingSubmitting
                      ? 'Posting...'
                      : session.user.role === 'business'
                        ? 'Post offer listing'
                        : 'Post need listing'}
                  </ThemedText>
                </Pressable>
                {!!formError && <ThemedText style={styles.errorText}>{formError}</ThemedText>}
                {!!formSuccess && <ThemedText style={styles.successText}>{formSuccess}</ThemedText>}
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.panel}>
                <ThemedText type="smallBold">Recent listings</ThemedText>
                {listingsLoading ? (
                  <ThemedView style={styles.loadingRow}>
                    <ActivityIndicator size="small" />
                    <ThemedText type="small">Loading listings...</ThemedText>
                  </ThemedView>
                ) : listings.length === 0 ? (
                  <ThemedText type="small">No listings yet.</ThemedText>
                ) : (
                  listings.slice(0, 8).map((item) => (
                    <ThemedView key={item.id} style={styles.listingItem}>
                      <ThemedText type="smallBold">{item.businessName}</ThemedText>
                      <ThemedText type="small">
                        {item.category} | {item.type === 'supply' ? 'Business offer' : 'Nonprofit need'}
                      </ThemedText>
                      <ThemedText type="small">{item.description}</ThemedText>
                      <ThemedText type="small">{item.location}</ThemedText>
                      {session.user && item.ownerUserId !== session.user.id ? (
                        <Pressable
                          style={styles.secondaryBtn}
                          onPress={() => startPrivateChatFromListing(item.id)}>
                          <ThemedText type="smallBold">
                            {chatBusyListingId === item.id ? 'Starting chat...' : 'Start private chat'}
                          </ThemedText>
                        </Pressable>
                      ) : null}
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
                      ? 'Business view: track inventory value and completed pickups.'
                      : 'Nonprofit view: track received supply and partner coverage.'}
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

          <ThemedView type="backgroundElement" style={styles.panel}>
            <ThemedText type="smallBold">Active community listings</ThemedText>
            {statsLoading ? (
              <ThemedView style={styles.loadingRow}>
                <ActivityIndicator size="small" />
                <ThemedText type="small">Loading community activity...</ThemedText>
              </ThemedView>
            ) : (
              <ThemedText type="small">Current offers and needs across all Brisio accounts.</ThemedText>
            )}
            {!!statsError && <ThemedText style={styles.errorText}>{statsError}</ThemedText>}
          </ThemedView>

          <ThemedView style={styles.statsGrid}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View business offers"
              style={styles.statTileLink}
              onPress={() => router.push('/explore')}>
              <ThemedView type="backgroundElement" style={styles.statTile}>
                <ThemedText type="small">Business offers</ThemedText>
                <ThemedText type="subtitle">{stats.supply}</ThemedText>
                <ThemedText type="small" style={styles.helperText}>View in Explore</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View nonprofit needs"
              style={styles.statTileLink}
              onPress={() => router.push('/explore')}>
              <ThemedView type="backgroundElement" style={styles.statTile}>
                <ThemedText type="small">Nonprofit needs</ThemedText>
                <ThemedText type="subtitle">{stats.demand}</ThemedText>
                <ThemedText type="small" style={styles.helperText}>View in Explore</ThemedText>
              </ThemedView>
            </Pressable>
          </ThemedView>

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
    gap: Spacing.two,
    marginTop: Spacing.two,
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
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
    width: 68,
    height: 68,
    borderRadius: 16,
  },
  title: {
    textAlign: 'left',
    fontSize: 40,
    lineHeight: 44,
    color: '#1E2F46',
  },
  subtitle: {
    opacity: 0.9,
    color: '#2F4967',
    letterSpacing: 0.2,
  },
  heroCaption: {
    color: '#556B84',
    lineHeight: 20,
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
  businessListingPanel: {
    backgroundColor: '#F8FCFF',
    borderColor: '#D5E6F6',
  },
  nonprofitListingPanel: {
    backgroundColor: '#F7FBF6',
    borderColor: '#D8E8D4',
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
  rolePathPanel: {
    borderWidth: 1,
    borderColor: '#D6E2EF',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: '#F5FAFF',
    gap: Spacing.one,
  },
  rolePathText: {
    color: '#4E6682',
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingBottom: Spacing.three,
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
  statTile: {
    width: '100%',
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
    borderWidth: 1,
    borderColor: '#DCE4EE',
  },
  statTileLink: {
    width: '48%',
    minWidth: 140,
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
});
