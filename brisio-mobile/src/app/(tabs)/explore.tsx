import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ApiListing, getListings, requestListingEngagement } from '@/constants/api';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';
import { useTheme } from '@/hooks/use-theme';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';

function ExploreContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const router = useRouter();
  const session = useSessionContext();
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState('');
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
    setStatusMessage('');
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

  async function startPrivateChat(item: ApiListing) {
    if (!session.token) return;
    setActionLoadingId(item.id);
    setError('');
    setStatusMessage('');
    try {
      const response = await requestListingEngagement(session.token, item.id);
      router.push({
        pathname: '/messages',
        params: { engagementId: response.engagementId },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start private chat.');
    } finally {
      setActionLoadingId('');
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
            Browse active offers and needs posted by the Brisio community.
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
              {!!statusMessage && <ThemedText style={styles.statusText}>{statusMessage}</ThemedText>}
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
                    <ThemedText type="smallBold">{item.businessName}</ThemedText>
                    <ThemedText type="small">
                      {item.type === 'supply' ? 'Business offer' : 'Nonprofit need'} | {item.category}
                    </ThemedText>
                    <ThemedText type="small">{item.description}</ThemedText>
                    <ThemedText type="small">{item.location || 'Location not set'}</ThemedText>
                    {item.ownerUserId !== session.user?.id &&
                    ((session.user?.role === 'organization' && item.type === 'supply') ||
                      (session.user?.role === 'business' && item.type === 'demand')) ? (
                      <ThemedView style={styles.actionRow}>
                        <Pressable
                          style={[styles.actionBtn, actionLoadingId === item.id && styles.actionBtnDisabled]}
                          onPress={() => startPrivateChat(item)}
                          disabled={actionLoadingId === item.id}>
                          <ThemedText type="smallBold">
                            {actionLoadingId === item.id
                              ? 'Opening private chat...'
                              : item.type === 'supply'
                                ? 'Request this offer'
                                : 'Offer help'}
                          </ThemedText>
                        </Pressable>
                      </ThemedView>
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
    paddingTop: Spacing.one,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: '#C7D0DD',
    backgroundColor: '#FFFFFF',
  },
  actionBtnDisabled: {
    opacity: 0.6,
  },
  statusText: {
    color: '#1C6B47',
  },
  errorText: {
    color: '#B54840',
  },
});
