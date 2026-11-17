import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Calculator,
  EyeOff,
  LayoutDashboard,
  LogOut,
  Menu,
  Repeat,
  Scissors,
  ShieldCheck,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  AppBootstrapPayload,
  AppSettings,
  Appointment,
  CashClosing,
  MembershipPlan,
  ServiceItem,
  Subscriber,
  Transaction,
  TransactionType,
  User,
} from './types';
import { ROLE_LABELS } from './types';
import { ApiError, apiRequest, getStoredToken, setStoredToken } from './lib/api';
import {
  hasMeaningfulOperationalData,
  hasPendingServerSync,
  loadAppState,
  saveAppState,
  setPendingServerSync,
  useLocalDraft,
} from './lib/storage';
import { useOnlineStatus } from './hooks/usePWAInstall';
import { BrandMark } from './components/BrandMark';
import { LoginScreen } from './components/LoginScreen';
import { DashboardView } from './components/DashboardView';

const ServicesAppointmentsView = lazy(() =>
  import('./components/ServicesAppointmentsView').then((m) => ({ default: m.ServicesAppointmentsView }))
);
const SubscriptionsView = lazy(() =>
  import('./components/SubscriptionsView').then((m) => ({ default: m.SubscriptionsView }))
);
const FinanceView = lazy(() =>
  import('./components/FinanceView').then((m) => ({ default: m.FinanceView }))
);
const CashClosingView = lazy(() =>
  import('./components/CashClosingView').then((m) => ({ default: m.CashClosingView }))
);
const ReportsView = lazy(() =>
  import('./components/ReportsView').then((m) => ({ default: m.ReportsView }))
);
const AdminView = lazy(() =>
  import('./components/AdminView').then((m) => ({ default: m.AdminView }))
);
const PrivateAreaView = lazy(() =>
  import('./components/PrivateAreaView').then((m) => ({ default: m.PrivateAreaView }))
);

type NavSection = 'dashboard' | 'services' | 'subscriptions' | 'finance' | 'closing' | 'reports' | 'admin' | 'private';

const NAV_TITLES: Record<NavSection, string> = {
  dashboard: 'Painel Principal',
  services: 'Serviços e Atendimentos',
  subscriptions: 'Planos, PIX e Lembretes',
  finance: 'Controle Financeiro',
  closing: 'Fechamento de Caixa',
  reports: 'Relatórios',
  admin: 'Área Administrativa',
  private: 'Área Privada',
};

const DEFAULT_SETTINGS: AppSettings = {
  shopName: 'Barbearia Trindade',
  openingCashBalance: 0,
  dailyGoal: 0,
  monthlyGoal: 0,
  cloudSyncEnabled: true,
  cloudSyncUrl: '',
  lastBackupAt: null,
  pixKey: '',
  pixHolderName: 'BARBEARIA TRINDADE',
  pixCity: 'SAO PAULO',
};

