import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ApiListing, getListings, respondToListing } from '@/constants/api';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';
import { useTheme } from '@/hooks/use-theme';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';

function ExploreContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const session = useSessionContext();
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyListingId, setBusyListingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [listings, setListings] = useState<ApiListing[]>([]);

  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
      paddingBottom: insets.bottom,
    },
    web: {
      paddingTop: Spacing.six,
      paddingBottom: Spacing.four,
    },
  });

  async function loadData() {
    if (!session.token) return;
    setLoading(true);
    setError('');
    try {
      const result = await getListings(session.token);
      setListings(result.listings || []);
    } catch (err) {
      setListings([]);
      setError(err instanceof Error ? err.message : 'Could not load listings');
    } finally {
      setLoading(false);
    }
  }

  async function handleResponse(listing: ApiListing, action: 'accept' | 'decline') {
    if (!session.token || busyListingId) return;
    setBusyListingId(listing.id);
    setError('');
    setMessage('');
    try {
      await respondToListing(session.token, listing.id, action);
      setListings((current) => current.filter((item) => item.id !== listing.id));
      setMessage(
        action === 'accept'
          ? `${listing.businessName}'s listing is accepted and ready in your pickup inbox.`
          : `${listing.businessName}'s listing was declined.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} this listing.`);
    } finally {
      setBusyListingId('');
    }
  }

  useEffect(() => {
    if (!session.isAuthenticated || !session.token) return;
    let isActive = true;
    (async () => {
      setError('');
      try {
        const result = await getListings(session.token);
        if (!isActive) return;
        setListings(result.listings || []);
      } catch (err) {
        if (!isActive) return;
        setListings([]);
        setError(err instanceof Error ? err.message : 'Could not load listings');
      } finally {
        if (isActive) setLoading(false);
      }
    })();
    return () => {
      isActive = false;
    };
  }, [session.isAuthenticated, session.token]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((item) => {
      return (
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.businessName.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q)
      );
    });
  }, [query, listings]);

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentInset={insets}
      contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}>
      <ThemedView style={styles.container}>
        <ThemedView style={styles.titleContainer}>
          <ThemedText type="subtitle">Explore Listings</ThemedText>
          <ThemedText style={styles.centerText} themeColor="textSecondary">
            {session.user?.role === 'organization'
              ? 'Find resources offered by businesses, then accept or decline each match.'
              : 'Browse active resource offers from Brisio businesses.'}
          </ThemedText>
        </ThemedView>

        {!session.isAuthenticated ? (
          <ThemedView type="backgroundElement" style={styles.panel}>
            <ThemedText type="small">Create an account from Home to explore listings.</ThemedText>
          </ThemedView>
        ) : (
          <>
            <ThemedView type="backgroundElement" style={styles.panel}>
              <ThemedText type="smallBold">Search listings</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text }]}
                placeholder="Category, description, or location"
                placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                value={query}
                onChangeText={setQuery}
                accessibilityLabel="Search by category, description, or location"
              />
              <Pressable style={styles.refreshBtn} onPress={loadData}>
                <ThemedText type="smallBold">Refresh</ThemedText>
              </Pressable>
              {!!message && <ThemedText style={styles.successText}>{message}</ThemedText>}
              {!!message && session.user?.role === 'organization' ? (
                <Link href="/donation-inbox" asChild>
                  <Pressable style={styles.inboxBtn}>
                    <ThemedText type="smallBold">Open pickup inbox</ThemedText>
                  </Pressable>
                </Link>
              ) : null}
              {!!error && <ThemedText style={styles.errorText}>{error}</ThemedText>}
            </ThemedView>

            <ThemedView style={styles.sectionsWrapper}>
              {loading ? (
                <ThemedView style={styles.loadingRow}>
                  <ActivityIndicator size="small" />
                  <ThemedText type="small">Loading listings...</ThemedText>
                </ThemedView>
              ) : filtered.length === 0 ? (
                <ThemedView type="backgroundElement" style={styles.panel}>
                  <ThemedText type="small">No listings match your filter.</ThemedText>
                </ThemedView>
              ) : (
                filtered.slice(0, 25).map((item) => (
                  <ThemedView key={item.id} type="backgroundElement" style={styles.listingCard}>
                    <ThemedText type="smallBold">Offered by {item.businessName}</ThemedText>
                    <ThemedText type="small">
                      Available resource |{' '}
                      <ThemedText type="small" style={styles.categoryText}>{item.category}</ThemedText>
                    </ThemedText>
                    <ThemedText type="small">{item.description}</ThemedText>
                    {!!item.availabilityNotes && <ThemedText type="small">Timing: {item.availabilityNotes}</ThemedText>}
                    <ThemedText type="small">Address: {item.location || 'Address not set'}</ThemedText>
                    {session.user?.role === 'organization' ? (
                      <View style={styles.actionRow}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Accept listing from ${item.businessName}`}
                          style={[styles.acceptBtn, busyListingId === item.id && styles.disabledBtn]}
                          onPress={() => handleResponse(item, 'accept')}
                          disabled={Boolean(busyListingId)}>
                          {busyListingId === item.id ? (
                            <ActivityIndicator size="small" />
                          ) : (
                            <ThemedText type="smallBold">Accept</ThemedText>
                          )}
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Decline listing from ${item.businessName}`}
                          style={[styles.declineBtn, busyListingId === item.id && styles.disabledBtn]}
                          onPress={() => handleResponse(item, 'decline')}
                          disabled={Boolean(busyListingId)}>
                          <ThemedText type="smallBold">Decline</ThemedText>
                        </Pressable>
                      </View>
                    ) : null}
                  </ThemedView>
                ))
              )}
            </ThemedView>
          </>
        )}
      </ThemedView>
    </ScrollView>
  );
}

export default function TabTwoScreen() {
  return <ExploreContent />;
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  container: {
    maxWidth: MaxContentWidth,
    flexGrow: 1,
  },
  titleContainer: {
    gap: Spacing.three,
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
  },
  centerText: {
    textAlign: 'center',
  },
  categoryText: {
    textTransform: 'capitalize',
  },
  panel: {
    marginHorizontal: Spacing.four,
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  sectionsWrapper: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  input: {
    borderWidth: 1,
    borderColor: '#C7D0DD',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
    backgroundColor: '#FFFFFF',
  },
  refreshBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: '#BFC7D4',
    backgroundColor: '#F5F7FB',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
  },
  listingCard: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  acceptBtn: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: '#7EA58F',
    backgroundColor: '#E8F4ED',
  },
  declineBtn: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: '#C7CED8',
    backgroundColor: '#F5F7FA',
  },
  inboxBtn: {
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: '#8FAACB',
    backgroundColor: '#EAF2FC',
  },
  disabledBtn: {
    opacity: 0.55,
  },
  successText: {
    color: '#256A4A',
  },
  errorText: {
    color: '#B54840',
  },
});
