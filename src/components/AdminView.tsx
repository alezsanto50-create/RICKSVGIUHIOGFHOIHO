import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  Cloud,
  Database,
  Download,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { ROLE_LABELS, type AppSettings, type ServiceItem, type User, type UserRole } from '../types';
import { formatBRL, parseCurrencyInput, sanitizeDecimalInput } from '../lib/formatters';
import { apiRequest } from '../lib/api';
import {
  hasDraft,
  setPendingServerSync,
  shouldFallbackToLocalPersistence,
  useLocalDraft,
} from '../lib/storage';

const BrandSuitePanel = lazy(() =>
  import('./BrandSuitePanel').then((m) => ({ default: m.BrandSuitePanel }))
);

interface AdminViewProps {
  currentUser: User;
  settings: AppSettings;
  services: ServiceItem[];
  onSettingsUpdated: (settings: AppSettings) => void;
  onServicesUpdated: (services: ServiceItem[]) => void;
  onDataRestored: () => Promise<void>;
  onLocalOperationsCleared?: () => void;
}

type AdminTab = 'servicos' | 'usuarios' | 'identidade' | 'config' | 'backup' | 'senhas';

export const AdminView: React.FC<AdminViewProps> = ({
  currentUser,
  settings,
  services,
  onSettingsUpdated,
  onServicesUpdated,
  onDataRestored,
  onLocalOperationsCleared,
}) => {
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [tab, setTab] = useLocalDraft<AdminTab>('adm_tab', 'servicos');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Services management
  const [editingService, setEditingService] = useState<ServiceItem | null>(null);
  const [srvName, setSrvName] = useLocalDraft('adm_srv_name', '');
  const [srvCat, setSrvCat] = useLocalDraft('adm_srv_cat', 'Cabelo');
  const [srvPrice, setSrvPrice] = useLocalDraft('adm_srv_price', '');
  const [srvDuration, setSrvDuration] = useLocalDraft('adm_srv_duration', '30');

  // Users management
  const [users, setUsers] = useState<User[]>([]);
  const [newUserName, setNewUserName] = useLocalDraft('adm_new_user_name', '');
  const [newUserEmail, setNewUserEmail] = useLocalDraft('adm_new_user_email', '');
  const [newUserRole, setNewUserRole] = useLocalDraft<UserRole>('adm_new_user_role', 'barber');
  const [newUserPass, setNewUserPass] = useState('');

  // Settings form (persisted drafts + dirty flag so typed numbers are never wiped)
  const [settingsDirty, setSettingsDirty] = useLocalDraft('adm_settings_dirty', false);
  const [shopName, setShopName] = useLocalDraft('adm_shop_name', settings.shopName);
  const [openingBalance, setOpeningBalance] = useLocalDraft('adm_opening_balance', String(settings.openingCashBalance));
  const [dailyGoal, setDailyGoal] = useLocalDraft('adm_daily_goal', String(settings.dailyGoal));
  const [monthlyGoal, setMonthlyGoal] = useLocalDraft('adm_monthly_goal', String(settings.monthlyGoal));
  const [cloudSyncEnabled, setCloudSyncEnabled] = useLocalDraft('adm_cloud_sync_enabled', settings.cloudSyncEnabled);
  const [cloudSyncUrl, setCloudSyncUrl] = useLocalDraft('adm_cloud_sync_url', settings.cloudSyncUrl);

  // Passwords form (never stored in localStorage)
  const [pwdTarget, setPwdTarget] = useState<'admin_pin' | 'private_pin' | 'user'>('admin_pin');
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');

  // Clear demo ops confirmation
  const [confirmResetModal, setConfirmResetModal] = useState(false);
  const [resetPin, setResetPin] = useState('');

  useEffect(() => {
    if (!settingsDirty) {
      if (!hasDraft('adm_shop_name')) setShopName(settings.shopName);
      if (!hasDraft('adm_opening_balance')) setOpeningBalance(String(settings.openingCashBalance));
      if (!hasDraft('adm_daily_goal')) setDailyGoal(String(settings.dailyGoal));
      if (!hasDraft('adm_monthly_goal')) setMonthlyGoal(String(settings.monthlyGoal));
      setShopName(settings.shopName);
      setOpeningBalance(String(settings.openingCashBalance));
      setDailyGoal(String(settings.dailyGoal));
      setMonthlyGoal(String(settings.monthlyGoal));
      setCloudSyncEnabled(settings.cloudSyncEnabled);
      setCloudSyncUrl(settings.cloudSyncUrl);
    }
  }, [
    settings,
    settingsDirty,
    setShopName,
    setOpeningBalance,
    setDailyGoal,
    setMonthlyGoal,
    setCloudSyncEnabled,
    setCloudSyncUrl,
  ]);

  const loadUsers = async () => {
    try {
      const list = await apiRequest<User[]>('/api/users');
      setUsers(list);
    } catch {
      // Ignore if not available
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    setVerifying(true);
    try {
      await apiRequest('/api/auth/verify-admin-pin', {
        method: 'POST',
        body: JSON.stringify({ pin: pinInput }),
      });
      setUnlocked(true);
      setPinInput('');
      void loadUsers();
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Senha administrativa incorreta.');
    } finally {
      setVerifying(false);
    }
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const numPrice = parseCurrencyInput(srvPrice);
    if (!srvName.trim() || !Number.isFinite(numPrice) || numPrice <= 0) {
      setFeedback({ type: 'err', text: 'Informe o nome do serviço e um valor válido maior que zero.' });
      return;
    }

    try {
      if (editingService) {
        try {
          const updated = await apiRequest<ServiceItem>(`/api/services/${editingService.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: srvName.trim(),
              category: srvCat.trim() || 'Geral',
              price: numPrice,
              durationMin: Number(srvDuration) || 30,
            }),
          });
          onServicesUpdated(services.map((s) => (s.id === updated.id ? updated : s)));
          setEditingService(null);
          setFeedback({ type: 'ok', text: `Serviço "${updated.name}" atualizado.` });
        } catch (err) {
          if (shouldFallbackToLocalPersistence(err)) {
            const localUpdated: ServiceItem = {
              ...editingService,
              name: srvName.trim(),
              category: srvCat.trim() || 'Geral',
              price: numPrice,
              durationMin: Number(srvDuration) || 30,
            };
            setPendingServerSync(true);
            onServicesUpdated(services.map((s) => (s.id === localUpdated.id ? localUpdated : s)));
            setEditingService(null);
            setFeedback({ type: 'ok', text: `Serviço "${localUpdated.name}" atualizado no navegador.` });
          } else {
            throw err;
          }
        }
      } else {
        try {
          const created = await apiRequest<ServiceItem>('/api/services', {
            method: 'POST',
            body: JSON.stringify({
              name: srvName.trim(),
              category: srvCat.trim() || 'Geral',
              price: numPrice,
              durationMin: Number(srvDuration) || 30,
            }),
          });
          onServicesUpdated([...services, created]);
          setFeedback({ type: 'ok', text: `Serviço "${created.name}" adicionado.` });
        } catch (err) {
          if (shouldFallbackToLocalPersistence(err)) {
            const localCreated: ServiceItem = {
              id: `local_srv_${Date.now().toString(36)}`,
              name: srvName.trim(),
              category: srvCat.trim() || 'Geral',
              price: numPrice,
              durationMin: Number(srvDuration) || 30,
              active: true,
              createdAt: new Date().toISOString(),
            };
            setPendingServerSync(true);
            onServicesUpdated([...services, localCreated]);
            setFeedback({ type: 'ok', text: `Serviço "${localCreated.name}" salvo localmente.` });
          } else {
            throw err;
          }
        }
      }
      setSrvName('');
      setSrvPrice('');
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao salvar serviço.' });
    }
  };

  const handleToggleService = async (srv: ServiceItem) => {
    try {
      const updated = await apiRequest<ServiceItem>(`/api/services/${srv.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !srv.active }),
      });
      onServicesUpdated(services.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      if (shouldFallbackToLocalPersistence(err)) {
        setPendingServerSync(true);
        onServicesUpdated(services.map((s) => (s.id === srv.id ? { ...s, active: !s.active } : s)));
      } else {
        setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao alterar status do serviço.' });
      }
    }
  };

  const handleDeleteService = async (id: string) => {
    try {
      await apiRequest(`/api/services/${id}`, { method: 'DELETE' });
      onServicesUpdated(services.filter((s) => s.id !== id));
      setFeedback({ type: 'ok', text: 'Serviço removido.' });
    } catch (err) {
      if (shouldFallbackToLocalPersistence(err)) {
        setPendingServerSync(true);
        onServicesUpdated(services.filter((s) => s.id !== id));
        setFeedback({ type: 'ok', text: 'Serviço removido localmente.' });
      } else {
        setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao remover serviço.' });
      }
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const created = await apiRequest<User>('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: newUserName.trim(),
          email: newUserEmail.trim(),
          role: newUserRole,
          password: newUserPass,
        }),
      });
      setUsers([...users, created]);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPass('');
      setFeedback({ type: 'ok', text: `Usuário "${created.name}" criado.` });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao criar usuário.' });
    }
  };

  const handleToggleUser = async (u: User) => {
    try {
      const updated = await apiRequest<User>(`/api/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !u.active }),
      });
      setUsers(users.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao atualizar usuário.' });
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await apiRequest(`/api/users/${id}`, { method: 'DELETE' });
      setUsers(users.filter((u) => u.id !== id));
      setFeedback({ type: 'ok', text: 'Usuário removido.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao remover usuário.' });
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const parsedOpening = openingBalance.trim() === '' ? 0 : parseCurrencyInput(openingBalance);
    const parsedDaily = dailyGoal.trim() === '' ? 0 : parseCurrencyInput(dailyGoal);
    const parsedMonthly = monthlyGoal.trim() === '' ? 0 : parseCurrencyInput(monthlyGoal);

    if (!Number.isFinite(parsedOpening) || !Number.isFinite(parsedDaily) || !Number.isFinite(parsedMonthly)) {
      setFeedback({ type: 'err', text: 'Verifique os valores numéricos digitados.' });
      return;
    }

    const nextSettingsPayload: AppSettings = {
      ...settings,
      shopName: shopName.trim() || 'Barbearia Trindade',
      openingCashBalance: parsedOpening,
      dailyGoal: parsedDaily,
      monthlyGoal: parsedMonthly,
      cloudSyncEnabled,
      cloudSyncUrl: cloudSyncUrl.trim(),
    };

    try {
      let updated: AppSettings;
      try {
        updated = await apiRequest<AppSettings>('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            shopName: nextSettingsPayload.shopName,
            openingCashBalance: nextSettingsPayload.openingCashBalance,
            dailyGoal: nextSettingsPayload.dailyGoal,
            monthlyGoal: nextSettingsPayload.monthlyGoal,
            cloudSyncEnabled: nextSettingsPayload.cloudSyncEnabled,
            cloudSyncUrl: nextSettingsPayload.cloudSyncUrl,
          }),
        });
      } catch (err) {
        if (shouldFallbackToLocalPersistence(err)) {
          updated = nextSettingsPayload;
          setPendingServerSync(true);
        } else {
          throw err;
        }
      }
      setSettingsDirty(false);
      setShopName(updated.shopName);
      setOpeningBalance(String(updated.openingCashBalance));
      setDailyGoal(String(updated.dailyGoal));
      setMonthlyGoal(String(updated.monthlyGoal));
      onSettingsUpdated(updated);
      setFeedback({ type: 'ok', text: 'Configurações do sistema salvas com segurança!' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao salvar configurações.' });
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiRequest('/api/auth/passwords', {
        method: 'PUT',
        body: JSON.stringify({
          target: pwdTarget,
          currentValue: currentPwd,
          newValue: newPwd,
        }),
      });
      setCurrentPwd('');
      setNewPwd('');
      setFeedback({ type: 'ok', text: 'Senha atualizada com segurança.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao alterar senha.' });
    }
  };

  const handleExportBackupJSON = async () => {
    try {
      const data = await apiRequest<Record<string, unknown>>('/api/backup/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-barbearia-trindade-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setFeedback({ type: 'ok', text: 'Backup JSON completo baixado.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao exportar backup.' });
    }
  };

  const handleServerSnapshot = async () => {
    try {
      const res = await apiRequest<{ ok: boolean; filename: string; lastBackupAt: string }>('/api/backup/snapshot', {
        method: 'POST',
      });
      onSettingsUpdated({ ...settings, lastBackupAt: res.lastBackupAt });
      setFeedback({ type: 'ok', text: `Snapshot SQLite salvo no servidor (${res.filename}).` });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Falha ao criar snapshot.' });
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await apiRequest('/api/backup/restore', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      setSettingsDirty(false);
      await onDataRestored();
      setFeedback({ type: 'ok', text: 'Dados restaurados com sucesso a partir do arquivo de backup!' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Arquivo de backup inválido.' });
    } finally {
      e.target.value = '';
    }
  };

  const handleClearOperations = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/clear-operations', {
        method: 'POST',
        body: JSON.stringify({ pin: resetPin }),
      });
      setConfirmResetModal(false);
      setResetPin('');
      setSettingsDirty(false);
      onLocalOperationsCleared?.();
      await onDataRestored();
      setFeedback({ type: 'ok', text: 'Caixa e movimentações zerados. Pronto para começar do zero!' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Senha incorreta.' });
    }
  };

  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto py-8">
        <section className="rounded-[26px] apple-glass-modal p-6">
          <div className="w-12 h-12 rounded-2xl apple-glass-well flex items-center justify-center text-[#E6C65C]">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-white">Área Administrativa Protegida</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Informe a senha administrativa para gerenciar serviços, usuários, backups e configurações do sistema.
          </p>

          <form onSubmit={handleUnlock} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Senha Administrativa</label>
              <input
                type="password"
                required
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Digite a senha administrativa"
                className="w-full min-h-[48px] px-3.5 rounded-2xl apple-glass-well text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D4AF37]/60"
              />
            </div>

            {pinError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
                {pinError}
              </div>
            )}

            <button
              type="submit"
              disabled={verifying}
              className="w-full min-h-[48px] rounded-2xl apple-btn-gold font-semibold text-sm transition-all"
            >
              {verifying ? 'Verificando...' : 'Desbloquear Administração'}
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="rounded-[22px] apple-glass p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Painel Administrativo</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Gerencie serviços, equipe, segurança e backups da barbearia</p>
          </div>
          <button
            type="button"
            onClick={() => setUnlocked(false)}
            className="min-h-[40px] px-3.5 rounded-xl apple-glass-well text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/[0.1] flex items-center gap-1.5 self-start sm:self-auto transition-colors"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Bloquear Área</span>
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {([
            { id: 'servicos', label: 'Serviços e Preços' },
            { id: 'usuarios', label: 'Usuários' },
            { id: 'identidade', label: 'Identidade Visual' },
            { id: 'config', label: 'Configurações' },
            { id: 'backup', label: 'Backup e Nuvem' },
            { id: 'senhas', label: 'Senhas' },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setFeedback(null);
              }}
              className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold apple-tab-spring whitespace-nowrap ${
                tab === t.id ? 'apple-btn-gold' : 'apple-glass-well text-zinc-300 hover:bg-white/[0.11] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* TAB: SERVIÇOS */}
      {tab === 'servicos' && (
        <div key="admin-servicos" className="grid lg:grid-cols-12 gap-6 items-start apple-view-enter">
          <section className="lg:col-span-5 rounded-[22px] apple-glass p-5">
            <h3 className="text-base font-bold text-white">
              {editingService ? 'Editar Serviço' : 'Adicionar Novo Serviço'}
            </h3>
            <form onSubmit={handleSaveService} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Nome do Serviço</label>
                <input
                  type="text"
                  required
                  value={srvName}
                  onChange={(e) => setSrvName(e.target.value)}
                  placeholder="Ex: Corte + Barba"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Valor (R$)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={srvPrice}
                    onChange={(e) => setSrvPrice(sanitizeDecimalInput(e.target.value))}
                    placeholder="35,00"
                    className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Duração (min)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={srvDuration}
                    onChange={(e) => setSrvDuration(e.target.value.replace(/[^\d]/g, ''))}
                    className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Categoria</label>
                <input
                  type="text"
                  value={srvCat}
                  onChange={(e) => setSrvCat(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 min-h-[46px] rounded-2xl apple-btn-gold font-semibold text-sm flex items-center justify-center gap-1.5 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>{editingService ? 'Salvar Serviço' : 'Cadastrar Serviço'}</span>
                </button>
                {editingService && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingService(null);
                      setSrvName('');
                      setSrvPrice('');
                    }}
                    className="min-h-[46px] px-4 rounded-2xl apple-glass-well text-xs text-zinc-300 hover:bg-white/[0.1]"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="lg:col-span-7 rounded-[22px] apple-glass p-5">
            <h3 className="text-base font-bold text-white">Catálogo de Serviços ({services.length})</h3>
            <div className="mt-4 divide-y divide-white/[0.06]">
              {services.map((srv) => (
                <div key={srv.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${srv.active ? 'text-white' : 'text-zinc-500 line-through'}`}>
                      {srv.name}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {srv.category} · <span className="font-mono">{srv.durationMin} min</span> ·{' '}
                      <span className="font-mono text-[#E6C65C]">{formatBRL(srv.price)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggleService(srv)}
                      className="min-h-[36px] px-2.5 rounded-lg border border-white/10 text-xs text-zinc-300 hover:bg-white/5"
                    >
                      {srv.active ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingService(srv);
                        setSrvName(srv.name);
                        setSrvCat(srv.category);
                        setSrvPrice(String(srv.price));
                        setSrvDuration(String(srv.durationMin));
                      }}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/5"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteService(srv.id)}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* TAB: USUÁRIOS */}
      {tab === 'usuarios' && (
        <div key="admin-usuarios" className="grid lg:grid-cols-12 gap-6 items-start apple-view-enter">
          <section className="lg:col-span-5 rounded-[22px] apple-glass p-5">
            <h3 className="text-base font-bold text-white">Novo Usuário</h3>
            <form onSubmit={handleCreateUser} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">E-mail de Acesso</label>
                <input
                  type="email"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Perfil</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                    className="w-full min-h-[44px] px-3 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                  >
                    <option value="barber" className="bg-[#121216]">Barbeiro</option>
                    <option value="manager" className="bg-[#121216]">Gerente</option>
                    <option value="owner" className="bg-[#121216]">Proprietário</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Senha Inicial</label>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={newUserPass}
                    onChange={(e) => setNewUserPass(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full min-h-[46px] rounded-2xl apple-btn-gold font-semibold text-sm flex items-center justify-center gap-2 transition-all"
              >
                <UserPlus className="w-4 h-4" />
                <span>Cadastrar Usuário</span>
              </button>
            </form>
          </section>

          <section className="lg:col-span-7 rounded-[22px] apple-glass p-5">
            <h3 className="text-base font-bold text-white">Equipe e Acessos ({users.length})</h3>
            <div className="mt-4 divide-y divide-white/[0.06]">
              {users.map((u) => (
                <div key={u.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {u.name} {u.id === currentUser.id ? '(Você)' : ''}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {u.email} · {ROLE_LABELS[u.role]} · {u.active ? 'Ativo' : 'Desativado'}
                    </p>
                  </div>
                  {u.id !== currentUser.id && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleToggleUser(u)}
                        className="min-h-[36px] px-2.5 rounded-lg border border-white/10 text-xs text-zinc-300 hover:bg-white/5"
                      >
                        {u.active ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteUser(u.id)}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* TAB: IDENTIDADE VISUAL */}
      {tab === 'identidade' && (
        <div key="admin-identidade" className="apple-view-enter">
          <Suspense
            fallback={
              <div className="rounded-[22px] apple-glass p-6 text-sm text-zinc-400">
                Carregando identidade visual...
              </div>
            }
          >
            <BrandSuitePanel />
          </Suspense>
        </div>
      )}

      {/* TAB: CONFIGURAÇÕES */}
      {tab === 'config' && (
        <section key="admin-config" className="rounded-[22px] apple-glass p-5 max-w-2xl apple-view-enter">
          <h3 className="text-base font-bold text-white">Configurações da Barbearia</h3>

          <form onSubmit={handleSaveSettings} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs text-zinc-300 mb-1">Nome da Barbearia</label>
              <input
                type="text"
                value={shopName}
                onChange={(e) => {
                  setSettingsDirty(true);
                  setShopName(e.target.value);
                }}
                className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
              />
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Saldo Inicial do Caixa (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={openingBalance}
                  onChange={(e) => {
                    setSettingsDirty(true);
                    setOpeningBalance(sanitizeDecimalInput(e.target.value));
                  }}
                  placeholder="0,00"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Meta Diária (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={dailyGoal}
                  onChange={(e) => {
                    setSettingsDirty(true);
                    setDailyGoal(sanitizeDecimalInput(e.target.value));
                  }}
                  placeholder="0,00"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Meta Mensal (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={monthlyGoal}
                  onChange={(e) => {
                    setSettingsDirty(true);
                    setMonthlyGoal(sanitizeDecimalInput(e.target.value));
                  }}
                  placeholder="0,00"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
            </div>

            <button
              type="submit"
              className="min-h-[48px] px-6 rounded-2xl apple-btn-gold font-semibold text-sm transition-all"
            >
              Salvar Configurações
            </button>
          </form>
        </section>
      )}

      {/* TAB: BACKUP E NUVEM */}
      {tab === 'backup' && (
        <div key="admin-backup" className="grid lg:grid-cols-2 gap-6 apple-view-enter">
          <section className="rounded-[22px] apple-glass p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Database className="w-5 h-5 text-[#E6C65C]" />
              <h3 className="text-base font-bold text-white">Backup Local & Restauração</h3>
            </div>
            <p className="text-xs text-zinc-400">
              Todos os dados ficam persistidos no navegador (localStorage) e sincronizados com o servidor SQLite. Gere cópias de segurança a qualquer momento.
            </p>
            {settings.lastBackupAt && (
              <p className="text-xs text-zinc-300">
                Último backup registrado: <span className="font-mono">{new Date(settings.lastBackupAt).toLocaleString('pt-BR')}</span>
              </p>
            )}

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => void handleServerSnapshot()}
                className="min-h-[44px] px-4 rounded-xl apple-btn-gold font-semibold text-xs flex items-center gap-2 transition-all"
              >
                <Database className="w-4 h-4" />
                <span>Criar Snapshot no Servidor</span>
              </button>

              <button
                type="button"
                onClick={() => void handleExportBackupJSON()}
                className="min-h-[44px] px-4 rounded-xl apple-glass-well text-white font-semibold text-xs flex items-center gap-2 hover:bg-white/[0.1] transition-colors"
              >
                <Download className="w-4 h-4 text-[#E6C65C]" />
                <span>Baixar Backup (JSON)</span>
              </button>

              <label className="min-h-[44px] px-4 rounded-xl apple-glass-well text-white font-semibold text-xs flex items-center gap-2 hover:bg-white/[0.1] cursor-pointer transition-colors">
                <Upload className="w-4 h-4 text-emerald-400" />
                <span>Restaurar de Arquivo</span>
                <input type="file" accept=".json" onChange={handleRestoreFile} className="hidden" />
              </label>
            </div>

            <div className="pt-4 border-t border-white/[0.08]">
              <p className="text-xs font-semibold text-rose-400">Reinicialização Operacional</p>
              <p className="text-xs text-zinc-400 mt-1">
                Apaga lançamentos, atendimentos e fechamentos iniciais para começar o caixa completamente do zero (mantém serviços e usuários).
              </p>
              <button
                type="button"
                onClick={() => setConfirmResetModal(true)}
                className="mt-3 min-h-[42px] px-4 rounded-xl border border-rose-500/35 bg-rose-500/10 text-rose-300 text-xs font-semibold hover:bg-rose-500/20"
              >
                Zerar Caixa e Movimentações
              </button>
            </div>
          </section>

          <section className="rounded-[22px] apple-glass p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Cloud className="w-5 h-5 text-[#E6C65C]" />
              <h3 className="text-base font-bold text-white">Sincronização em Nuvem</h3>
            </div>
            <p className="text-xs text-zinc-400">
              Estrutura preparada para espelhamento automático com endpoint de nuvem externo ou servidor remoto da Barbearia Trindade.
            </p>
            <form onSubmit={handleSaveSettings} className="space-y-3">
              <label className="flex items-center gap-2.5 text-sm text-zinc-200 cursor-pointer min-h-[40px]">
                <input
                  type="checkbox"
                  checked={cloudSyncEnabled}
                  onChange={(e) => {
                    setSettingsDirty(true);
                    setCloudSyncEnabled(e.target.checked);
                  }}
                  className="w-4 h-4 accent-[#D4AF37]"
                />
                <span>Ativar preparação de sincronização automática</span>
              </label>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Endpoint Remoto (opcional)</label>
                <input
                  type="url"
                  value={cloudSyncUrl}
                  onChange={(e) => {
                    setSettingsDirty(true);
                    setCloudSyncUrl(e.target.value);
                  }}
                  placeholder="https://api.suabarbearia.com.br/sync"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <button
                type="submit"
                className="min-h-[44px] px-5 rounded-xl apple-btn-gold font-semibold text-xs transition-all"
              >
                Salvar Configuração de Nuvem
              </button>
            </form>
          </section>
        </div>
      )}

      {/* TAB: SENHAS */}
      {tab === 'senhas' && (
        <section key="admin-senhas" className="rounded-[22px] apple-glass p-5 max-w-lg apple-view-enter">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-[#E6C65C]" />
            <h3 className="text-base font-bold text-white">Configuração de Senhas</h3>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Altere sua senha de login, a senha da Área Administrativa ou a senha secreta da Área Privada.
          </p>

          <form onSubmit={handleChangePassword} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs text-zinc-300 mb-1">Qual senha deseja alterar?</label>
              <select
                value={pwdTarget}
                onChange={(e) => setPwdTarget(e.target.value as 'admin_pin' | 'private_pin' | 'user')}
                className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
              >
                <option value="admin_pin" className="bg-[#121216]">Senha da Área Administrativa</option>
                <option value="private_pin" className="bg-[#121216]">Senha da Área Privada (Cofre)</option>
                <option value="user" className="bg-[#121216]">Minha Senha de Login ({currentUser.email})</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-300 mb-1">Senha Atual</label>
              <input
                type="password"
                required
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-300 mb-1">Nova Senha (mín. 4 caracteres)</label>
              <input
                type="password"
                required
                minLength={4}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
              />
            </div>
            <button
              type="submit"
              className="min-h-[48px] px-6 rounded-2xl apple-btn-gold font-semibold text-sm transition-all"
            >
              Atualizar Senha
            </button>
          </form>
        </section>
      )}

      {/* Modal: Clear Operations */}
      {confirmResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-[28px] apple-glass-modal p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Confirmar Limpeza de Dados</h3>
              <button
                type="button"
                onClick={() => setConfirmResetModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.08]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Um backup automático será criado no servidor antes de zerar lançamentos e atendimentos. Digite a senha administrativa para confirmar:
            </p>
            <form onSubmit={handleClearOperations} className="mt-4 space-y-4">
              <input
                type="password"
                required
                value={resetPin}
                onChange={(e) => setResetPin(e.target.value)}
                placeholder="Senha administrativa"
                className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
              />
              <button
                type="submit"
                className="w-full min-h-[46px] rounded-2xl bg-rose-600 text-white font-semibold text-sm hover:bg-rose-500 transition-colors"
              >
                Confirmar e Zerar Caixa
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
