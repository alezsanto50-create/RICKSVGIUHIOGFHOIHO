import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarClock,
  Check,
  Copy,
  MessageCircle,
  Pencil,
  Plus,
  QrCode,
  Repeat,
  Trash2,
  X,
} from 'lucide-react';
import {
  CYCLE_LABELS,
  PAYMENT_LABELS,
  type AppSettings,
  type BillingCycle,
  type MembershipPlan,
  type PaymentMethod,
  type Subscriber,
  type Transaction,
} from '../types';
import {
  addDaysISO,
  formatBRL,
  formatDateBR,
  getNowTimeBR,
  getTodayBR,
  parseCurrencyInput,
  sanitizeDecimalInput,
} from '../lib/formatters';
import { apiRequest } from '../lib/api';
import { setPendingServerSync, shouldFallbackToLocalPersistence, useLocalDraft } from '../lib/storage';
import { buildPixBrCode, formatWhatsAppLink, generatePixQrDataUrl } from '../lib/pix';

interface SubscriptionsViewProps {
  settings: AppSettings;
  plans: MembershipPlan[];
  subscribers: Subscriber[];
  onSettingsUpdated: (settings: AppSettings) => void;
  onPlansChanged: (plans: MembershipPlan[]) => void;
  onSubscriberCreated: (sub: Subscriber) => void;
  onSubscriberUpdated: (sub: Subscriber) => void;
  onSubscriberDeleted: (id: string) => void;
  onSubscriptionPaid: (sub: Subscriber, tx: Transaction) => void;
}

type SubTab = 'mensalistas' | 'templates' | 'pix';
type SubFilter = 'todos' | 'pendentes' | 'semanal' | 'mensal';

function getDueStatus(nextDueDate: string, today: string): {
  kind: 'atrasado' | 'hoje' | 'proximo' | 'ok';
  label: string;
} {
  if (nextDueDate < today) {
    const diff = Math.round(
      (new Date(today + 'T00:00:00Z').getTime() - new Date(nextDueDate + 'T00:00:00Z').getTime()) / 86400000
    );
    return { kind: 'atrasado', label: `Atrasado há ${diff} dia(s)` };
  }
  if (nextDueDate === today) {
    return { kind: 'hoje', label: 'Vence hoje' };
  }
  const soonLimit = addDaysISO(today, 3);
  if (nextDueDate <= soonLimit) {
    return { kind: 'proximo', label: `Vence em ${formatDateBR(nextDueDate)}` };
  }
  return { kind: 'ok', label: `Próx. ${formatDateBR(nextDueDate)}` };
}

function advanceDateByCycleClient(dateISO: string, cycle: BillingCycle): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (cycle === 'semanal') dt.setUTCDate(dt.getUTCDate() + 7);
  else if (cycle === 'quinzenal') dt.setUTCDate(dt.getUTCDate() + 15);
  else dt.setUTCMonth(dt.getUTCMonth() + 1);
  return dt.toISOString().slice(0, 10);
}

