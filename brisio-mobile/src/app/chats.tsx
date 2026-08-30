import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import {
  ApiEngagement,
  getEngagements,
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

function getConversationLabel(engagement: ApiEngagement) {
  const business = engagement.ownerOrganizationName || engagement.ownerDisplayName || 'Business';
  const nonprofit = engagement.requesterOrganizationName || engagement.requesterDisplayName || 'Nonprofit';
  return `${business} and ${nonprofit}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function ChatsScreen() {
  const { engagementId } = useLocalSearchParams<{ engagementId?: string }>();
  const router = useRouter();
  const session = useSessionContext();
  const { markChatsRead, refreshChats } = useChatNotifications();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [engagements, setEngagements] = useState<ApiEngagement[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const selected = useMemo(
    () => engagements.find((item) => item.id === selectedId) || null,
    [engagements, selectedId]
  );

  const loadConversations = useCallback(async (showLoading = true) => {
    if (!session.token) return false;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const response = await getEngagements(session.token);
      const rows = response.engagements || [];
      setEngagements(rows);

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

        <ThemedText type="subtitle">Private Business and Nonprofit Chats</ThemedText>
        <ThemedText type="small">
          Each conversation is private to the specific business and nonprofit connected to that listing.
        </ThemedText>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" />
            <ThemedText type="small">Loading conversations...</ThemedText>
          </View>
        ) : engagements.length === 0 ? (
          <ThemedView style={styles.panel}>
            <ThemedText type="small">No private conversations yet.</ThemedText>
            <ThemedText type="small">
              Open Explore and tap Request this offer or Offer help on a listing to begin.
            </ThemedText>
          </ThemedView>
        ) : (
          <>
            <ThemedView style={styles.panel}>
              <ThemedText type="smallBold">Conversations</ThemedText>
              <View style={styles.threadList}>
                {engagements.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.threadBtn, selectedId === item.id && styles.threadBtnActive]}
                    onPress={() => setSelectedId(item.id)}>
                    <ThemedText type="smallBold">{getConversationLabel(item)}</ThemedText>
                    <ThemedText type="small">Status: {item.status}</ThemedText>
                    <ThemedText type="small">{item.category || 'other'} | {item.location || 'no location'}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </ThemedView>

            {selected ? (
              <ThemedView style={styles.panel}>
                <ThemedText type="smallBold">{getConversationLabel(selected)}</ThemedText>
                <ThemedText type="small">{selected.description || 'No listing description.'}</ThemedText>

                {selected.status === 'requested' && selected.listingOwnerId === session.user?.id ? (
                  <View style={styles.requestActions}>
                    <ThemedText type="small">Accept the request to confirm that you can help.</ThemedText>
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
                  <ThemedText type="small">Request sent. Waiting for the listing owner to respond.</ThemedText>
                ) : null}

                {selected.status === 'accepted' ? (
                  <ThemedText type="small">Request accepted. Use this private chat to coordinate pickup or delivery.</ThemedText>
                ) : null}

                {selected.status === 'accepted' ? (
                  <>
                    <View style={styles.messageList}>
                      {(selected.messages || []).length === 0 ? (
                        <ThemedText type="small">No messages yet. Send the first message to coordinate timing.</ThemedText>
                      ) : (
                        selected.messages.map((message) => {
                          const mine = message.senderUserId === session.user?.id;
                          return (
                            <ThemedView
                              key={message.id}
                              style={[styles.messageBubble, mine ? styles.myMessageBubble : styles.otherMessageBubble]}>
                              <ThemedText type="smallBold">{mine ? 'You' : message.senderName}</ThemedText>
                              <ThemedText type="small">{message.body}</ThemedText>
                              <ThemedText type="small">{formatDate(message.createdAt)}</ThemedText>
                            </ThemedView>
                          );
                        })
                      )}
                    </View>

                    <TextInput
                      style={styles.input}
                      placeholder="Message about delivery time or pickup details"
                      placeholderTextColor={INPUT_PLACEHOLDER_COLOR}
                      multiline
                      value={draft}
                      onChangeText={setDraft}
                    />
                    <Pressable
                      style={[styles.primaryBtn, sending && styles.disabledBtn]}
                      onPress={sendMessage}
                      disabled={sending}>
                      <ThemedText type="smallBold">{sending ? 'Sending...' : 'Send private message'}</ThemedText>
                    </Pressable>
                  </>
                ) : (
                  <ThemedText type="small">Messaging opens after the listing owner accepts this request.</ThemedText>
                )}
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
  panel: {
    borderWidth: 1,
    borderColor: '#DCE4EE',
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.two,
    backgroundColor: '#FAFCFF',
  },
  threadList: {
    gap: Spacing.two,
  },
  threadBtn: {
    borderWidth: 1,
    borderColor: '#CDD5E1',
    borderRadius: Spacing.three,
    padding: Spacing.two,
    gap: Spacing.one,
    backgroundColor: '#FFFFFF',
  },
  threadBtnActive: {
    borderColor: '#95AECF',
    backgroundColor: '#EEF5FD',
  },
  messageList: {
    gap: Spacing.two,
  },
  requestActions: {
    gap: Spacing.two,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  messageBubble: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.two,
    gap: Spacing.one,
  },
  myMessageBubble: {
    borderColor: '#A9C3E4',
    backgroundColor: '#EAF3FF',
  },
  otherMessageBubble: {
    borderColor: '#D5DDE8',
    backgroundColor: '#FFFFFF',
  },
  input: {
    borderWidth: 1,
    borderColor: '#C3CDDB',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    minHeight: 84,
    textAlignVertical: 'top',
    backgroundColor: '#FFFFFF',
    color: '#1C2735',
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