import { useEffect, useRef, useState } from 'react';
import type { AppBootstrapPayload, ServiceItem } from '../types';

const APP_STATE_KEY = 'trindade_app_state_v1';
const LEGACY_CACHE_KEY = 'trindade_offline_cache';
const DRAFTS_KEY = 'trindade_form_drafts_v1';
const PENDING_SYNC_KEY = 'trindade_pending_server_sync_v1';
const PRICE_MIGRATION_KEY = 'trindade_price_v2_30_35_10';

export interface PersistedAppState {
  savedAt: string;
  userUpdatedAt: string | null;
  data: AppBootstrapPayload;
}

function applyOneTimeServicePriceMigration(services: ServiceItem[]): ServiceItem[] {
  if (!Array.isArray(services)) return [];
  try {
    if (localStorage.getItem(PRICE_MIGRATION_KEY) === '1') {
      return services;
    }
    const updated = services.map((s) => {
      const normalizedName = s.name.trim().toLowerCase();
      if (s.id === 'srv_corte' || normalizedName === 'corte de cabelo') {
        return { ...s, price: 35 };
      }
      if (s.id === 'srv_barba' || normalizedName === 'barba') {
        return { ...s, price: 30 };
      }
      if (s.id === 'srv_sobrancelha' || normalizedName === 'sobrancelha') {
        return { ...s, price: 10 };
      }
      return s;
    });
    localStorage.setItem(PRICE_MIGRATION_KEY, '1');
    return updated;
  } catch {
    return services;
  }
}

export function loadAppState(): PersistedAppState | null {
  try {
    const raw = localStorage.getItem(APP_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedAppState;
      if (parsed?.data) {
        parsed.data.services = applyOneTimeServicePriceMigration(parsed.data.services || []);
        return parsed;
      }
    }

    const legacyRaw = localStorage.getItem(LEGACY_CACHE_KEY);
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw) as { savedAt: string; data: AppBootstrapPayload };
      if (legacyParsed?.data) {
        const migrated: PersistedAppState = {
          savedAt: legacyParsed.savedAt || new Date().toISOString(),
          userUpdatedAt: legacyParsed.savedAt || new Date().toISOString(),
          data: {
            ...legacyParsed.data,
            services: applyOneTimeServicePriceMigration(legacyParsed.data.services || []),
          },
        };
        localStorage.setItem(APP_STATE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function saveAppState(data: AppBootstrapPayload, options?: { markUserUpdated?: boolean }) {
  try {
    const existing = loadAppState();
    const nowIso = new Date().toISOString();
    const payload: PersistedAppState = {
      savedAt: nowIso,
      userUpdatedAt: options?.markUserUpdated ? nowIso : existing?.userUpdatedAt || nowIso,
      data,
    };
    const serialized = JSON.stringify(payload);
    localStorage.setItem(APP_STATE_KEY, serialized);
    // Keep legacy cache key mirrored for compatibility
    localStorage.setItem(LEGACY_CACHE_KEY, JSON.stringify({ savedAt: nowIso, data }));
  } catch {
    // Ignore quota errors
  }
}

export function hasPendingServerSync(): boolean {
  try {
    return localStorage.getItem(PENDING_SYNC_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPendingServerSync(pending: boolean) {
  try {
    if (pending) {
      localStorage.setItem(PENDING_SYNC_KEY, '1');
    } else {
      localStorage.removeItem(PENDING_SYNC_KEY);
    }
  } catch {
    // Ignore
  }
}

export function hasMeaningfulOperationalData(data: Partial<AppBootstrapPayload> | null | undefined): boolean {
  if (!data) return false;
  if (Array.isArray(data.transactions) && data.transactions.length > 0) return true;
  if (Array.isArray(data.appointments) && data.appointments.length > 0) return true;
  if (Array.isArray(data.cashClosings) && data.cashClosings.length > 0) return true;
  if (Array.isArray(data.subscribers) && data.subscribers.length > 0) return true;
  if (data.settings) {
    if (Number(data.settings.openingCashBalance || 0) !== 0) return true;
    if (Number(data.settings.dailyGoal || 0) !== 0) return true;
    if (Number(data.settings.monthlyGoal || 0) !== 0) return true;
    if (Boolean(data.settings.pixKey?.trim())) return true;
    if (data.settings.shopName && data.settings.shopName.trim() !== 'Barbearia Trindade') return true;
  }
  if (Array.isArray(data.services) && data.services.some((s) => !s.id.startsWith('srv_'))) {
    return true;
  }
  if (Array.isArray(data.membershipPlans) && data.membershipPlans.some((p) => !p.isTemplate)) {
    return true;
  }
  return false;
}

function readDraftStore(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeDraftStore(store: Record<string, unknown>) {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(store));
  } catch {
    // Ignore quota errors
  }
}

export function getDraft<T>(key: string, fallback: T): T {
  const store = readDraftStore();
  if (Object.prototype.hasOwnProperty.call(store, key)) {
    return store[key] as T;
  }
  return fallback;
}

export function hasDraft(key: string): boolean {
  const store = readDraftStore();
  return Object.prototype.hasOwnProperty.call(store, key);
}

export function setDraft<T>(key: string, value: T) {
  const store = readDraftStore();
  store[key] = value;
  writeDraftStore(store);
}

export function removeDraft(key: string) {
  const store = readDraftStore();
  if (Object.prototype.hasOwnProperty.call(store, key)) {
    delete store[key];
    writeDraftStore(store);
  }
}

export function useLocalDraft<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;

  const [state, setState] = useState<T>(() => getDraft<T>(key, defaultValue));

  useEffect(() => {
    setDraft(key, state);
  }, [key, state]);

  return [state, setState];
}

export function shouldFallbackToLocalPersistence(err: unknown): boolean {
  if (!err || typeof err !== 'object') return true;
  const status = (err as { status?: number }).status;
  if (typeof status !== 'number') {
    // Network / fetch failure
    return true;
  }
  // 400 / 403 / 404 / 409 are intentional client/validation errors; 401/408/5xx should fallback locally
  return status === 401 || status === 408 || status >= 500;
}
