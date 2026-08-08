import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ApiListing, createListing, getListings } from '@/constants/api';
import { API_BASE_URL } from '@/constants/config';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSessionContext } from '@/context/session-context';
import { Link } from 'expo-router';

type Stats = {
  total: number;
  supply: number;
  demand: number;
  reports: number;
};

type ListingForm = {
  category: string;
  description: string;
  contact: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
  deliverWithinHours: string;
};

const emptyStats: Stats = { total: 0, supply: 0, demand: 0, reports: 0 };
const initialForm: ListingForm = {
  category: 'other',
  description: '',
  contact: '',
  street: '',
  city: '',
  state: '',
  zip: '',
  urgencyLevel: 'medium',
  deliverWithinHours: '',
};

function formatAddress(street: string, city: string, stateCode: string, zip: string) {
  return [street.trim(), city.trim(), stateCode.trim(), zip.trim()].filter(Boolean).join(', ');
}

function getPasswordPolicyError(password: string) {
  const value = password.trim();
  if (value.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Z]/.test(value)) return 'Password must include at least one uppercase letter.';
  if (!/[a-z]/.test(value)) return 'Password must include at least one lowercase letter.';
  if (!/\d/.test(value)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must include at least one special character.';
  return '';
}

export default function HomeScreen() {
  const session = useSessionContext();
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState('');

  const [listings, setListings] = useState<ApiListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'business' | 'organization'>('business');
  const [organizationName, setOrganizationName] = useState('');
  const [authStreet, setAuthStreet] = useState('');
  const [authCity, setAuthCity] = useState('');
  const [authState, setAuthState] = useState('');
  const [authZip, setAuthZip] = useState('');

  const [form, setForm] = useState<ListingForm>(initialForm);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

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
        total: payload.stats.total || 0,
        supply: payload.stats.supply || 0,
        demand: payload.stats.demand || 0,
        reports: payload.stats.reports || 0,
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
          total: payload.stats.total || 0,
          supply: payload.stats.supply || 0,
          demand: payload.stats.demand || 0,
          reports: payload.stats.reports || 0,
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

  async function submitAuth() {
    if (!email.trim() || !password.trim()) return;
    session.clearError();
    const passwordError = getPasswordPolicyError(password);
    if (passwordError) {
      setFormError(passwordError);
      return;
    }

    setFormError('');
    const location = formatAddress(authStreet, authCity, authState, authZip);
    await session.signUp({
      email: email.trim(),
      password,
      role,
      name: name.trim(),
      organizationName: organizationName.trim(),
      location,
    });
  }

  async function submitListing() {
    if (!session.token || !session.user) return;
    setFormError('');
    setFormSuccess('');

    if (!form.category.trim() || !form.description.trim()) {
      setFormError('Category and description are required.');
      return;
    }

    const listingLocation = formatAddress(form.street, form.city, form.state, form.zip);
    if (!listingLocation) {
      setFormError('Street, city, state, and ZIP code are required.');
      return;
    }

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
        location: listingLocation,
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
          <ThemedView style={styles.heroSection}>
            <ThemedText type="title" style={styles.title}>
              Brisio Mobile
            </ThemedText>
            <ThemedText type="small" style={styles.subtitle}>
              Bridging resources. Strengthening communities.
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.panel}>
            <ThemedText type="smallBold">App Store pages</ThemedText>
            <ThemedView style={styles.linkGrid}>
              <Link href="/privacy-policy" asChild>
                <Pressable style={styles.linkBtn}>
                  <ThemedText type="smallBold">Privacy</ThemedText>
                </Pressable>
              </Link>
              <Link href="/terms" asChild>
                <Pressable style={styles.linkBtn}>
                  <ThemedText type="smallBold">Terms</ThemedText>
                </Pressable>
              </Link>
              <Link href="/support" asChild>
                <Pressable style={styles.linkBtn}>
                  <ThemedText type="smallBold">Support</ThemedText>
                </Pressable>
              </Link>
              <Link href="/delete-account" asChild>
                <Pressable style={styles.linkBtn}>
                  <ThemedText type="smallBold">Delete account</ThemedText>
                </Pressable>
              </Link>
              <Link href="/reviewer-info" asChild>
                <Pressable style={styles.linkBtn}>
                  <ThemedText type="smallBold">Reviewer info</ThemedText>
                </Pressable>
              </Link>
            </ThemedView>
          </ThemedView>

          {!session.isAuthenticated ? (
            <ThemedView type="backgroundElement" style={styles.panel}>
              <ThemedText type="smallBold">Create your account</ThemedText>

              <TextInput
                style={styles.input}
                placeholder="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <ThemedText type="small" style={styles.helperText}>
                Password must be at least 10 characters and include uppercase, lowercase, number, and special character.
              </ThemedText>

              <TextInput
                style={styles.input}
                placeholder="Your name"
                value={name}
                onChangeText={setName}
              />
              <TextInput
                style={styles.input}
                placeholder="Nonprofit or business name"
                value={organizationName}
                onChangeText={setOrganizationName}
              />
              <TextInput
                style={styles.input}
                placeholder="Street address"
                value={authStreet}
                onChangeText={setAuthStreet}
              />
              <TextInput
                style={styles.input}
                placeholder="City"
                value={authCity}
                onChangeText={setAuthCity}
              />
              <TextInput
                style={styles.input}
                placeholder="State"
                value={authState}
                onChangeText={setAuthState}
              />
              <TextInput
                style={styles.input}
                placeholder="ZIP code"
                value={authZip}
                onChangeText={setAuthZip}
              />
              <View style={styles.modeRow}>
                <Pressable
                  style={[styles.modeBtn, role === 'business' && styles.modeBtnActive]}
                  onPress={() => setRole('business')}>
                  <ThemedText type="smallBold">Business</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.modeBtn, role === 'organization' && styles.modeBtnActive]}
                  onPress={() => setRole('organization')}>
                  <ThemedText type="smallBold">Nonprofit</ThemedText>
                </Pressable>
              </View>

              <Pressable style={styles.primaryBtn} onPress={submitAuth}>
                <ThemedText type="smallBold">{session.busy ? 'Please wait...' : 'Continue'}</ThemedText>
              </Pressable>
              {!!session.error && <ThemedText style={styles.errorText}>{session.error}</ThemedText>}
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
                <ThemedText type="small">API endpoint: {endpoint}</ThemedText>
                <Pressable style={styles.secondaryBtn} onPress={session.signOut}>
                  <ThemedText type="smallBold">Sign out</ThemedText>
                </Pressable>
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.panel}>
                <ThemedText type="smallBold">Create listing</ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder="Category (space, time, equipment, service, food, other)"
                  value={form.category}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, category: value }))}
                />
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  placeholder="Description"
                  multiline
                  value={form.description}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, description: value }))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Contact"
                  value={form.contact}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, contact: value }))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Street address"
                  value={form.street}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, street: value }))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="City"
                  value={form.city}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, city: value }))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="State"
                  value={form.state}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, state: value }))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="ZIP code"
                  value={form.zip}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, zip: value }))}
                />
                {session.user.role === 'organization' ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Urgency (low/medium/high/critical)"
                    value={form.urgencyLevel}
                    onChangeText={(value) =>
                      setForm((prev) => ({ ...prev, urgencyLevel: (value as ListingForm['urgencyLevel']) || 'medium' }))
                    }
                  />
                ) : (
                  <TextInput
                    style={styles.input}
                    placeholder="Deliver within hours (optional)"
                    keyboardType="numeric"
                    value={form.deliverWithinHours}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, deliverWithinHours: value }))}
                  />
                )}
                <Pressable style={styles.primaryBtn} onPress={submitListing}>
                  <ThemedText type="smallBold">Post listing</ThemedText>
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
                        {item.category} | {item.type}
                      </ThemedText>
                      <ThemedText type="small">{item.description}</ThemedText>
                    </ThemedView>
                  ))
                )}
              </ThemedView>
            </>
          )}

          <ThemedView type="backgroundElement" style={styles.panel}>
            <ThemedText type="smallBold">Platform stats</ThemedText>
            {statsLoading ? (
              <ThemedView style={styles.loadingRow}>
                <ActivityIndicator size="small" />
                <ThemedText type="small">Loading live stats...</ThemedText>
              </ThemedView>
            ) : (
              <ThemedText type="small">Connected stats shown below.</ThemedText>
            )}
            {!!statsError && <ThemedText style={styles.errorText}>{statsError}</ThemedText>}
          </ThemedView>

          <ThemedView style={styles.statsGrid}>
            <ThemedView type="backgroundElement" style={styles.statTile}>
              <ThemedText type="small">Listings</ThemedText>
              <ThemedText type="subtitle">{stats.total}</ThemedText>
            </ThemedView>
            <ThemedView type="backgroundElement" style={styles.statTile}>
              <ThemedText type="small">Supply</ThemedText>
              <ThemedText type="subtitle">{stats.supply}</ThemedText>
            </ThemedView>
            <ThemedView type="backgroundElement" style={styles.statTile}>
              <ThemedText type="small">Demand</ThemedText>
              <ThemedText type="subtitle">{stats.demand}</ThemedText>
            </ThemedView>
            <ThemedView type="backgroundElement" style={styles.statTile}>
              <ThemedText type="small">Reports</ThemedText>
              <ThemedText type="subtitle">{stats.reports}</ThemedText>
            </ThemedView>
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
  },
  contentContainer: {
    flexGrow: 1,
    alignItems: 'center',
    paddingBottom: BottomTabInset + Spacing.three,
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
  },
  heroSection: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  title: {
    textAlign: 'left',
  },
  subtitle: {
    opacity: 0.82,
  },
  panel: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  linkGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  linkBtn: {
    borderWidth: 1,
    borderColor: '#BFC7D4',
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: '#F5F7FB',
  },
  modeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  modeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#BFC7D4',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: '#E8EEF8',
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
  multilineInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: '#7FA3C9',
    backgroundColor: '#E8F1FB',
  },
  secondaryBtn: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: '#C8CFDA',
    backgroundColor: '#F5F7FB',
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
    opacity: 0.72,
  },
  successText: {
    color: '#256A4A',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  statTile: {
    width: '48%',
    minWidth: 140,
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
  },
  listingItem: {
    borderWidth: 1,
    borderColor: '#D6DEE8',
    borderRadius: Spacing.three,
    padding: Spacing.two,
    gap: Spacing.one,
  },
});
