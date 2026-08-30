import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import {
  ApiEngagement,
  ApiListing,
  getEngagements,
  getListings,
  requestListingEngagement,
  sendEngagementMessage,
  updateEngagementStatus,
} from '@/constants/api';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useChatNotifications } from '@/context/chat-notifications-context';
import { useSessionContext } from '@/context/session-context';
import { StackScreenShell } from '@/components/stack-screen-shell';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

const INPUT_PLACEHOLDER_COLOR = '#6A7685';

function getConversationLabel(engagement: ApiEngagement, userId?: string) {
  const owner = engagement.ownerOrganizationName || engagement.ownerDisplayName || 'Listing owner';
  const requester = engagement.requesterOrganizationName || engagement.requesterDisplayName || 'Requester';
  return engagement.listingOwnerId === userId ? requester : owner;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatStatus(status: ApiEngagement['status']) {
  return status.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export default function ChatsScreen() {
  const { engagementId } = useLocalSearchParams<{ engagementId?: string }>();
  const router = useRouter();
  const session = useSessionContext();
  const { markChatsRead, refreshChats } = useChatNotifications();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [engagements, setEngagements] = useState<ApiEngagement[]>([]);
  const [availableListings, setAvailableListings] = useState<ApiListing[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [startingListingId, setStartingListingId] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const selected = useMemo(
    () => engagements.find((item) => item.id === selectedId) || null,
    [engagements, selectedId]
  );

  const chatOptions = useMemo(() => {
    const user = session.user;
    if (!user) return [];
    const activeListingIds = new Set(
      engagements
        .filter((item) => !['declined', 'cancelled', 'completed'].includes(item.status))
        .map((item) => item.listingId)
    );
    return availableListings.filter((listing) => {
      const oppositeRoleListing =
        (user.role === 'organization' && listing.type === 'supply') ||
        (user.role === 'business' && listing.type === 'demand');
      return listing.ownerUserId !== user.id && oppositeRoleListing && !activeListingIds.has(listing.id);
    });
  }, [availableListings, engagements, session.user]);

  const loadConversations = useCallback(async (showLoading = true) => {
    if (!session.token) return false;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const [response, listingsResponse] = await Promise.all([
        getEngagements(session.token),
        getListings(session.token),
      ]);
      const rows = response.engagements || [];
      setEngagements(rows);
      setAvailableListings(listingsResponse.listings || []);

      const requestedId = typeof engagementId === 'string' ? engagementId : '';
      setSelectedId((currentId) => {
        if (requestedId && rows.some((item) => item.id === requestedId)) return requestedId;
        if (!currentId && rows.length > 0) return rows[0].id;
        if (currentId && !rows.some((item) => item.id === currentId)) return rows[0]?.id || '';
        return currentId;
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load private chats.');
      setEngagements([]);
      setSelectedId('');
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [engagementId, session.token]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const refreshVisibleChats = async (showLoading = false) => {
        const loaded = await loadConversations(showLoading);
        if (!active || !loaded) return;
        await refreshChats();
        await markChatsRead();
      };

      refreshVisibleChats(true);
      const interval = setInterval(refreshVisibleChats, 5_000);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [loadConversations, markChatsRead, refreshChats])
  );

  async function sendMessage() {
    if (!session.token || !selected) return;
    const body = draft.trim();
    if (!body) return;

    setSending(true);
    setError('');
    try {
      await sendEngagementMessage(session.token, selected.id, { body });
      setDraft('');
      await loadConversations(false);
      await refreshChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSending(false);
    }
  }

  async function startChat(listing: ApiListing) {
    if (!session.token) return;
    setStartingListingId(listing.id);
    setError('');
    try {
      const response = await requestListingEngagement(session.token, listing.id);
      await loadConversations(false);
      setSelectedId(response.engagementId);
      await refreshChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send this request.');
    } finally {
      setStartingListingId('');
    }
  }

  async function changeRequestStatus(status: 'accepted' | 'declined' | 'cancelled') {
    if (!session.token || !selected) return;
    setStatusBusy(true);
    setError('');
    try {
      await updateEngagementStatus(session.token, selected.id, status);
      await loadConversations(false);
      await refreshChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this request.');
    } finally {
      setStatusBusy(false);
    }
  }

  if (!session.isAuthenticated) {
    return (
      <StackScreenShell footer={<View style={styles.tabClearance} />}>
          <ThemedText type="subtitle">Private Chats</ThemedText>
          <ThemedText type="small">Sign in to access your business and nonprofit conversations.</ThemedText>
          <Link href="/" asChild>
            <Pressable style={styles.linkBtn}>
              <ThemedText type="smallBold">Go to Sign in</ThemedText>
            </Pressable>
          </Link>
      </StackScreenShell>
    );
  }

  return (
    <StackScreenShell footer={<View style={styles.tabClearance} />}>
      <Pressable onPress={() => router.push('/')} style={styles.backBtn} hitSlop={10}>
        <ThemedText type="smallBold">Back to Home</ThemedText>
      </Pressable>

      <ThemedText type="subtitle">Chats</ThemedText>

      <ThemedView style={styles.startPanel}>
        <ThemedText type="smallBold">Send a new request</ThemedText>
        {chatOptions.length === 0 ? (
          <ThemedText style={styles.startEmptyText}>No new matching listings are available.</ThemedText>
        ) : (
          chatOptions.slice(0, 10).map((listing) => (
            <View key={listing.id} style={styles.startListingRow}>
              <View style={styles.startListingDetails}>
                <ThemedText type="smallBold">{listing.businessName}</ThemedText>
                <ThemedText style={styles.threadPreview} numberOfLines={2}>{listing.description}</ThemedText>
                <ThemedText style={styles.statusText}>{listing.category} · {listing.location || 'Location not set'}</ThemedText>
              </View>
              <Pressable
                accessibilityLabel={`Send request to ${listing.businessName}`}
                style={[styles.startBtn, startingListingId === listing.id && styles.disabledBtn]}
                onPress={() => startChat(listing)}
                disabled={Boolean(startingListingId)}>
                <ThemedText style={styles.startBtnText}>
                  {startingListingId === listing.id ? 'Sending...' : 'Request'}
                </ThemedText>
              </Pressable>
            </View>
          ))
        )}
      </ThemedView>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" />
          <ThemedText type="small">Loading conversations...</ThemedText>
        </View>
      ) : engagements.length === 0 ? (
        <ThemedView style={styles.emptyPanel}>
          <ThemedText type="small">No private conversations yet.</ThemedText>
          <ThemedText type="small">Send a request above. Messaging opens after the listing owner accepts.</ThemedText>
        </ThemedView>
      ) : (
        <>
          <ThemedView style={styles.threadPanel}>
            <View style={styles.threadList}>
              {engagements.map((item) => (
                <Pressable
                  key={item.id}
                  style={[styles.threadBtn, selectedId === item.id && styles.threadBtnActive]}
                  onPress={() => setSelectedId(item.id)}>
                  <View style={styles.threadHeading}>
                    <ThemedText type="smallBold">{getConversationLabel(item, session.user?.id)}</ThemedText>
                    <ThemedText style={styles.threadTime}>{formatDate(item.updatedAt || item.createdAt)}</ThemedText>
                  </View>
                  <ThemedText style={styles.threadPreview} numberOfLines={1}>
                    {(item.messages || []).at(-1)?.body || item.description || 'Listing conversation'}
                  </ThemedText>
                  <ThemedText style={styles.statusText}>{formatStatus(item.status)}</ThemedText>
                </Pressable>
              ))}
            </View>
          </ThemedView>

          {selected ? (
            <ThemedView style={styles.chatPanel}>
              <View style={styles.chatHeader}>
                <View style={styles.avatar}>
                  <ThemedText style={styles.avatarText}>
                    {getConversationLabel(selected, session.user?.id).slice(0, 1).toUpperCase()}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold">{getConversationLabel(selected, session.user?.id)}</ThemedText>
                <ThemedText style={styles.listingSummary} numberOfLines={1}>
                  {selected.description || 'Listing conversation'}
                </ThemedText>
              </View>

              {selected.status === 'requested' && selected.listingOwnerId === session.user?.id ? (
                <View style={styles.requestActions}>
                  <ThemedText type="small">Accept the request to open messaging.</ThemedText>
                  <Pressable
                    style={[styles.primaryBtn, statusBusy && styles.disabledBtn]}
                    onPress={() => changeRequestStatus('accepted')}
                    disabled={statusBusy}>
                    <ThemedText type="smallBold">{statusBusy ? 'Updating...' : 'Accept request'}</ThemedText>
                  </Pressable>
                  <Pressable
                    style={[styles.linkBtn, statusBusy && styles.disabledBtn]}
                    onPress={() => changeRequestStatus('declined')}
                    disabled={statusBusy}>
                    <ThemedText type="smallBold">Decline request</ThemedText>
                  </Pressable>
                </View>
              ) : null}

              {selected.status === 'requested' && selected.requesterUserId === session.user?.id ? (
                <ThemedText style={styles.waitingText}>Waiting for the listing owner to accept.</ThemedText>
              ) : null}

              {selected.status === 'accepted' ? (
                <>
                  <ThemedText style={styles.acceptedText}>Request accepted</ThemedText>
                  <View style={styles.messageList}>
                    {(selected.messages || []).length === 0 ? (
                      <ThemedText style={styles.noMessagesText}>No messages yet</ThemedText>
                    ) : (
                      selected.messages.map((message) => {
                        const mine = message.senderUserId === session.user?.id;
                        return (
                          <View key={message.id} style={[styles.messageRow, mine ? styles.myMessageRow : styles.otherMessageRow]}>
                            {!mine ? <ThemedText style={styles.senderName}>{message.senderName}</ThemedText> : null}
                            <View style={[styles.messageBubble, mine ? styles.myMessageBubble : styles.otherMessageBubble]}>
                              <ThemedText style={mine ? styles.myMessageText : styles.otherMessageText}>
                                {message.body}
                              </ThemedText>
                            </View>
                            <ThemedText style={styles.messageTime}>{formatDate(message.createdAt)}</ThemedText>
                          </View>
                        );
                      })
                    )}
                  </View>

                  <View style={styles.composerRow}>
                    <TextInput
                      style={styles.input}
                      placeholder="Message"
                      placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                      multiline
                      value={draft}
                      onChangeText={setDraft}
                    />
                    <Pressable
                      accessibilityLabel="Send message"
                      style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
                      onPress={sendMessage}
                      disabled={!draft.trim() || sending}>
                      <ThemedText style={styles.sendIcon}>↑</ThemedText>
                    </Pressable>
                  </View>
                </>
              ) : selected.status !== 'requested' ? (
                <ThemedText style={styles.waitingText}>Messaging is unavailable for this request.</ThemedText>
              ) : null}
            </ThemedView>
          ) : null}
        </>
      )}

      {!!error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
    </StackScreenShell>
  );
}

const styles = StyleSheet.create({
  tabClearance: {
    height: BottomTabInset,
  },
  backBtn: {
    alignSelf: 'flex-start',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyPanel: {
    borderWidth: 1,
    borderColor: '#DCE4EE',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    backgroundColor: '#FAFCFF',
  },
  startPanel: {
    borderWidth: 1,
    borderColor: '#DCE4EE',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    backgroundColor: '#FFFFFF',
  },
  startEmptyText: {
    color: '#6A7685',
    fontSize: 13,
  },
  startListingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: '#E4E9F0',
  },
  startListingDetails: {
    flex: 1,
    gap: 3,
  },
  startBtn: {
    minWidth: 64,
    minHeight: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    backgroundColor: '#3478C9',
  },
  startBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  threadPanel: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#DCE4EE',
    borderRadius: Spacing.three,
    backgroundColor: '#FFFFFF',
  },
  threadList: {
    gap: 0,
  },
  threadBtn: {
    borderBottomWidth: 1,
    borderBottomColor: '#E1E6ED',
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    gap: Spacing.one,
    backgroundColor: '#FFFFFF',
  },
  threadBtnActive: {
    backgroundColor: '#EEF5FD',
  },
  threadHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  threadTime: {
    color: '#7A8797',
    fontSize: 12,
  },
  threadPreview: {
    color: '#5A687A',
    fontSize: 14,
  },
  statusText: {
    color: '#476C9D',
    fontSize: 12,
  },
  chatPanel: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#DCE4EE',
    borderRadius: Spacing.three,
    backgroundColor: '#FFFFFF',
  },
  chatHeader: {
    alignItems: 'center',
    padding: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: '#E4E9F0',
    gap: Spacing.one,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCEBFA',
  },
  avatarText: {
    color: '#315E91',
    fontSize: 18,
    fontWeight: '700',
  },
  listingSummary: {
    maxWidth: '90%',
    color: '#6A7685',
    fontSize: 12,
  },
  acceptedText: {
    alignSelf: 'center',
    color: '#46705A',
    fontSize: 12,
    paddingTop: Spacing.two,
  },
  waitingText: {
    padding: Spacing.three,
    color: '#5A687A',
    textAlign: 'center',
  },
  noMessagesText: {
    color: '#7A8797',
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  messageList: {
    gap: 10,
    padding: Spacing.three,
    backgroundColor: '#F8FAFD',
  },
  requestActions: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  messageRow: {
    width: '100%',
    gap: 3,
  },
  myMessageRow: {
    alignItems: 'flex-end',
  },
  otherMessageRow: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '82%',
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  myMessageBubble: {
    borderBottomRightRadius: 5,
    backgroundColor: '#3478C9',
  },
  otherMessageBubble: {
    borderBottomLeftRadius: 5,
    backgroundColor: '#E7EBF0',
  },
  myMessageText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 21,
  },
  otherMessageText: {
    color: '#172538',
    fontSize: 16,
    lineHeight: 21,
  },
  senderName: {
    marginLeft: Spacing.two,
    color: '#6A7685',
    fontSize: 11,
  },
  messageTime: {
    marginHorizontal: Spacing.two,
    color: '#8894A3',
    fontSize: 10,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: '#E4E9F0',
    backgroundColor: '#FFFFFF',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#C3CDDB',
    borderRadius: 20,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    minHeight: 40,
    maxHeight: 112,
    textAlignVertical: 'top',
    backgroundColor: '#FFFFFF',
    color: '#1C2735',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3478C9',
  },
  sendBtnDisabled: {
    backgroundColor: '#B8C2CE',
  },
  sendIcon: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 27,
    fontWeight: '700',
  },
  primaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.three,
    borderWidth: 1,
    borderColor: '#476C9D',
    backgroundColor: '#CFE1F8',
  },
  linkBtn: {
    borderWidth: 1,
    borderColor: '#CDD5E1',
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    backgroundColor: '#FAFBFD',
    alignSelf: 'flex-start',
  },
  errorText: {
    color: '#B54840',
  },
});