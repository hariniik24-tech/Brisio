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

  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || 'Request failed');
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
