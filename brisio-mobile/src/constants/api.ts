import { API_BASE_URL } from '@/constants/config';

export type ApiUser = {
  id: string;
  email: string;
  role: 'business' | 'organization';
  displayName: string;
  organizationName: string;
  location: string;
  createdAt: string;
};

export type ApiListing = {
  id: string;
  type: 'supply' | 'demand';
  category: string;
  businessName: string;
  description: string;
  contact: string;
  location: string;
  active: number;
  ownerUserId: string;
  createdAt: string;
};

export type ApiEngagementMessage = {
  id: string;
  engagementId: string;
  senderUserId: string;
  senderName: string;
  body: string;
  etaNote?: string;
  locationNote?: string;
  createdAt: string;
};

export type ApiEngagement = {
  id: string;
  listingId: string;
  listingOwnerId: string;
  requesterUserId: string;
  status: 'requested' | 'accepted' | 'preparing' | 'on_the_way' | 'delivered' | 'completed' | 'declined' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  businessName?: string;
  category?: string;
  description?: string;
  location?: string;
  ownerDisplayName?: string;
  ownerOrganizationName?: string;
  requesterDisplayName?: string;
  requesterOrganizationName?: string;
  messages: ApiEngagementMessage[];
};

export type ApiReport = {
  id: string;
  listingId: string;
  reporterName: string;
  reason: string;
  details: string;
  createdAt: string;
};

export type ApiBlock = {
  id: string;
  blockerUserId: string;
  blockedUserId: string;
  createdAt: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string;
  body?: unknown;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const rawBody = await response.text();
  let payload: any = {};
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      if (!response.ok) {
        throw new Error('Server returned a non-JSON error response. Please update/redeploy the API server and try again.');
      }
      throw new Error('Server returned an unexpected response format.');
    }
  }

  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || 'Request failed');
  }

  return payload as T;
}

export async function registerUser(input: {
  email: string;
  password: string;
  role: 'business' | 'organization';
  name: string;
  organizationName: string;
  location: string;
}) {
  return apiRequest<{ success: true; token: string; user: ApiUser }>('/api/auth/register', {
    method: 'POST',
    body: input,
  });
}

export async function loginUser(input: { email: string; password: string }) {
  return apiRequest<{ success: true; token: string; user: ApiUser }>('/api/auth/login', {
    method: 'POST',
    body: input,
  });
}

export async function requestPasswordReset(input: { email: string }) {
  return apiRequest<{ success: true; message: string; resetCode?: string; expiresAt?: string }>('/api/auth/forgot-password', {
    method: 'POST',
    body: input,
  });
}

export async function confirmPasswordReset(input: { email: string; resetCode: string; password: string }) {
  return apiRequest<{ success: true; message: string }>('/api/auth/reset-password', {
    method: 'POST',
    body: input,
  });
}

export async function getMe(token: string) {
  return apiRequest<{ success: true; user: ApiUser }>('/api/auth/me', { token });
}

export async function logoutUser(token: string) {
  return apiRequest<{ success: true }>('/api/auth/logout', { method: 'POST', token });
}

export async function deleteUserAccount(token: string) {
  return apiRequest<{ success: true; message: string }>('/api/auth/account', {
    method: 'DELETE',
    token,
  });
}

export async function getListings(token: string) {
  return apiRequest<{ success: true; count: number; listings: ApiListing[] }>('/api/listings', { token });
}

export async function reportListing(
  token: string,
  input: { listingId: string; reason: string; details?: string }
) {
  return apiRequest<{ success: true; reportId: string }>('/api/reports', {
    method: 'POST',
    token,
    body: input,
  });
}

export async function blockUser(token: string, input: { blockedUserId: string }) {
  return apiRequest<{ success: true; blocked: boolean }>('/api/blocks', {
    method: 'POST',
    token,
    body: input,
  });
}

export async function unblockUser(token: string, blockedUserId: string) {
  return apiRequest<{ success: true; blocked: boolean }>(`/api/blocks/${encodeURIComponent(blockedUserId)}`, {
    method: 'DELETE',
    token,
  });
}

export async function createListing(
  token: string,
  input: {
    category: string;
    description: string;
    contact: string;
    location: string;
    urgencyLevel?: 'low' | 'medium' | 'high' | 'critical';
    deliverWithinHours?: string;
  }
) {
  return apiRequest<{ success: true; listing: ApiListing }>('/api/listings', {
    method: 'POST',
    token,
    body: input,
  });
}

export async function getEngagements(token: string) {
  return apiRequest<{ success: true; engagements: ApiEngagement[] }>('/api/engagements', { token });
}

export async function requestListingEngagement(token: string, listingId: string) {
  return apiRequest<{ success: true; engagementId: string }>(`/api/listings/${encodeURIComponent(listingId)}/requests`, {
    method: 'POST',
    token,
  });
}

export async function sendEngagementMessage(
  token: string,
  engagementId: string,
  input: { body: string; etaNote?: string; locationNote?: string }
) {
  return apiRequest<{ success: true; messageId: string }>(`/api/engagements/${encodeURIComponent(engagementId)}/messages`, {
    method: 'POST',
    token,
    body: input,
  });
}