export const SubscriptionsView: React.FC<SubscriptionsViewProps> = ({
  settings,
  plans,
  subscribers,
  onSettingsUpdated,
  onPlansChanged,
  onSubscriberCreated,
  onSubscriberUpdated,
  onSubscriberDeleted,
  onSubscriptionPaid,
}) => {
  const today = getTodayBR();
  const [tab, setTab] = useLocalDraft<SubTab>('sub_tab', 'mensalistas');
  const [filter, setFilter] = useLocalDraft<SubFilter>('sub_filter', 'todos');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Subscriber Modal
  const [showSubModal, setShowSubModal] = useLocalDraft('sub_modal_open', false);
  const [editingSub, setEditingSub] = useState<Subscriber | null>(null);
  const [clientName, setClientName] = useLocalDraft('sub_client_name', '');
  const [clientPhone, setClientPhone] = useLocalDraft('sub_client_phone', '');
  const [selectedPlanId, setSelectedPlanId] = useLocalDraft('sub_selected_plan_id', plans[0]?.id || 'custom');
  const [planName, setPlanName] = useLocalDraft('sub_plan_name', plans[0]?.name || '');
  const [includedServices, setIncludedServices] = useLocalDraft(
    'sub_included_services',
    plans[0]?.includedServices.join(', ') || ''
  );
  const [cycle, setCycle] = useLocalDraft<BillingCycle>('sub_cycle', plans[0]?.cycle || 'mensal');
  const [amount, setAmount] = useLocalDraft('sub_amount', plans[0] ? String(plans[0].price) : '');
  const [paymentMethod, setPaymentMethod] = useLocalDraft<PaymentMethod>('sub_payment_method', 'pix');
  const [nextDueDate, setNextDueDate] = useLocalDraft('sub_next_due_date', today);
  const [notes, setNotes] = useLocalDraft('sub_notes', '');
  const [savingSub, setSavingSub] = useState(false);
  const [confirmDeleteSubId, setConfirmDeleteSubId] = useState<string | null>(null);

  // Plan Modal
  const [showPlanModal, setShowPlanModal] = useLocalDraft('sub_plan_modal_open', false);
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null);
  const [pName, setPName] = useLocalDraft('sub_p_name', '');
  const [pDesc, setPDesc] = useLocalDraft('sub_p_desc', '');
  const [pServices, setPServices] = useLocalDraft('sub_p_services', 'Corte de cabelo, Barba');
  const [pCycle, setPCycle] = useLocalDraft<BillingCycle>('sub_p_cycle', 'mensal');
  const [pPrice, setPPrice] = useLocalDraft('sub_p_price', '');

  // PIX QR Modal
  const [pixModalSub, setPixModalSub] = useState<Subscriber | null>(null);
  const [pixQrUrl, setPixQrUrl] = useState('');
  const [pixBrCode, setPixBrCode] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  // PIX Config & Quick Charge
  const [pixDirty, setPixDirty] = useLocalDraft('sub_pix_dirty', false);
  const [pixKey, setPixKey] = useLocalDraft('sub_pix_key', settings.pixKey);
  const [pixHolderName, setPixHolderName] = useLocalDraft('sub_pix_holder', settings.pixHolderName);
  const [pixCity, setPixCity] = useLocalDraft('sub_pix_city', settings.pixCity);
  const [quickPixAmount, setQuickPixAmount] = useLocalDraft('sub_quick_pix_amount', '');
  const [quickPixDesc, setQuickPixDesc] = useLocalDraft('sub_quick_pix_desc', '');
  const [quickPixQr, setQuickPixQr] = useState('');
  const [quickPixCode, setQuickPixCode] = useState('');

  useEffect(() => {
    if (!pixDirty) {
      setPixKey(settings.pixKey);
      setPixHolderName(settings.pixHolderName);
      setPixCity(settings.pixCity);
    }
  }, [settings.pixKey, settings.pixHolderName, settings.pixCity, pixDirty, setPixKey, setPixHolderName, setPixCity]);

  const metrics = useMemo(() => {
    const activeSubs = subscribers.filter((s) => s.status === 'ativo');
    let pendingCount = 0;
    let mrr = 0;
    const soonLimit = addDaysISO(today, 3);
    for (const s of activeSubs) {
      if (s.nextDueDate <= soonLimit) pendingCount += 1;
      if (s.cycle === 'semanal') mrr += s.amount * 4;
      else if (s.cycle === 'quinzenal') mrr += s.amount * 2;
      else mrr += s.amount;
    }
    return { activeCount: activeSubs.length, pendingCount, mrr };
  }, [subscribers, today]);

  const filteredSubscribers = useMemo(() => {
    const soonLimit = addDaysISO(today, 3);
    return subscribers.filter((s) => {
      if (filter === 'pendentes') return s.status === 'ativo' && s.nextDueDate <= soonLimit;
      if (filter === 'semanal') return s.cycle === 'semanal';
      if (filter === 'mensal') return s.cycle === 'mensal';
      return true;
    });
  }, [subscribers, filter, today]);

  const openNewSubFromPlan = (plan?: MembershipPlan) => {
    setEditingSub(null);
    const targetPlan = plan || plans[0];
    setClientName('');
    setClientPhone('');
    setSelectedPlanId(targetPlan?.id || 'custom');
    setPlanName(targetPlan?.name || '');
    setIncludedServices(targetPlan ? targetPlan.includedServices.join(', ') : '');
    setCycle(targetPlan?.cycle || 'mensal');
    setAmount(targetPlan ? String(targetPlan.price) : '');
    setPaymentMethod('pix');
    setNextDueDate(today);
    setNotes('');
    setShowSubModal(true);
  };

  const openEditSub = (sub: Subscriber) => {
    setEditingSub(sub);
    setClientName(sub.clientName);
    setClientPhone(sub.clientPhone);
    setSelectedPlanId(sub.planId);
    setPlanName(sub.planName);
    setIncludedServices(sub.includedServices);
    setCycle(sub.cycle);
    setAmount(String(sub.amount));
    setPaymentMethod(sub.paymentMethod);
    setNextDueDate(sub.nextDueDate);
    setNotes(sub.notes);
    setShowSubModal(true);
  };

  const handlePlanChangeInForm = (id: string) => {
    setSelectedPlanId(id);
    const p = plans.find((item) => item.id === id);
    if (p) {
      setPlanName(p.name);
      setIncludedServices(p.includedServices.join(', '));
      setCycle(p.cycle);
      setAmount(String(p.price));
    }
  };

  const handleSaveSubscriber = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseCurrencyInput(amount);
    if (!clientName.trim() || !planName.trim() || !Number.isFinite(numAmount) || numAmount <= 0) {
      setFeedback({ type: 'err', text: 'Preencha cliente, plano e valor válido maior que zero.' });
      return;
    }

    setSavingSub(true);
    try {
      if (editingSub) {
        try {
          const updated = await apiRequest<Subscriber>(`/api/subscribers/${editingSub.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              clientName: clientName.trim(),
              clientPhone: clientPhone.trim(),
              planName: planName.trim(),
              includedServices: includedServices.trim(),
              cycle,
              amount: numAmount,
              paymentMethod,
              nextDueDate,
              notes: notes.trim(),
            }),
          });
          onSubscriberUpdated(updated);
          setFeedback({ type: 'ok', text: `Mensalista "${updated.clientName}" atualizado.` });
        } catch (err) {
          if (shouldFallbackToLocalPersistence(err)) {
            const localUpdated: Subscriber = {
              ...editingSub,
              clientName: clientName.trim(),
              clientPhone: clientPhone.trim(),
              planName: planName.trim(),
              includedServices: includedServices.trim(),
              cycle,
              amount: numAmount,
              paymentMethod,
              nextDueDate,
              notes: notes.trim(),
            };
            setPendingServerSync(true);
            onSubscriberUpdated(localUpdated);
            setFeedback({ type: 'ok', text: `Mensalista "${localUpdated.clientName}" atualizado no navegador.` });
          } else {
            throw err;
          }
        }
      } else {
        try {
          const created = await apiRequest<Subscriber>('/api/subscribers', {
            method: 'POST',
            body: JSON.stringify({
              clientName: clientName.trim(),
              clientPhone: clientPhone.trim(),
              planId: selectedPlanId,
              planName: planName.trim(),
              includedServices: includedServices.trim(),
              cycle,
              amount: numAmount,
              paymentMethod,
              nextDueDate,
              notes: notes.trim(),
            }),
          });
          onSubscriberCreated(created);
          setFeedback({ type: 'ok', text: `Mensalista "${created.clientName}" cadastrado com sucesso!` });
        } catch (err) {
          if (shouldFallbackToLocalPersistence(err)) {
            const localCreated: Subscriber = {
              id: `local_sub_${Date.now().toString(36)}`,
              clientName: clientName.trim(),
              clientPhone: clientPhone.trim(),
              planId: selectedPlanId,
              planName: planName.trim(),
              includedServices: includedServices.trim(),
              cycle,
              amount: numAmount,
              paymentMethod,
              nextDueDate: nextDueDate || today,
              lastPaidAt: null,
              status: 'ativo',
              notes: notes.trim(),
              createdAt: new Date().toISOString(),
            };
            setPendingServerSync(true);
            onSubscriberCreated(localCreated);
            setFeedback({ type: 'ok', text: `Mensalista "${localCreated.clientName}" salvo localmente!` });
          } else {
            throw err;
          }
        }
      }
      setShowSubModal(false);
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao salvar mensalista.' });
    } finally {
      setSavingSub(false);
    }
  };

  const handleDeleteSubscriber = async (id: string) => {
    try {
      await apiRequest(`/api/subscribers/${id}`, { method: 'DELETE' });
      onSubscriberDeleted(id);
      setConfirmDeleteSubId(null);
      setFeedback({ type: 'ok', text: 'Mensalista removido.' });
    } catch (err) {
      if (shouldFallbackToLocalPersistence(err)) {
        setPendingServerSync(true);
        onSubscriberDeleted(id);
        setConfirmDeleteSubId(null);
        setFeedback({ type: 'ok', text: 'Mensalista removido localmente.' });
      } else {
        setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao remover mensalista.' });
      }
    }
  };

  const handleMarkPaid = async (sub: Subscriber, methodOverride?: PaymentMethod) => {
    const finalPay = methodOverride || sub.paymentMethod || 'pix';
    try {
      let res: { subscriber: Subscriber; transaction: Transaction };
      try {
        res = await apiRequest<{ subscriber: Subscriber; transaction: Transaction }>(
          `/api/subscribers/${sub.id}/pay`,
          {
            method: 'POST',
            body: JSON.stringify({
              paymentMethod: finalPay,
              amount: sub.amount,
              paidDate: today,
            }),
          }
        );
      } catch (err) {
        if (shouldFallbackToLocalPersistence(err)) {
          const baseDateForNext = sub.nextDueDate >= today ? sub.nextDueDate : today;
          const nextDue = advanceDateByCycleClient(baseDateForNext, sub.cycle);
          const nowIso = new Date().toISOString();
          res = {
            subscriber: {
              ...sub,
              lastPaidAt: today,
              nextDueDate: nextDue,
              status: 'ativo',
            },
            transaction: {
              id: `local_trx_${Date.now().toString(36)}`,
              type: 'entrada',
              category: 'Planos / Assinaturas',
              description: `${sub.planName} — ${sub.clientName}`,
              amount: sub.amount,
              paymentMethod: finalPay,
              date: today,
              time: getNowTimeBR(),
              appointmentId: null,
              notes: `Renovação automática (${sub.cycle})`,
              createdBy: 'usr_owner',
              createdAt: nowIso,
              updatedAt: nowIso,
            },
          };
          setPendingServerSync(true);
        } else {
          throw err;
        }
      }
      onSubscriptionPaid(res.subscriber, res.transaction);
      setPixModalSub(null);
      setFeedback({
        type: 'ok',
        text: `Pagamento de ${sub.clientName} (${formatBRL(sub.amount)}) lançado no caixa! Próx. vencimento: ${formatDateBR(res.subscriber.nextDueDate)}.`,
      });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao registrar pagamento.' });
    }
  };

  const handleOpenPixModal = async (sub: Subscriber) => {
    if (!settings.pixKey.trim()) {
      setTab('pix');
      setFeedback({ type: 'err', text: 'Configure sua chave PIX antes de gerar a cobrança.' });
      return;
    }
    const brCode = buildPixBrCode({
      pixKey: settings.pixKey,
      merchantName: settings.pixHolderName || settings.shopName,
      merchantCity: settings.pixCity || 'SAO PAULO',
      amount: sub.amount,
      txid: `TRINDADE${sub.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}`,
    });
    const qr = await generatePixQrDataUrl(brCode);
    setPixBrCode(brCode);
    setPixQrUrl(qr);
    setCopiedCode(false);
    setPixModalSub(sub);
  };

  const buildReminderText = (sub: Subscriber) => {
    const brCode = settings.pixKey.trim()
      ? buildPixBrCode({
          pixKey: settings.pixKey,
          merchantName: settings.pixHolderName || settings.shopName,
          merchantCity: settings.pixCity || 'SAO PAULO',
          amount: sub.amount,
          txid: `TRINDADE${sub.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}`,
        })
      : '';

    return [
      `Olá ${sub.clientName}! Tudo bem?`,
      `Lembrete da sua assinatura *${sub.planName}* (${CYCLE_LABELS[sub.cycle]}) na *${settings.shopName}*.`,
      `Vencimento: ${formatDateBR(sub.nextDueDate)} · Valor: ${formatBRL(sub.amount)}`,
      sub.includedServices ? `Pacote incluso: ${sub.includedServices}` : '',
      brCode ? `\nPIX Copia e Cola:\n${brCode}` : settings.pixKey ? `\nChave PIX: ${settings.pixKey}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const handleCopyReminder = async (sub: Subscriber) => {
    const text = buildReminderText(sub);
    try {
      await navigator.clipboard.writeText(text);
      setFeedback({ type: 'ok', text: `Lembrete + PIX de ${sub.clientName} copiado!` });
    } catch {
      setFeedback({ type: 'err', text: 'Não foi possível copiar automaticamente.' });
    }
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    const numPrice = parseCurrencyInput(pPrice);
    if (!pName.trim() || !Number.isFinite(numPrice) || numPrice <= 0) {
      setFeedback({ type: 'err', text: 'Informe nome e valor positivo do pacote.' });
      return;
    }

    try {
      if (editingPlan) {
        try {
          const updated = await apiRequest<MembershipPlan>(`/api/plans/${editingPlan.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: pName.trim(),
              description: pDesc.trim(),
              includedServices: pServices,
              cycle: pCycle,
              price: numPrice,
            }),
          });
          onPlansChanged(plans.map((p) => (p.id === updated.id ? updated : p)));
          setFeedback({ type: 'ok', text: `Pacote "${updated.name}" atualizado.` });
        } catch (err) {
          if (shouldFallbackToLocalPersistence(err)) {
            const localPlan: MembershipPlan = {
              ...editingPlan,
              name: pName.trim(),
              description: pDesc.trim(),
              includedServices: pServices.split(',').map((s) => s.trim()).filter(Boolean),
              cycle: pCycle,
              price: numPrice,
            };
            setPendingServerSync(true);
            onPlansChanged(plans.map((p) => (p.id === localPlan.id ? localPlan : p)));
            setFeedback({ type: 'ok', text: `Pacote "${localPlan.name}" atualizado localmente.` });
          } else {
            throw err;
          }
        }
      } else {
        try {
          const created = await apiRequest<MembershipPlan>('/api/plans', {
            method: 'POST',
            body: JSON.stringify({
              name: pName.trim(),
              description: pDesc.trim(),
              includedServices: pServices,
              cycle: pCycle,
              price: numPrice,
            }),
          });
          onPlansChanged([...plans, created]);
          setFeedback({ type: 'ok', text: `Pacote "${created.name}" criado!` });
        } catch (err) {
          if (shouldFallbackToLocalPersistence(err)) {
            const localPlan: MembershipPlan = {
              id: `local_pln_${Date.now().toString(36)}`,
              name: pName.trim(),
              description: pDesc.trim(),
              includedServices: pServices.split(',').map((s) => s.trim()).filter(Boolean),
              cycle: pCycle,
              price: numPrice,
              active: true,
              isTemplate: false,
              createdAt: new Date().toISOString(),
            };
            setPendingServerSync(true);
            onPlansChanged([...plans, localPlan]);
            setFeedback({ type: 'ok', text: `Pacote "${localPlan.name}" salvo localmente!` });
          } else {
            throw err;
          }
        }
      }
      setShowPlanModal(false);
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao salvar pacote.' });
    }
  };

  const handleDeletePlan = async (id: string) => {
    try {
      await apiRequest(`/api/plans/${id}`, { method: 'DELETE' });
      onPlansChanged(plans.filter((p) => p.id !== id));
      setFeedback({ type: 'ok', text: 'Pacote removido.' });
    } catch (err) {
      if (shouldFallbackToLocalPersistence(err)) {
        setPendingServerSync(true);
        onPlansChanged(plans.filter((p) => p.id !== id));
        setFeedback({ type: 'ok', text: 'Pacote removido localmente.' });
      } else {
        setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao remover pacote.' });
      }
    }
  };

  const handleSavePixSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextPix = {
      pixKey: pixKey.trim(),
      pixHolderName: pixHolderName.trim() || 'BARBEARIA TRINDADE',
      pixCity: pixCity.trim() || 'SAO PAULO',
    };
    try {
      let updated: AppSettings;
      try {
        updated = await apiRequest<AppSettings>('/api/settings', {
          method: 'PUT',
          body: JSON.stringify(nextPix),
        });
      } catch (err) {
        if (shouldFallbackToLocalPersistence(err)) {
          updated = { ...settings, ...nextPix };
          setPendingServerSync(true);
        } else {
          throw err;
        }
      }
      setPixDirty(false);
      onSettingsUpdated(updated);
      setFeedback({ type: 'ok', text: 'Dados PIX da Barbearia Trindade salvos!' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao salvar PIX.' });
    }
  };

  const handleGenerateQuickPix = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pixKey.trim()) {
      setFeedback({ type: 'err', text: 'Informe e salve sua Chave PIX primeiro.' });
      return;
    }
    const amt = parseCurrencyInput(quickPixAmount);
    const code = buildPixBrCode({
      pixKey,
      merchantName: pixHolderName || settings.shopName,
      merchantCity: pixCity || 'SAO PAULO',
      amount: Number.isFinite(amt) && amt > 0 ? amt : undefined,
      txid: 'TRINDADEPIX',
    });
    const qr = await generatePixQrDataUrl(code);
    setQuickPixCode(code);
    setQuickPixQr(qr);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Compact KPI Strip */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <div className="rounded-[20px] apple-glass p-3 sm:p-4">
          <p className="text-[11px] sm:text-xs text-zinc-400 truncate">Assinantes</p>
          <p className="mt-1 text-lg sm:text-2xl font-bold font-mono tabular-nums text-white">
            {metrics.activeCount}
          </p>
        </div>
        <div className="rounded-[20px] apple-glass p-3 sm:p-4">
          <p className="text-[11px] sm:text-xs text-zinc-400 truncate">Lembretes</p>
          <p className={`mt-1 text-lg sm:text-2xl font-bold font-mono tabular-nums ${metrics.pendingCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {metrics.pendingCount}
          </p>
        </div>
        <div className="rounded-[20px] apple-glass-hero p-3 sm:p-4">
          <p className="text-[11px] sm:text-xs text-[#E6C65C] truncate">Mensal Est.</p>
          <p className="mt-1 text-base sm:text-2xl font-bold font-mono tabular-nums text-white truncate">
            {formatBRL(metrics.mrr)}
          </p>
        </div>
      </div>

      {/* Sub-navigation + Main CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <div className="relative grid grid-cols-3 p-1 rounded-2xl apple-glass-well sm:w-80">
          <div
            aria-hidden="true"
            className="absolute inset-y-1 left-1 w-[calc(33.3333%-2.66px)] rounded-xl apple-btn-gold pointer-events-none transition-transform duration-300 ease-[cubic-bezier(0.32,1.25,0.36,1)]"
            style={{
              transform: `translateX(${tab === 'mensalistas' ? '0%' : tab === 'templates' ? '100%' : '200%'})`,
            }}
          />
          {([
            { id: 'mensalistas', label: 'Lembretes' },
            { id: 'templates', label: 'Pacotes' },
            { id: 'pix', label: 'Versão PIX' },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative z-10 min-h-[40px] px-3 rounded-xl text-xs font-semibold apple-tab-spring whitespace-nowrap ${
                tab === t.id ? 'text-[#09090B]' : 'text-zinc-300/85 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'mensalistas' && (
          <button
            type="button"
            onClick={() => openNewSubFromPlan()}
            className="min-h-[44px] px-4 rounded-2xl apple-btn-gold font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Mensalista</span>
          </button>
        )}

        {tab === 'templates' && (
          <button
            type="button"
            onClick={() => {
              setEditingPlan(null);
              setPName('');
              setPDesc('');
              setPServices('Corte de cabelo, Barba, Sobrancelha');
              setPCycle('mensal');
              setPPrice('');
              setShowPlanModal(true);
            }}
            className="min-h-[44px] px-4 rounded-2xl apple-btn-gold font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Pacote</span>
          </button>
        )}
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
            feedback.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* TAB 1: MENSALISTAS & LEMBRETES */}
      {tab === 'mensalistas' && (
        <section key="tab-mensalistas" className="rounded-[22px] apple-glass p-3.5 sm:p-5 space-y-3.5 apple-view-enter">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {([
              { id: 'todos', label: 'Todos' },
              { id: 'pendentes', label: `Lembretes (${metrics.pendingCount})` },
              { id: 'semanal', label: 'Semanais' },
              { id: 'mensal', label: 'Mensais' },
            ] as const).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border transition-all ${
                  filter === f.id
                    ? 'bg-[#D4AF37]/16 border-[#D4AF37]/75 text-[#E6C65C]'
                    : 'apple-glass-well text-zinc-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredSubscribers.length === 0 ? (
            <div className="py-10 text-center">
              <Bell className="w-7 h-7 text-zinc-600 mx-auto" />
              <p className="mt-2 text-sm text-zinc-400">Nenhum mensalista encontrado para este filtro.</p>
              <button
                type="button"
                onClick={() => setTab('templates')}
                className="mt-3 min-h-[42px] px-4 rounded-2xl apple-btn-gold text-xs font-semibold"
              >
                Ver Templates de Pacotes
              </button>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {filteredSubscribers.map((sub) => {
                const due = getDueStatus(sub.nextDueDate, today);
                const statusColor =
                  due.kind === 'atrasado'
                    ? 'text-rose-400'
                    : due.kind === 'hoje'
                    ? 'text-amber-400'
                    : due.kind === 'proximo'
                    ? 'text-[#E6C65C]'
                    : 'text-emerald-400';

                return (
                  <div key={sub.id} className="py-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-white">{sub.clientName}</span>
                          <span aria-hidden="true" className="text-zinc-600">·</span>
                          <span className={`text-xs font-semibold ${statusColor}`}>{due.label}</span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {sub.planName} · {CYCLE_LABELS[sub.cycle]} · {PAYMENT_LABELS[sub.paymentMethod]}
                        </p>
                        {sub.includedServices && (
                          <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{sub.includedServices}</p>
                        )}
                      </div>
                      <span className="text-sm sm:text-base font-bold font-mono tabular-nums text-[#E6C65C] shrink-0">
                        {formatBRL(sub.amount)}
                      </span>
                    </div>

                    {/* Compact Action Bar */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleOpenPixModal(sub)}
                        className="min-h-[40px] px-3 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/40 text-[#E6C65C] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#D4AF37]/25 transition-colors"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>PIX QR</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleMarkPaid(sub)}
                        className="min-h-[40px] px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-emerald-500/25 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Dar Baixa</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleCopyReminder(sub)}
                        className="min-h-[40px] px-3 rounded-xl apple-glass-well text-zinc-200 text-xs font-medium flex items-center gap-1.5 hover:bg-white/[0.1] transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar Lembrete</span>
                      </button>

                      {sub.clientPhone && (
                        <a
                          href={formatWhatsAppLink(sub.clientPhone, buildReminderText(sub))}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[40px] px-3 rounded-xl apple-glass-well text-emerald-400 text-xs font-medium flex items-center gap-1.5 hover:border-emerald-500/40 transition-colors"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          <span>WhatsApp</span>
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => openEditSub(sub)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/5"
                        title="Editar mensalista"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>

                      {confirmDeleteSubId === sub.id ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteSubscriber(sub.id)}
                          className="min-h-[40px] px-2.5 rounded-xl bg-rose-600 text-white text-xs font-semibold"
                        >
                          Confirmar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteSubId(sub.id)}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10"
                          title="Excluir mensalista"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: TEMPLATES DE PACOTES COMPLETOS */}
      {tab === 'templates' && (
        <div key="tab-templates" className="grid sm:grid-cols-2 gap-3.5 sm:gap-4 apple-view-enter">
          {plans.map((plan) => (
            <section
              key={plan.id}
              className="rounded-[22px] apple-glass p-4 sm:p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold text-[#E6C65C]">
                      {CYCLE_LABELS[plan.cycle]} {plan.isTemplate ? '· Template Barbearia' : ''}
                    </span>
                    <h3 className="mt-1 text-base font-bold text-white">{plan.name}</h3>
                  </div>
                  <span className="text-lg font-bold font-mono tabular-nums text-emerald-400 shrink-0">
                    {formatBRL(plan.price)}
                  </span>
                </div>

                <p className="mt-2 text-xs text-zinc-400 leading-relaxed">{plan.description}</p>

                <p className="mt-3 text-xs text-zinc-300">
                  <strong className="text-zinc-400 font-medium">Incluso:</strong>{' '}
                  {plan.includedServices.join(' · ')}
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => openNewSubFromPlan(plan)}
                  className="flex-1 min-h-[44px] rounded-xl apple-btn-gold font-semibold text-xs flex items-center justify-center gap-1.5 transition-all"
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>Assinar Cliente</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPlan(plan);
                    setPName(plan.name);
                    setPDesc(plan.description);
                    setPServices(plan.includedServices.join(', '));
                    setPCycle(plan.cycle);
                    setPPrice(String(plan.price));
                    setShowPlanModal(true);
                  }}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl apple-glass-well text-zinc-300 hover:bg-white/[0.1]"
                  title="Editar pacote"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeletePlan(plan.id)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl apple-glass-well text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10"
                  title="Excluir pacote"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* TAB 3: VERSÃO PIX & GERADOR INSTANTÂNEO */}
      {tab === 'pix' && (
        <div key="tab-pix" className="grid lg:grid-cols-2 gap-4 sm:gap-6 items-start apple-view-enter">
          <section className="rounded-[22px] apple-glass p-4 sm:p-5">
            <h3 className="text-base font-bold text-white">Chave PIX da Barbearia</h3>
            <p className="text-xs text-zinc-400 mt-1">
              Usada para gerar QR Code oficial (BR Code) e PIX Copia e Cola nas mensalidades e cobranças rápidas.
            </p>
            <form onSubmit={handleSavePixSettings} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Chave PIX (CPF/CNPJ, Celular, E-mail ou Aleatória)</label>
                <input
                  type="text"
                  required
                  value={pixKey}
                  onChange={(e) => {
                    setPixDirty(true);
                    setPixKey(e.target.value);
                  }}
                  placeholder="CPF, CNPJ, celular, e-mail ou chave aleatória"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Nome do Recebedor</label>
                  <input
                    type="text"
                    required
                    value={pixHolderName}
                    onChange={(e) => {
                      setPixDirty(true);
                      setPixHolderName(e.target.value);
                    }}
                    className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Cidade</label>
                  <input
                    type="text"
                    required
                    value={pixCity}
                    onChange={(e) => {
                      setPixDirty(true);
                      setPixCity(e.target.value);
                    }}
                    className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full min-h-[46px] rounded-2xl apple-btn-gold font-semibold text-sm transition-all"
              >
                Salvar Chave PIX
              </button>
            </form>
          </section>

          <section className="rounded-[22px] apple-glass p-4 sm:p-5">
            <h3 className="text-base font-bold text-white">Cobrança PIX Rápida no Balcão</h3>
            <p className="text-xs text-zinc-400 mt-1">
              Gere um QR Code PIX na hora para o cliente pagar pelo celular.
            </p>
            <form onSubmit={handleGenerateQuickPix} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Valor (R$)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={quickPixAmount}
                    onChange={(e) => setQuickPixAmount(sanitizeDecimalInput(e.target.value))}
                    placeholder="0,00"
                    className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Referência</label>
                  <input
                    type="text"
                    value={quickPixDesc}
                    onChange={(e) => setQuickPixDesc(e.target.value)}
                    placeholder="Ex: Corte + Barba"
                    className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full min-h-[46px] rounded-2xl border border-[#D4AF37]/45 bg-[#D4AF37]/15 text-[#E6C65C] font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#D4AF37]/25 transition-colors"
              >
                <QrCode className="w-4 h-4" />
                <span>Gerar QR Code PIX</span>
              </button>
            </form>

            {quickPixQr && (
              <div className="mt-4 pt-4 border-t border-white/[0.08] flex flex-col items-center text-center">
                <div className="p-3 rounded-2xl bg-white shadow-lg">
                  <img src={quickPixQr} alt="QR Code PIX" className="w-44 h-44" />
                </div>
                <p className="mt-2 text-xs text-zinc-400">{quickPixDesc}</p>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(quickPixCode);
                    setFeedback({ type: 'ok', text: 'PIX Copia e Cola copiado!' });
                  }}
                  className="mt-3 min-h-[42px] px-4 rounded-xl apple-glass-well text-xs font-semibold text-white flex items-center gap-2 hover:bg-white/[0.1] transition-colors"
                >
                  <Copy className="w-3.5 h-3.5 text-[#E6C65C]" />
                  <span>Copiar PIX Copia e Cola</span>
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {/* MODAL: CADASTRAR / EDITAR MENSALISTA */}
      {showSubModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-4 apple-backdrop-in">
          <div className="w-full sm:max-w-md rounded-t-[30px] sm:rounded-[28px] apple-glass-modal p-5 pb-safe max-h-[90vh] overflow-y-auto apple-sheet-up">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                {editingSub ? 'Editar Mensalista' : 'Cadastrar Mensalista'}
              </h3>
              <button
                type="button"
                onClick={() => setShowSubModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.08]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSubscriber} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Nome do Cliente</label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ex: João Lucas"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">WhatsApp (com DDD)</label>
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="11999998888"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>

              {!editingSub && (
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Template / Pacote</label>
                  <select
                    value={selectedPlanId}
                    onChange={(e) => handlePlanChangeInForm(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id} className="bg-[#121216]">
                        {p.name} ({CYCLE_LABELS[p.cycle]} · {formatBRL(p.price)})
                      </option>
                    ))}
                    <option value="custom" className="bg-[#121216]">Personalizado</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-zinc-300 mb-1">Nome do Plano / Pacote</label>
                <input
                  type="text"
                  required
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Cobrança / Lembrete</label>
                  <select
                    value={cycle}
                    onChange={(e) => setCycle(e.target.value as BillingCycle)}
                    className="w-full min-h-[44px] px-3 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                  >
                    <option value="semanal" className="bg-[#121216]">Por Semana</option>
                    <option value="quinzenal" className="bg-[#121216]">Quinzenal</option>
                    <option value="mensal" className="bg-[#121216]">Por Mês</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Valor (R$)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={amount}
                    onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
                    placeholder="0,00"
                    className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Próximo Vencimento</label>
                  <input
                    type="date"
                    required
                    value={nextDueDate}
                    onChange={(e) => setNextDueDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Pagamento Padrão</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full min-h-[44px] px-3 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                  >
                    <option value="pix" className="bg-[#121216]">PIX</option>
                    <option value="dinheiro" className="bg-[#121216]">Dinheiro</option>
                    <option value="debito" className="bg-[#121216]">Débito</option>
                    <option value="credito" className="bg-[#121216]">Crédito</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-300 mb-1">Serviços Inclusos</label>
                <input
                  type="text"
                  value={includedServices}
                  onChange={(e) => setIncludedServices(e.target.value)}
                  placeholder="Corte, Barba, Sobrancelha"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>

              <button
                type="submit"
                disabled={savingSub}
                className="w-full min-h-[48px] rounded-2xl apple-btn-gold font-semibold text-sm transition-all"
              >
                {savingSub ? 'Salvando...' : editingSub ? 'Salvar Alterações' : 'Confirmar Assinatura'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CRIAR / EDITAR TEMPLATE DE PACOTE */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-4 apple-backdrop-in">
          <div className="w-full sm:max-w-md rounded-t-[30px] sm:rounded-[28px] apple-glass-modal p-5 pb-safe apple-sheet-up">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">{editingPlan ? 'Editar Pacote' : 'Novo Pacote de Barbearia'}</h3>
              <button
                type="button"
                onClick={() => setShowPlanModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.08]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSavePlan} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Nome do Pacote</label>
                <input
                  type="text"
                  required
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  placeholder="Ex: Pacote Executivo Mensal"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Periodicidade</label>
                  <select
                    value={pCycle}
                    onChange={(e) => setPCycle(e.target.value as BillingCycle)}
                    className="w-full min-h-[44px] px-3 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                  >
                    <option value="semanal" className="bg-[#121216]">Semanal</option>
                    <option value="quinzenal" className="bg-[#121216]">Quinzenal</option>
                    <option value="mensal" className="bg-[#121216]">Mensal</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Valor (R$)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={pPrice}
                    onChange={(e) => setPPrice(sanitizeDecimalInput(e.target.value))}
                    placeholder="0,00"
                    className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Serviços Inclusos (separados por vírgula)</label>
                <input
                  type="text"
                  required
                  value={pServices}
                  onChange={(e) => setPServices(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Descrição</label>
                <input
                  type="text"
                  value={pDesc}
                  onChange={(e) => setPDesc(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <button
                type="submit"
                className="w-full min-h-[48px] rounded-2xl apple-btn-gold font-semibold text-sm transition-all"
              >
                Salvar Pacote
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PIX QR CODE DA MENSALIDADE */}
      {pixModalSub && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-4 apple-backdrop-in">
          <div className="w-full sm:max-w-sm rounded-t-[30px] sm:rounded-[28px] apple-glass-modal !border-[#D4AF37]/30 p-5 pb-safe text-center apple-sheet-up">
            <div className="flex items-center justify-between">
              <div className="text-left">
                <p className="text-xs font-semibold text-[#E6C65C]">Cobrança PIX · {CYCLE_LABELS[pixModalSub.cycle]}</p>
                <h3 className="text-base font-bold text-white">{pixModalSub.clientName}</h3>
              </div>
              <button
                type="button"
                onClick={() => setPixModalSub(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.08]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">
              {formatBRL(pixModalSub.amount)}
            </p>
            <p className="text-xs text-zinc-400">{pixModalSub.planName}</p>

            <div className="mt-4 inline-block p-3 rounded-2xl bg-white shadow-xl">
              <img src={pixQrUrl} alt="QR Code PIX da Mensalidade" className="w-48 h-48" />
            </div>

            <div className="mt-4 space-y-2.5">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(pixBrCode);
                  setCopiedCode(true);
                }}
                className="w-full min-h-[46px] rounded-2xl apple-glass-well text-white text-xs font-semibold flex items-center justify-center gap-2 hover:bg-white/[0.1] transition-colors"
              >
                <Copy className="w-4 h-4 text-[#E6C65C]" />
                <span>{copiedCode ? 'PIX Copia e Cola Copiado!' : 'Copiar Código PIX'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleMarkPaid(pixModalSub, 'pix')}
                className="w-full min-h-[48px] rounded-2xl bg-emerald-500 text-[#09090B] font-bold text-sm flex items-center justify-center gap-2 hover:bg-emerald-400 transition-colors"
              >
                <CalendarClock className="w-4 h-4" />
                <span>Confirmar PIX Recebido</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
