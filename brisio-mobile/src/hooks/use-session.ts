import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { ApiUser, getMe, loginUser, logoutUser, registerUser } from '@/constants/api';

const TOKEN_KEY = 'brisio-auth-token';

type RegisterInput = {
  email: string;
  password: string;
  role: 'business' | 'organization';
  name: string;
  organizationName: string;
  location: string;
};

export function useSession() {
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [user, setUser] = useState<ApiUser | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const savedToken = (await AsyncStorage.getItem(TOKEN_KEY)) || '';
      if (!savedToken) {
        setBooting(false);
        return;
      }

      try {
        const me = await getMe(savedToken);
        setToken(savedToken);
        setUser(me.user);
      } catch {
        await AsyncStorage.removeItem(TOKEN_KEY);
        setToken('');
        setUser(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  async function signIn(email: string, password: string) {
    setBusy(true);
    setError('');
    try {
      const response = await loginUser({ email, password });
      await AsyncStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setUser(response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function signUp(input: RegisterInput) {
    setBusy(true);
    setError('');
    try {
      const response = await registerUser(input);
      await AsyncStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setUser(response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      await logoutUser(token);
    } catch {
      // Ignore logout API errors; local token is still cleared.
    } finally {
      await AsyncStorage.removeItem(TOKEN_KEY);
      setToken('');
      setUser(null);
      setBusy(false);
    }
  }

  return {
    booting,
    busy,
    token,
    user,
    error,
    isAuthenticated: !!token && !!user,
    clearError: () => setError(''),
    signIn,
    signUp,
    signOut,
  };
}
