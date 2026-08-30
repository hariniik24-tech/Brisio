import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ApiListing, blockUser, getListings, reportListing } from '@/constants/api';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';
import { useTheme } from '@/hooks/use-theme';

function ExploreContent() {
  const safeAreaInsets = useSafeAreaInsets();
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

  async function handleReport(item: ApiListing, reason: string) {
    if (!session.token) return;
    setActionLoadingId(item.id);
    setError('');
    setStatusMessage('');
    try {
      await reportListing(session.token, {
        listingId: item.id,
        reason,
        details: `${item.businessName} | ${item.description}`,
      });
      setStatusMessage('Report submitted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit report');
    } finally {
      setActionLoadingId('');
    }
  }

  async function handleBlock(item: ApiListing) {
    if (!session.token) return;
    setActionLoadingId(item.id);
    setError('');
    setStatusMessage('');
    try {
      await blockUser(session.token, { blockedUserId: item.ownerUserId });
      setStatusMessage('Blocked this user. Their listings are now hidden.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not block user');
    } finally {
      setActionLoadingId('');
    }
  }

  function openReportMenu(item: ApiListing) {
    Alert.alert('Report listing', 'Choose the reason that best matches this listing.', [
      { text: 'Spam', onPress: () => void handleReport(item, 'Spam') },
      { text: 'Inappropriate', onPress: () => void handleReport(item, 'Inappropriate content') },
      { text: 'Harassment', onPress: () => void handleReport(item, 'Harassment') },
      { text: 'Cancel', style: 'cancel' },
    ]);
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
              <TextInput
                style={styles.input}
                placeholder="Search category, description, location"
                value={query}
                onChangeText={setQuery}
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
                    {item.ownerUserId !== session.user?.id ? (
                      <ThemedView style={styles.actionRow}>
                        <Pressable
                          style={[styles.actionBtn, actionLoadingId === item.id && styles.actionBtnDisabled]}
                          onPress={() => openReportMenu(item)}
                          disabled={actionLoadingId === item.id}>
                          <ThemedText type="smallBold">Report</ThemedText>
                        </Pressable>
                        <Pressable
                          style={[styles.actionBtn, styles.blockBtn, actionLoadingId === item.id && styles.actionBtnDisabled]}
                          onPress={() => handleBlock(item)}
                          disabled={actionLoadingId === item.id}>
                          <ThemedText type="smallBold">Block</ThemedText>
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
  blockBtn: {
    backgroundColor: '#FFF5F3',
    borderColor: '#E8B7AE',
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
