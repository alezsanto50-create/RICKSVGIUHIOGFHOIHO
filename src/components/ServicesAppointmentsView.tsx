import React, { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, Scissors, Search, Trash2, X } from 'lucide-react';
import {
  PAYMENT_LABELS,
  type Appointment,
  type PaymentMethod,
  type ServiceItem,
  type Transaction,
  type User,
} from '../types';
import {
  formatBRL,
  formatDateBR,
  getNowTimeBR,
  getTodayBR,
  parseCurrencyInput,
  sanitizeDecimalInput,
} from '../lib/formatters';
import { apiRequest } from '../lib/api';
import { hasDraft, setPendingServerSync, shouldFallbackToLocalPersistence, useLocalDraft } from '../lib/storage';

interface ServicesAppointmentsViewProps {
  currentUser: User;
  services: ServiceItem[];
  appointments: Appointment[];
  onAppointmentCreated: (apt: Appointment, tx: Transaction) => void;
  onAppointmentUpdated: (apt: Appointment, tx: Transaction | null) => void;
  onAppointmentDeleted: (aptId: string, txId: string | null) => void;
  onServicesChanged: (services: ServiceItem[]) => void;
}

const PAYMENT_OPTIONS: PaymentMethod[] = ['pix', 'dinheiro', 'debito', 'credito'];

