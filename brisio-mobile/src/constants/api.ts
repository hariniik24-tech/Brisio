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

export type ApiOrganization = {
  id: string;
  displayName: string;
  organizationName: string;
  location: string;
};

export type ApiScannedProduct = {
  gtin: string;
  upc: string;
  name: string;
  brand: string;
  category: string;
};

export type ApiDonationRecord = {
  id: string;
  status: 'posted' | 'accepted' | 'declined' | 'received' | 'cancelled';
  createdAt: string;
};

export type ApiDonationStatus = 'posted' | 'accepted' | 'declined' | 'received' | 'cancelled';

export type ApiDonation = {
  id: string;
  status: ApiDonationStatus;
  donorOrgId: string;
  recipientOrgId: string;
  productName: string;
  productBrand: string;
  productCategory: string;
  upc: string;
  gtin: string;
  quantity: number;
  unit: string;
  conditionNotes: string;
  createdAt: string;
  updatedAt: string;
};

export type ApiDonationTimelineEvent = {
  id: string;
  eventType: string;
  actorUserId: string;
  actorRole: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string;
  body?: unknown;
  timeoutMs?: number;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const abortController = options.timeoutMs ? new AbortController() : undefined;
  const timeout = options.timeoutMs
    ? setTimeout(() => abortController?.abort(), options.timeoutMs)
    : undefined;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: abortController?.signal,
    });
  } catch (error) {
    if (abortController?.signal.aborted) {
      throw new Error('The request took too long. Please try again.');
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const rawBody = await response.text();
  let payload: any = {};
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      const looksLikeHtml = /<!doctype html>|<html/i.test(rawBody);
      if (looksLikeHtml) {
        throw new Error('Backend route is unavailable or outdated. Please redeploy the API service and try again.');
      }
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
    timeoutMs: 25000,
  });
}

export async function verifyPasswordResetCode(input: { email: string; resetCode: string }) {
  return apiRequest<{ success: true; message: string }>('/api/auth/verify-reset-code', {
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

export async function lookupProductByBarcode(token: string, input: { barcode: string; format?: string }) {
  return apiRequest<{ success: true; product: ApiScannedProduct; source: string }>('/api/products/lookup', {
    method: 'POST',
    token,
    body: input,
  });
}

export async function getOrganizations(token: string) {
  return apiRequest<{ success: true; organizations: ApiOrganization[] }>('/api/organizations', {
    token,
  });
}

export async function createDonationRecord(
  token: string,
  input: {
    donorLocationId: string;
    recipientOrgId: string;
    item: ApiScannedProduct;
    quantity: number;
    unit: string;
    expiresAt?: string;
    pickupWindowStart?: string;
    pickupWindowEnd?: string;
    conditionNotes?: string;
    estimatedUnitValue?: number;
    currency?: string;
  }
) {
  return apiRequest<{ success: true; donation: ApiDonationRecord }>('/api/donations', {
    method: 'POST',
    token,
    body: input,
  });
}

export async function getDonations(token: string, status?: ApiDonationStatus) {
  const params = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiRequest<{ success: true; donations: ApiDonation[] }>(`/api/donations${params}`, { token });
}

export async function getDonationById(token: string, donationId: string) {
  return apiRequest<{ success: true; donation: ApiDonation; timeline: ApiDonationTimelineEvent[] }>(
    `/api/donations/${encodeURIComponent(donationId)}`,
    { token }
  );
}

export async function acceptDonation(token: string, donationId: string, note?: string) {
  return apiRequest<{ success: true; status: 'accepted' }>(`/api/donations/${encodeURIComponent(donationId)}/accept`, {
    method: 'POST',
    token,
    body: { note: note || '' },
  });
}

export async function declineDonation(token: string, donationId: string, reason?: string) {
  return apiRequest<{ success: true; status: 'declined' }>(`/api/donations/${encodeURIComponent(donationId)}/decline`, {
    method: 'POST',
    token,
    body: { reason: reason || '' },
  });
}

export async function generateDonationHandoffToken(token: string, donationId: string) {
  return apiRequest<{ success: true; handoffToken: string; expiresAt: string }>(
    `/api/donations/${encodeURIComponent(donationId)}/handoff-token`,
    {
      method: 'POST',
      token,
    }
  );
}

export async function confirmDonationHandoff(
  token: string,
  donationId: string,
  input: { handoffToken: string; receivedQuantity?: number; receivedUnit?: string; receiptNote?: string }
) {
  return apiRequest<{ success: true; status: 'received' }>(`/api/donations/${encodeURIComponent(donationId)}/confirm-handoff`, {
    method: 'POST',
    token,
    body: input,
  });
}

export async function getDonationImpactSummary(token: string) {
  return apiRequest<{
    success: true;
    summary: {
      itemsDonated: number;
      estimatedInventoryValue: number;
      recipientCount: number;
      completedPickups: number;
    };
  }>('/api/donations/impact-summary', { token });
}

export async function exportDonationRecords(token: string) {
  return apiRequest<{ success: true; records: ApiDonation[] }>(`/api/donations/export?format=json`, {
    token,
  });
}

export async function exportDonationRecordsCsv(token: string) {
  const response = await fetch(`${API_BASE_URL}/api/donations/export?format=csv`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const rawBody = await response.text();
  if (!response.ok) {
    try {
      const payload = JSON.parse(rawBody);
      throw new Error(payload.error || payload.message || 'CSV export failed');
    } catch {
      throw new Error(rawBody || 'CSV export failed');
    }
  }

  return rawBody;
}
