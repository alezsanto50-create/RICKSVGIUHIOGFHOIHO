import type { AppBootstrapPayload } from '../types';
import { loadAppState, saveAppState } from './storage';

const TOKEN_KEY = 'trindade_auth_token';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function saveOfflineSnapshot(data: AppBootstrapPayload) {
  saveAppState(data);
}

export function loadOfflineSnapshot(): { savedAt: string; data: AppBootstrapPayload } | null {
  const state = loadAppState();
  if (!state) return null;
  return { savedAt: state.savedAt, data: state.data };
}

export async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    if (res.status === 401 && !url.includes('/api/auth/')) {
      setStoredToken(null);
    }
    throw new ApiError(String(json.error || `Erro na requisição (${res.status})`), res.status);
  }

  return json as T;
}
