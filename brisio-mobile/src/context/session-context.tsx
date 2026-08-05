import { createContext, PropsWithChildren, useContext } from 'react';

import { useSession } from '@/hooks/use-session';

type SessionState = ReturnType<typeof useSession>;

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const session = useSession();
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSessionContext() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSessionContext must be used within SessionProvider');
  }
  return value;
}
