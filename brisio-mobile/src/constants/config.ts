import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as { apiBaseUrl?: string };

export const API_BASE_URL = extra.apiBaseUrl || 'http://localhost:3000';
