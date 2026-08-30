import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiEngagement, getEngagements } from '@/constants/api';
import { useSessionContext } from '@/context/session-context';

const POLL_INTERVAL_MS = 10_000;

type ChatNotificationsState = {
  engagements: ApiEngagement[];
  unreadCount: number;
  refreshChats: () => Promise<void>;
  markChatsRead: () => Promise<void>;
};

const ChatNotificationsContext = createContext<ChatNotificationsState | null>(null);

function readStorageKey(userId: string) {
  return `brisio.chatLastReadAt.${userId}`;
}

export function ChatNotificationsProvider({ children }: PropsWithChildren) {
  const session = useSessionContext();
  const [engagements, setEngagements] = useState<ApiEngagement[]>([]);
  const [lastReadAt, setLastReadAt] = useState('');

  const refreshChats = useCallback(async () => {
    if (!session.token) {
      setEngagements([]);
      return;
    }
    try {
      const response = await getEngagements(session.token);
      setEngagements(response.engagements || []);
    } catch {
      // The chat screen reports request errors; background badge refreshes stay quiet.
    }
  }, [session.token]);

  useEffect(() => {
    const userId = session.user?.id;
    if (!userId) return;

    let active = true;
    AsyncStorage.getItem(readStorageKey(userId)).then((value) => {
      if (active) setLastReadAt(value || '');
    });
    return () => {
      active = false;
    };
  }, [session.user?.id]);

  useEffect(() => {
    if (!session.token) return;
    const initialRefresh = setTimeout(refreshChats, 0);
    const interval = setInterval(refreshChats, POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshChats();
    });
    return () => {
      clearTimeout(initialRefresh);
      clearInterval(interval);
      subscription.remove();
    };
  }, [refreshChats, session.token]);

  const unreadCount = useMemo(() => {
    const userId = session.user?.id;
    const readTime = lastReadAt ? new Date(lastReadAt).getTime() : 0;
    if (!userId) return 0;

    return engagements.reduce((count, engagement) => {
      const incomingRequest = engagement.listingOwnerId === userId && engagement.status === 'requested';
      const requestUnread = incomingRequest && new Date(engagement.createdAt).getTime() > readTime ? 1 : 0;
      const unreadMessages = (engagement.messages || []).filter(
        (message) => message.senderUserId !== userId && new Date(message.createdAt).getTime() > readTime
      ).length;
      return count + requestUnread + unreadMessages;
    }, 0);
  }, [engagements, lastReadAt, session.user?.id]);

  const markChatsRead = useCallback(async () => {
    const userId = session.user?.id;
    if (!userId) return;
    const now = new Date().toISOString();
    setLastReadAt(now);
    await AsyncStorage.setItem(readStorageKey(userId), now);
  }, [session.user?.id]);

  const value = useMemo(
    () => ({ engagements, unreadCount, refreshChats, markChatsRead }),
    [engagements, markChatsRead, refreshChats, unreadCount]
  );

  return <ChatNotificationsContext.Provider value={value}>{children}</ChatNotificationsContext.Provider>;
}

export function useChatNotifications() {
  const value = useContext(ChatNotificationsContext);
  if (!value) throw new Error('useChatNotifications must be used within ChatNotificationsProvider');
  return value;
}