export const ServicesAppointmentsView: React.FC<ServicesAppointmentsViewProps> = ({
  currentUser,
  services,
  appointments,
  onAppointmentCreated,
  onAppointmentUpdated,
  onAppointmentDeleted,
  onServicesChanged,
}) => {
  const activeServices = useMemo(() => services.filter((s) => s.active), [services]);

  const [selectedServiceId, setSelectedServiceId] = useLocalDraft<string>(
    'srv_selected_id',
    activeServices[0]?.id || 'custom'
  );
  const [customServiceName, setCustomServiceName] = useLocalDraft('srv_custom_name', '');
  const [amount, setAmount] = useLocalDraft<string>(
    'srv_amount',
    activeServices[0] ? String(activeServices[0].price) : ''
  );
  const [paymentMethod, setPaymentMethod] = useLocalDraft<PaymentMethod>('srv_payment_method', 'pix');
  const [date, setDate] = useLocalDraft('srv_date', getTodayBR());
  const [time, setTime] = useLocalDraft('srv_time', getNowTimeBR());
  const [clientName, setClientName] = useLocalDraft('srv_client_name', '');
  const [barberName, setBarberName] = useLocalDraft('srv_barber_name', currentUser.name);
  const [notes, setNotes] = useLocalDraft('srv_notes', '');
  const [editingId, setEditingId] = useLocalDraft<string | null>('srv_editing_id', null);

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filter for history
  const [filterDate, setFilterDate] = useLocalDraft('srv_filter_date', getTodayBR());
  const [showAllDates, setShowAllDates] = useLocalDraft('srv_show_all_dates', false);
  const [searchQuery, setSearchQuery] = useLocalDraft('srv_search_query', '');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Mobile focused view toggle
  const [mobilePane, setMobilePane] = useLocalDraft<'form' | 'history'>('srv_mobile_pane', 'form');

  // Quick Service Creator Modal
  const [showServiceModal, setShowServiceModal] = useLocalDraft('srv_modal_open', false);
  const [newSrvName, setNewSrvName] = useLocalDraft('srv_new_name', '');
  const [newSrvCategory, setNewSrvCategory] = useLocalDraft('srv_new_category', 'Personalizado');
  const [newSrvPrice, setNewSrvPrice] = useLocalDraft('srv_new_price', '');
  const [newSrvDuration, setNewSrvDuration] = useLocalDraft('srv_new_duration', '30');

  // Sync default selected service price once when services load if user hasn't typed an amount yet
  useEffect(() => {
    if (!editingId && activeServices.length > 0 && !amount && !hasDraft('srv_amount')) {
      const target = activeServices.find((s) => s.id === selectedServiceId) || activeServices[0];
      setSelectedServiceId(target.id);
      setAmount(String(target.price));
    }
  }, [activeServices, editingId, amount, selectedServiceId, setAmount, setSelectedServiceId]);

  const handleSelectService = (srv: ServiceItem) => {
    setSelectedServiceId(srv.id);
    setAmount(String(srv.price));
  };

  const resetForm = () => {
    setEditingId(null);
    const first = activeServices[0];
    setSelectedServiceId(first?.id || 'custom');
    setCustomServiceName('');
    setAmount(first ? String(first.price) : '');
    setPaymentMethod('pix');
    setDate(getTodayBR());
    setTime(getNowTimeBR());
    setClientName('');
    setBarberName(currentUser.name);
    setNotes('');
  };

  const handleSubmitAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const chosenService = services.find((s) => s.id === selectedServiceId);
    const serviceName = selectedServiceId === 'custom' ? customServiceName.trim() : chosenService?.name || '';
    const numAmount = parseCurrencyInput(amount);

    if (!serviceName) {
      setFeedback({ type: 'err', text: 'Selecione ou informe o nome do serviço.' });
      return;
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setFeedback({ type: 'err', text: 'Informe um valor válido maior que R$ 0,00.' });
      return;
    }

    setSubmitting(true);
    try {
      if (editingId) {
        try {
          const res = await apiRequest<{ appointment: Appointment; transaction: Transaction | null }>(
            `/api/appointments/${editingId}`,
            {
              method: 'PUT',
              body: JSON.stringify({
                serviceId: selectedServiceId,
                serviceName,
                barberName,
                clientName,
                amount: numAmount,
                date,
                time,
                paymentMethod,
                notes,
              }),
            }
          );
          onAppointmentUpdated(res.appointment, res.transaction);
          setFeedback({ type: 'ok', text: 'Atendimento e lançamento financeiro atualizados.' });
          resetForm();
        } catch (err) {
          if (shouldFallbackToLocalPersistence(err)) {
            const existing = appointments.find((a) => a.id === editingId);
            const nowIso = new Date().toISOString();
            const localApt: Appointment = {
              id: editingId,
              serviceId: selectedServiceId,
              serviceName,
              barberName: barberName || currentUser.name,
              clientName: clientName.trim(),
              amount: numAmount,
              date: date || getTodayBR(),
              time: time || getNowTimeBR(),
              paymentMethod,
              notes: notes.trim(),
              transactionId: existing?.transactionId || null,
              createdBy: existing?.createdBy || currentUser.id,
              createdAt: existing?.createdAt || nowIso,
            };
            const localTx: Transaction | null = localApt.transactionId
              ? {
                  id: localApt.transactionId,
                  type: 'entrada',
                  category: 'Serviços de Barbearia',
                  description: `${serviceName}${clientName.trim() ? ` — ${clientName.trim()}` : ''}`,
                  amount: numAmount,
                  paymentMethod,
                  date: localApt.date,
                  time: localApt.time,
                  appointmentId: editingId,
                  notes: notes.trim(),
                  createdBy: currentUser.id,
                  createdAt: existing?.createdAt || nowIso,
                  updatedAt: nowIso,
                }
              : null;
            setPendingServerSync(true);
            onAppointmentUpdated(localApt, localTx);
            setFeedback({ type: 'ok', text: 'Atendimento atualizado e salvo no navegador.' });
            resetForm();
          } else {
            throw err;
          }
        }
      } else {
        try {
          const res = await apiRequest<{ appointment: Appointment; transaction: Transaction }>('/api/appointments', {
            method: 'POST',
            body: JSON.stringify({
              serviceId: selectedServiceId,
              serviceName,
              barberName,
              clientName,
              amount: numAmount,
              date,
              time,
              paymentMethod,
              notes,
            }),
          });
          onAppointmentCreated(res.appointment, res.transaction);
          setFeedback({ type: 'ok', text: `Atendimento "${serviceName}" registrado no caixa!` });
          setClientName('');
          setNotes('');
          setTime(getNowTimeBR());
        } catch (err) {
          if (shouldFallbackToLocalPersistence(err)) {
            const nowIso = new Date().toISOString();
            const rand = Math.random().toString(36).slice(2, 6);
            const aptId = `local_apt_${Date.now().toString(36)}_${rand}`;
            const txId = `local_trx_${Date.now().toString(36)}_${rand}`;
            const finalDate = date || getTodayBR();
            const finalTime = time || getNowTimeBR();
            const finalClient = clientName.trim();
            const finalNotes = notes.trim();
            const localApt: Appointment = {
              id: aptId,
              serviceId: selectedServiceId,
              serviceName,
              barberName: barberName || currentUser.name,
              clientName: finalClient,
              amount: numAmount,
              date: finalDate,
              time: finalTime,
              paymentMethod,
              notes: finalNotes,
              transactionId: txId,
              createdBy: currentUser.id,
              createdAt: nowIso,
            };
            const localTx: Transaction = {
              id: txId,
              type: 'entrada',
              category: 'Serviços de Barbearia',
              description: `${serviceName}${finalClient ? ` — ${finalClient}` : ''}`,
              amount: numAmount,
              paymentMethod,
              date: finalDate,
              time: finalTime,
              appointmentId: aptId,
              notes: finalNotes,
              createdBy: currentUser.id,
              createdAt: nowIso,
              updatedAt: nowIso,
            };
            setPendingServerSync(true);
            onAppointmentCreated(localApt, localTx);
            setFeedback({ type: 'ok', text: `Atendimento "${serviceName}" salvo no navegador!` });
            setClientName('');
            setNotes('');
            setTime(getNowTimeBR());
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao salvar atendimento.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEdit = (apt: Appointment) => {
    setEditingId(apt.id);
    const matched = services.find((s) => s.id === apt.serviceId);
    if (matched) {
      setSelectedServiceId(matched.id);
      setCustomServiceName('');
    } else {
      setSelectedServiceId('custom');
      setCustomServiceName(apt.serviceName);
    }
    setAmount(String(apt.amount));
    setPaymentMethod(apt.paymentMethod);
    setDate(apt.date);
    setTime(apt.time);
    setClientName(apt.clientName);
    setBarberName(apt.barberName);
    setNotes(apt.notes);
    setMobilePane('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteAppointment = async (id: string) => {
    const existing = appointments.find((a) => a.id === id);
    try {
      const res = await apiRequest<{ ok: boolean; deletedTransactionId: string | null }>(`/api/appointments/${id}`, {
        method: 'DELETE',
      });
      onAppointmentDeleted(id, res.deletedTransactionId);
      setConfirmDeleteId(null);
      setFeedback({ type: 'ok', text: 'Atendimento e entrada vinculada removidos.' });
    } catch (err) {
      if (shouldFallbackToLocalPersistence(err)) {
        setPendingServerSync(true);
        onAppointmentDeleted(id, existing?.transactionId || null);
        setConfirmDeleteId(null);
        setFeedback({ type: 'ok', text: 'Atendimento removido localmente.' });
      } else {
        setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao excluir atendimento.' });
      }
    }
  };

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    const numPrice = parseCurrencyInput(newSrvPrice);
    if (!newSrvName.trim() || !Number.isFinite(numPrice) || numPrice <= 0) {
      setFeedback({ type: 'err', text: 'Informe o nome e um preço válido maior que zero.' });
      return;
    }

    try {
      let created: ServiceItem;
      try {
        created = await apiRequest<ServiceItem>('/api/services', {
          method: 'POST',
          body: JSON.stringify({
            name: newSrvName.trim(),
            category: newSrvCategory.trim() || 'Personalizado',
            price: numPrice,
            durationMin: Number(newSrvDuration) || 30,
          }),
        });
      } catch (err) {
        if (shouldFallbackToLocalPersistence(err)) {
          created = {
            id: `local_srv_${Date.now().toString(36)}`,
            name: newSrvName.trim(),
            category: newSrvCategory.trim() || 'Personalizado',
            price: numPrice,
            durationMin: Number(newSrvDuration) || 30,
            active: true,
            createdAt: new Date().toISOString(),
          };
          setPendingServerSync(true);
        } else {
          throw err;
        }
      }
      onServicesChanged([...services, created]);
      setSelectedServiceId(created.id);
      setAmount(String(created.price));
      setNewSrvName('');
      setNewSrvPrice('');
      setShowServiceModal(false);
      setFeedback({ type: 'ok', text: `Serviço "${created.name}" cadastrado.` });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao cadastrar serviço.' });
    }
  };

  const filteredAppointments = useMemo(() => {
    return appointments.filter((a) => {
      if (!showAllDates && filterDate && a.date !== filterDate) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          a.serviceName.toLowerCase().includes(q) ||
          a.clientName.toLowerCase().includes(q) ||
          a.barberName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [appointments, filterDate, showAllDates, searchQuery]);

  const filteredTotal = useMemo(
    () => filteredAppointments.reduce((acc, a) => acc + a.amount, 0),
    [filteredAppointments]
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Mobile Segmented Switcher (keeps mobile clean & focused) */}
      <div className="lg:hidden relative grid grid-cols-2 p-1 rounded-2xl apple-glass-well">
        <div
          aria-hidden="true"
          className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-xl apple-btn-gold pointer-events-none transition-transform duration-300 ease-[cubic-bezier(0.32,1.25,0.36,1)]"
          style={{ transform: `translateX(${mobilePane === 'history' ? '100%' : '0%'})` }}
        />
        <button
          type="button"
          onClick={() => setMobilePane('form')}
          className={`relative z-10 min-h-[40px] rounded-xl text-xs font-semibold apple-tab-spring ${
            mobilePane === 'form' ? 'text-[#09090B]' : 'text-zinc-300 hover:text-white'
          }`}
        >
          {editingId ? 'Editando' : 'Registrar'}
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('history')}
          className={`relative z-10 min-h-[40px] rounded-xl text-xs font-semibold apple-tab-spring ${
            mobilePane === 'history' ? 'text-[#09090B]' : 'text-zinc-300 hover:text-white'
          }`}
        >
          Histórico ({filteredAppointments.length})
        </button>
      </div>

      <div className="grid lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        {/* Form: Register Appointment */}
        <section className={`lg:col-span-5 rounded-[22px] apple-glass p-4 sm:p-5 ${mobilePane === 'form' ? 'block' : 'hidden lg:block'}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                {editingId ? 'Editar Atendimento' : 'Registrar Atendimento'}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5 hidden sm:block">
                Entrada automática no caixa ao concluir
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowServiceModal(true)}
              className="min-h-[40px] px-3 py-1.5 rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/12 text-[#E6C65C] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#D4AF37]/20 whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo Serviço</span>
            </button>
          </div>

          <form onSubmit={handleSubmitAppointment} className="mt-5 space-y-4">
            {/* Quick Service Selector */}
            <div>
              <span className="block text-xs font-medium text-zinc-300 mb-2">Escolha o Serviço</span>
              <div className="grid grid-cols-2 gap-2">
                {activeServices.map((srv) => {
                  const active = selectedServiceId === srv.id;
                  return (
                    <button
                      key={srv.id}
                      type="button"
                      onClick={() => handleSelectService(srv)}
                      className={`min-h-[52px] p-3 rounded-2xl border text-left transition-all ${
                        active
                          ? 'border-[#D4AF37]/80 bg-[#D4AF37]/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                          : 'apple-glass-well text-zinc-300 hover:bg-white/[0.08]'
                      }`}
                    >
                      <span className="block text-xs font-semibold truncate">{srv.name}</span>
                      <span className={`block text-xs font-mono tabular-nums mt-0.5 ${active ? 'text-[#E6C65C]' : 'text-zinc-400'}`}>
                        {formatBRL(srv.price)}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedServiceId('custom');
                    setAmount('');
                  }}
                  className={`min-h-[52px] p-3 rounded-2xl border text-left transition-all ${
                    selectedServiceId === 'custom'
                      ? 'border-[#D4AF37]/80 bg-[#D4AF37]/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                      : 'apple-glass-well text-zinc-300 hover:bg-white/[0.08]'
                  }`}
                >
                  <span className="block text-xs font-semibold">Outro Serviço</span>
                  <span className="block text-[11px] text-zinc-400 mt-0.5">Personalizado</span>
                </button>
              </div>
            </div>

            {selectedServiceId === 'custom' && (
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Nome do Serviço Personalizado</label>
                <input
                  type="text"
                  required
                  value={customServiceName}
                  onChange={(e) => setCustomServiceName(e.target.value)}
                  placeholder="Ex: Hidratação + Corte"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Valor (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={amount}
                  onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
                  placeholder="0,00"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono tabular-nums text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Profissional</label>
                <input
                  type="text"
                  required
                  value={barberName}
                  onChange={(e) => setBarberName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
            </div>

            <div>
              <span className="block text-xs font-medium text-zinc-300 mb-1.5">Forma de Pagamento</span>
              <div className="grid grid-cols-4 gap-1.5 p-1 rounded-2xl apple-glass-well">
                {PAYMENT_OPTIONS.map((pm) => (
                  <button
                    key={pm}
                    type="button"
                    onClick={() => setPaymentMethod(pm)}
                    className={`min-h-[40px] px-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                      paymentMethod === pm
                        ? 'apple-btn-gold'
                        : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    {PAYMENT_LABELS[pm]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Data</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Horário</label>
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Cliente (opcional)</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Nome do cliente"
                className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D4AF37]/60"
              />
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

            <div className="flex items-center gap-2.5">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 min-h-[48px] rounded-2xl apple-btn-gold font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60"
              >
                <Check className="w-4 h-4" />
                <span>{submitting ? 'Salvando...' : editingId ? 'Salvar Alterações' : 'Confirmar Atendimento'}</span>
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="min-h-[48px] px-4 rounded-2xl apple-glass-well text-zinc-300 text-sm font-medium hover:bg-white/[0.1]"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </section>

        {/* Appointments List */}
        <section className={`lg:col-span-7 rounded-[22px] apple-glass p-4 sm:p-5 ${mobilePane === 'history' ? 'block' : 'hidden lg:block'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">Histórico de Atendimentos</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {filteredAppointments.length} atendimento(s) · Total:{' '}
                <strong className="font-mono tabular-nums text-emerald-400">{formatBRL(filteredTotal)}</strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={filterDate}
                disabled={showAllDates}
                onChange={(e) => setFilterDate(e.target.value)}
                className="min-h-[40px] px-3 rounded-xl apple-glass-well text-xs font-mono text-white disabled:opacity-40"
              />
              <button
                type="button"
                onClick={() => setShowAllDates((v) => !v)}
                className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                  showAllDates
                    ? 'apple-btn-gold'
                    : 'apple-glass-well text-zinc-300 hover:bg-white/[0.1]'
                }`}
              >
                Todos os dias
              </button>
            </div>
          </div>

          <div className="mt-4 relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por serviço, cliente ou barbeiro..."
              className="w-full min-h-[44px] pl-10 pr-4 rounded-xl apple-glass-well text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D4AF37]/60"
            />
          </div>

          {filteredAppointments.length === 0 ? (
            <div className="py-12 text-center">
              <Scissors className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="mt-2 text-sm text-zinc-400">Nenhum atendimento encontrado para este filtro.</p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-white/[0.06]">
              {filteredAppointments.map((apt) => (
                <div key={apt.id} className="py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {apt.serviceName}
                      {apt.clientName ? ` — ${apt.clientName}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400 flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono">{formatDateBR(apt.date)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{apt.time}</span>
                      <span aria-hidden="true">·</span>
                      <span>{PAYMENT_LABELS[apt.paymentMethod]}</span>
                      <span aria-hidden="true">·</span>
                      <span>{apt.barberName}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-sm font-bold font-mono tabular-nums text-emerald-400 mr-1">
                      {formatBRL(apt.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleStartEdit(apt)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/5"
                      title="Editar atendimento"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {confirmDeleteId === apt.id ? (
                      <button
                        type="button"
                        onClick={() => void handleDeleteAppointment(apt.id)}
                        className="min-h-[40px] px-2.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500"
                      >
                        Confirmar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(apt.id)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10"
                        title="Excluir atendimento"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Modal: Quick Service Creation */}
      {showServiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 apple-backdrop-in">
          <div className="w-full max-w-md rounded-[28px] apple-glass-modal p-6 apple-sheet-up">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Cadastrar Serviço</h3>
              <button
                type="button"
                onClick={() => setShowServiceModal(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.08]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddService} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Nome do Serviço</label>
                <input
                  type="text"
                  required
                  value={newSrvName}
                  onChange={(e) => setNewSrvName(e.target.value)}
                  placeholder="Ex: Corte Navalhado"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Preço Padrão (R$)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={newSrvPrice}
                    onChange={(e) => setNewSrvPrice(sanitizeDecimalInput(e.target.value))}
                    placeholder="35,00"
                    className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Duração (min)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={newSrvDuration}
                    onChange={(e) => setNewSrvDuration(e.target.value.replace(/[^\d]/g, ''))}
                    className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Categoria</label>
                <input
                  type="text"
                  value={newSrvCategory}
                  onChange={(e) => setNewSrvCategory(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <button
                type="submit"
                className="w-full min-h-[48px] rounded-2xl apple-btn-gold font-semibold text-sm transition-all"
              >
                Salvar Serviço
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