function mergeById<T extends { id: string }>(serverItems: T[], localItems: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of serverItems) {
    map.set(item.id, item);
  }
  // Preserve any locally created offline items not yet on server
  for (const item of localItems) {
    if (item.id.startsWith('local_') && !map.has(item.id)) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

export default function App() {
  const isOnline = useOnlineStatus();
  const initialSnapshotRef = useRef(loadAppState());
  const hasTokenOnMount = Boolean(getStoredToken());
  const initialData = initialSnapshotRef.current?.data;

  const [booting, setBooting] = useState<boolean>(() => hasTokenOnMount && !initialData?.user);
  const [user, setUser] = useState<User | null>(() => (hasTokenOnMount ? initialData?.user || null : null));
  const [settings, setSettings] = useState<AppSettings>(() => initialData?.settings || DEFAULT_SETTINGS);
  const [services, setServices] = useState<ServiceItem[]>(() => initialData?.services || []);
  const [appointments, setAppointments] = useState<Appointment[]>(() => initialData?.appointments || []);
  const [transactions, setTransactions] = useState<Transaction[]>(() => initialData?.transactions || []);
  const [cashClosings, setCashClosings] = useState<CashClosing[]>(() => initialData?.cashClosings || []);
  const [membershipPlans, setMembershipPlans] = useState<MembershipPlan[]>(() => initialData?.membershipPlans || []);
  const [subscribers, setSubscribers] = useState<Subscriber[]>(() => initialData?.subscribers || []);

  const [activeSection, setActiveSection] = useLocalDraft<NavSection>('app_active_section', 'dashboard');
  const [financeInitialType, setFinanceInitialType] = useLocalDraft<TransactionType>('app_finance_initial_type', 'entrada');
  const [financeActionNonce, setFinanceActionNonce] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const latestPayloadRef = useRef<AppBootstrapPayload | null>(null);
  if (user) {
    latestPayloadRef.current = {
      user,
      settings,
      services,
      appointments,
      transactions,
      cashClosings,
      membershipPlans,
      subscribers,
    };
  }

  const applyBootstrap = useCallback((data: AppBootstrapPayload, markUserUpdated = false) => {
    setUser(data.user);
    setSettings(data.settings);
    setServices(data.services);
    setAppointments(data.appointments);
    setTransactions(data.transactions);
    setCashClosings(data.cashClosings);
    setMembershipPlans(data.membershipPlans || []);
    setSubscribers(data.subscribers || []);
    saveAppState(data, { markUserUpdated });
  }, []);

  const syncLocalToServer = useCallback(async (localData: AppBootstrapPayload): Promise<boolean> => {
    try {
      await apiRequest('/api/backup/restore', {
        method: 'POST',
        body: JSON.stringify({
          settings: localData.settings,
          services: localData.services,
          appointments: localData.appointments,
          transactions: localData.transactions,
          cashClosings: localData.cashClosings,
          membershipPlans: localData.membershipPlans,
          subscribers: localData.subscribers,
        }),
      });
      setPendingServerSync(false);
      return true;
    } catch {
      return false;
    }
  }, []);

  const loadBootstrap = useCallback(async () => {
    const token = getStoredToken();
    const localSnapshot = loadAppState();

    if (!token) {
      setBooting(false);
      return;
    }

    try {
      const serverData = await apiRequest<AppBootstrapPayload>('/api/bootstrap');
      const localData = localSnapshot?.data;

      // Never overwrite populated localStorage with an empty/restarted server DB
      const serverIsEmpty = !hasMeaningfulOperationalData(serverData);
      const localHasData = hasMeaningfulOperationalData(localData);
      const pendingSync = hasPendingServerSync();

      if (localData && (pendingSync || (serverIsEmpty && localHasData))) {
        const mergedLocal: AppBootstrapPayload = {
          ...localData,
          user: serverData.user,
          services: localData.services.length > 0 ? localData.services : serverData.services,
          membershipPlans: localData.membershipPlans.length > 0 ? localData.membershipPlans : serverData.membershipPlans,
        };
        const restored = await syncLocalToServer(mergedLocal);
        if (restored) {
          const freshServer = await apiRequest<AppBootstrapPayload>('/api/bootstrap');
          applyBootstrap(freshServer);
        } else {
          applyBootstrap(mergedLocal);
        }
      } else if (localData) {
        // Merge any local-only offline records into server data
        const hasOfflineItems =
          localData.transactions.some((t) => t.id.startsWith('local_')) ||
          localData.appointments.some((a) => a.id.startsWith('local_')) ||
          localData.cashClosings.some((c) => c.id.startsWith('local_')) ||
          localData.subscribers.some((s) => s.id.startsWith('local_'));

        if (hasOfflineItems) {
          const merged: AppBootstrapPayload = {
            ...serverData,
            services: mergeById(serverData.services, localData.services),
            appointments: mergeById(serverData.appointments, localData.appointments),
            transactions: mergeById(serverData.transactions, localData.transactions),
            cashClosings: mergeById(serverData.cashClosings, localData.cashClosings),
            membershipPlans: mergeById(serverData.membershipPlans || [], localData.membershipPlans || []),
            subscribers: mergeById(serverData.subscribers || [], localData.subscribers || []),
          };
          const synced = await syncLocalToServer(merged);
          if (synced) {
            const fresh = await apiRequest<AppBootstrapPayload>('/api/bootstrap');
            applyBootstrap(fresh);
          } else {
            applyBootstrap(merged);
          }
        } else {
          applyBootstrap(serverData);
        }
      } else {
        applyBootstrap(serverData);
      }
    } catch (err) {
      // Keep localStorage data intact on network/server failure
      if (err instanceof ApiError && err.status === 401) {
        setStoredToken(null);
        setUser(null);
      } else if (localSnapshot?.data?.user) {
        applyBootstrap(localSnapshot.data);
      }
    } finally {
      setBooting(false);
    }
  }, [applyBootstrap, syncLocalToServer]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  // Persist complete app state synchronously to localStorage on every update
  useEffect(() => {
    if (user) {
      saveAppState(
        {
          user,
          settings,
          services,
          appointments,
          transactions,
          cashClosings,
          membershipPlans,
          subscribers,
        },
        { markUserUpdated: true }
      );
    }
  }, [user, settings, services, appointments, transactions, cashClosings, membershipPlans, subscribers]);

  // Flush latest state before page unload/refresh and resync when back online
  useEffect(() => {
    const flushState = () => {
      if (latestPayloadRef.current) {
        saveAppState(latestPayloadRef.current);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushState();
      }
    };
    const handleOnline = () => {
      if (hasPendingServerSync() && getStoredToken()) {
        void loadBootstrap();
      }
    };

    window.addEventListener('beforeunload', flushState);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('beforeunload', flushState);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [loadBootstrap]);

  const handleLogout = () => {
    // Save latest state in localStorage before clearing auth session token
    if (latestPayloadRef.current) {
      saveAppState(latestPayloadRef.current);
    }
    setStoredToken(null);
    setUser(null);
    setMobileMenuOpen(false);
  };

  const handleQuickAction = (action: 'appointment' | 'entrada' | 'saida' | 'closing' | 'subscriptions') => {
    if (action === 'appointment') {
      setActiveSection('services');
    } else if (action === 'entrada') {
      setFinanceInitialType('entrada');
      setFinanceActionNonce((n) => n + 1);
      setActiveSection('finance');
    } else if (action === 'saida') {
      setFinanceInitialType('saida');
      setFinanceActionNonce((n) => n + 1);
      setActiveSection('finance');
    } else if (action === 'closing') {
      setActiveSection('closing');
    } else if (action === 'subscriptions') {
      setActiveSection('subscriptions');
    }
  };

  const navigateTo = (section: NavSection) => {
    setActiveSection(section);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-[#09090B] flex flex-col items-center justify-center p-6">
        <BrandMark className="w-12 h-12" />
        <p className="mt-4 text-sm font-medium text-zinc-400">Carregando Barbearia Trindade...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onLoginSuccess={() => {
          setBooting(true);
          void loadBootstrap();
        }}
      />
    );
  }

  const desktopNavItems: Array<{ id: NavSection; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: 'Painel Principal', icon: <LayoutDashboard className="w-4 h-4 shrink-0" /> },
    { id: 'services', label: 'Serviços e Atendimentos', icon: <Scissors className="w-4 h-4 shrink-0" /> },
    { id: 'subscriptions', label: 'Planos, PIX e Lembretes', icon: <Repeat className="w-4 h-4 shrink-0" /> },
    { id: 'finance', label: 'Controle Financeiro', icon: <Wallet className="w-4 h-4 shrink-0" /> },
    { id: 'closing', label: 'Fechamento de Caixa', icon: <Calculator className="w-4 h-4 shrink-0" /> },
    { id: 'reports', label: 'Relatórios', icon: <BarChart3 className="w-4 h-4 shrink-0" /> },
    { id: 'admin', label: 'Área Administrativa', icon: <ShieldCheck className="w-4 h-4 shrink-0" /> },
    { id: 'private', label: 'Área Privada', icon: <EyeOff className="w-4 h-4 shrink-0" /> },
  ];

  const mobileDockIndex = mobileMenuOpen
    ? 4
    : activeSection === 'dashboard'
    ? 0
    : activeSection === 'services'
    ? 1
    : activeSection === 'subscriptions'
    ? 2
    : activeSection === 'finance'
    ? 3
    : 4;

  return (
    <div className="min-h-screen apple-ambient-bg text-zinc-100 flex">
      {/* Living Ambient Orbs behind Frosted Glass */}
      <div className="apple-ambient-orbs" aria-hidden="true">
        <div className="apple-orb apple-orb-gold" />
        <div className="apple-orb apple-orb-slate" />
        <div className="apple-orb apple-orb-amber" />
      </div>

      {/* Desktop Frosted macOS Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 z-20 border-r border-white/[0.11] apple-glass-chrome p-5 justify-between">
        <div>
          <div className="flex items-center gap-3 pb-5 border-b border-white/[0.09]">
            <BrandMark className="w-10 h-10 shrink-0 transition-transform duration-300 hover:scale-105" />
            <div className="min-w-0">
              <span className="block text-sm font-bold text-white truncate">{settings.shopName}</span>
              <span className="block text-[11px] text-[#E6C65C]">Gestão Inteligente</span>
            </div>
          </div>

          <nav className="mt-5 space-y-1">
            {desktopNavItems.map((item) => {
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  className={`w-full min-h-[44px] px-3.5 rounded-2xl text-xs font-semibold flex items-center gap-3 apple-tab-spring whitespace-nowrap ${
                    active
                      ? 'apple-btn-gold'
                      : 'text-zinc-300/85 hover:text-white hover:bg-white/[0.09] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                  }`}
                >
                  <span className={active ? 'apple-icon-pop' : ''}>{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-4 border-t border-white/[0.09]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{user.name}</p>
              <p className="text-[11px] text-zinc-400 truncate">{ROLE_LABELS[user.role]}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-rose-400 hover:bg-rose-500/12 transition-colors"
              title="Sair"
              aria-label="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar: Solid Black Edge on Mobile/Android + Frosted Apple Bar on Desktop */}
        <header className="sticky top-0 z-30 pt-safe bg-black lg:bg-transparent lg:apple-glass-chrome border-b border-white/[0.12] px-4 sm:px-6">
          <div className="h-14 lg:h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <BrandMark className="w-8 h-8 lg:hidden shrink-0" />
              <h1 className="text-[15px] sm:text-base font-bold text-white truncate leading-tight">
                {NAV_TITLES[activeSection]}
              </h1>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!isOnline && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-400 px-2 py-1">
                  <WifiOff className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Offline</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => navigateTo('services')}
                className="flex min-h-[36px] sm:min-h-[38px] px-3 sm:px-4 rounded-full apple-btn-gold text-xs font-semibold items-center gap-1.5 whitespace-nowrap"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span className="sm:hidden">Atender</span>
                <span className="hidden sm:inline">Novo Atendimento</span>
              </button>
            </div>
          </div>
        </header>

        {/* Scrollable Workspace */}
        <main className="flex-1 px-3 sm:px-6 lg:px-8 py-3.5 sm:py-6 pb-24 lg:pb-10 max-w-7xl w-full mx-auto">
          <div key={activeSection} className="apple-view-enter">
            <Suspense
              fallback={
                <div className="rounded-[22px] apple-glass p-6 text-sm text-zinc-400">
                  Carregando módulo...
                </div>
              }
            >
            {activeSection === 'dashboard' && (
              <DashboardView
                settings={settings}
                transactions={transactions}
                appointments={appointments}
                subscribers={subscribers}
                onQuickAction={handleQuickAction}
              />
            )}

            {activeSection === 'subscriptions' && (
              <SubscriptionsView
                settings={settings}
                plans={membershipPlans}
                subscribers={subscribers}
                onSettingsUpdated={setSettings}
                onPlansChanged={setMembershipPlans}
                onSubscriberCreated={(sub) => setSubscribers((prev) => [sub, ...prev])}
                onSubscriberUpdated={(sub) =>
                  setSubscribers((prev) => prev.map((item) => (item.id === sub.id ? sub : item)))
                }
                onSubscriberDeleted={(id) =>
                  setSubscribers((prev) => prev.filter((item) => item.id !== id))
                }
                onSubscriptionPaid={(sub, tx) => {
                  setSubscribers((prev) => prev.map((item) => (item.id === sub.id ? sub : item)));
                  setTransactions((prev) => [tx, ...prev]);
                }}
              />
            )}

            {activeSection === 'services' && (
              <ServicesAppointmentsView
                currentUser={user}
                services={services}
                appointments={appointments}
                onAppointmentCreated={(apt, tx) => {
                  setAppointments((prev) => [apt, ...prev]);
                  setTransactions((prev) => [tx, ...prev]);
                }}
                onAppointmentUpdated={(apt, tx) => {
                  setAppointments((prev) => prev.map((a) => (a.id === apt.id ? apt : a)));
                  if (tx) {
                    setTransactions((prev) => prev.map((t) => (t.id === tx.id ? tx : t)));
                  }
                }}
                onAppointmentDeleted={(aptId, txId) => {
                  setAppointments((prev) => prev.filter((a) => a.id !== aptId));
                  if (txId) {
                    setTransactions((prev) => prev.filter((t) => t.id !== txId));
                  }
                }}
                onServicesChanged={setServices}
              />
            )}

            {activeSection === 'finance' && (
              <FinanceView
                transactions={transactions}
                initialType={financeInitialType}
                quickActionNonce={financeActionNonce}
                onTransactionCreated={(tx) => setTransactions((prev) => [tx, ...prev])}
                onTransactionUpdated={(tx) => {
                  setTransactions((prev) => prev.map((t) => (t.id === tx.id ? tx : t)));
                  if (tx.appointmentId) {
                    setAppointments((prev) =>
                      prev.map((a) =>
                        a.id === tx.appointmentId
                          ? { ...a, amount: tx.amount, paymentMethod: tx.paymentMethod, date: tx.date, time: tx.time }
                          : a
                      )
                    );
                  }
                }}
                onTransactionDeleted={(txId, deletedAppointmentId) => {
                  setTransactions((prev) => prev.filter((t) => t.id !== txId));
                  if (deletedAppointmentId) {
                    setAppointments((prev) => prev.filter((a) => a.id !== deletedAppointmentId));
                  }
                }}
              />
            )}

            {activeSection === 'closing' && (
              <CashClosingView
                currentUser={user}
                settings={settings}
                transactions={transactions}
                appointments={appointments}
                cashClosings={cashClosings}
                onClosingSaved={(cls) => {
                  setCashClosings((prev) => {
                    const exists = prev.some((c) => c.id === cls.id || c.date === cls.date);
                    if (exists) {
                      return prev.map((c) => (c.date === cls.date ? cls : c));
                    }
                    return [cls, ...prev];
                  });
                }}
              />
            )}

            {activeSection === 'reports' && (
              <ReportsView transactions={transactions} appointments={appointments} />
            )}

            {activeSection === 'admin' && (
              <AdminView
                currentUser={user}
                settings={settings}
                services={services}
                onSettingsUpdated={setSettings}
                onServicesUpdated={setServices}
                onDataRestored={async () => {
                  setPendingServerSync(false);
                  const fresh = await apiRequest<AppBootstrapPayload>('/api/bootstrap');
                  applyBootstrap(fresh, true);
                }}
                onLocalOperationsCleared={() => {
                  setPendingServerSync(false);
                  setAppointments([]);
                  setTransactions([]);
                  setCashClosings([]);
                  setSubscribers([]);
                  setSettings((prev) => ({
                    ...prev,
                    openingCashBalance: 0,
                    dailyGoal: 0,
                    monthlyGoal: 0,
                  }));
                }}
              />
            )}

            {activeSection === 'private' && <PrivateAreaView />}
            </Suspense>
          </div>
        </main>
      </div>

      {/* Mobile Floating iOS Liquid Glass Tab Dock with Sliding Glass Pill */}
      {!mobileMenuOpen && (
        <nav
          aria-label="Navegação principal móvel"
          className="lg:hidden fixed bottom-2.5 left-3 right-3 z-40 rounded-[26px] apple-glass-chrome border border-white/[0.14] shadow-[0_18px_44px_rgba(0,0,0,0.82)] pb-safe"
        >
          <div className="relative mx-1.5 h-14 flex items-center">
            {/* Sliding Frosted Liquid Glass Capsule */}
            <div
              aria-hidden="true"
              className="absolute inset-y-1 left-0 w-1/5 px-0.5 pointer-events-none transition-transform duration-300 ease-[cubic-bezier(0.32,1.25,0.36,1)]"
              style={{ transform: `translateX(${mobileDockIndex * 100}%)` }}
            >
              <div className="w-full h-full rounded-[20px] apple-dock-pill" />
            </div>

            <div className="relative z-10 grid grid-cols-5 w-full h-full items-center">
              {([
                { id: 'dashboard', label: 'Painel', icon: LayoutDashboard },
                { id: 'services', label: 'Atender', icon: Scissors },
                { id: 'subscriptions', label: 'Planos', icon: Repeat },
                { id: 'finance', label: 'Caixa', icon: Wallet },
              ] as const).map((tab) => {
                const Icon = tab.icon;
                const active = !mobileMenuOpen && activeSection === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => navigateTo(tab.id)}
                    className={`min-h-[44px] rounded-[20px] flex flex-col items-center justify-center gap-0.5 apple-tab-spring hover:bg-white/[0.05] ${
                      active ? 'text-[#E6C65C]' : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${active ? 'apple-icon-pop' : ''}`} />
                    <span className="text-[10px] font-medium tracking-tight">{tab.label}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className={`min-h-[44px] rounded-[20px] flex flex-col items-center justify-center gap-0.5 apple-tab-spring hover:bg-white/[0.05] ${
                  mobileMenuOpen || ['closing', 'reports', 'admin', 'private'].includes(activeSection)
                    ? 'text-[#E6C65C]'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                <Menu
                  className={`w-5 h-5 ${
                    mobileMenuOpen || ['closing', 'reports', 'admin', 'private'].includes(activeSection)
                      ? 'apple-icon-pop'
                      : ''
                  }`}
                />
                <span className="text-[10px] font-medium tracking-tight">Mais</span>
              </button>
            </div>
          </div>
        </nav>
      )}

      {/* Mobile Frosted Bottom Sheet Menu */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end apple-backdrop-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-[30px] apple-glass-modal p-4 pb-safe max-h-[85vh] overflow-y-auto apple-sheet-up"
          >
            <div className="w-10 h-1.5 rounded-full bg-white/25 mx-auto mb-3" />
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.09]">
              <div className="flex items-center gap-3 min-w-0">
                <BrandMark className="w-11 h-11 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{user.name}</p>
                  <p className="text-xs text-zinc-400 truncate">{user.email} · {ROLE_LABELS[user.role]}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/[0.06] text-zinc-300 hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-3 space-y-1.5">
              {([
                { id: 'closing', label: 'Fechamento de Caixa', icon: Calculator },
                { id: 'reports', label: 'Relatórios (PDF e CSV)', icon: BarChart3 },
                { id: 'admin', label: 'Área Administrativa', icon: ShieldCheck },
                { id: 'private', label: 'Área Privada', icon: EyeOff },
              ] as const).map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTo(item.id)}
                    className={`w-full min-h-[46px] px-4 rounded-2xl text-sm font-semibold flex items-center gap-3 apple-tab-spring ${
                      active ? 'apple-btn-gold' : 'apple-glass-well text-zinc-200 hover:bg-white/[0.11]'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'apple-icon-pop' : ''}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 pt-4 border-t border-white/[0.09] flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full min-h-[46px] rounded-2xl border border-rose-500/30 bg-rose-500/12 text-rose-300 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Sair da Conta</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
