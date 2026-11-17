import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Check, Filter, Pencil, Search, Trash2 } from 'lucide-react';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_LABELS,
  type PaymentMethod,
  type Transaction,
  type TransactionType,
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

interface FinanceViewProps {
  transactions: Transaction[];
  initialType?: TransactionType;
  quickActionNonce?: number;
  onTransactionCreated: (tx: Transaction) => void;
  onTransactionUpdated: (tx: Transaction) => void;
  onTransactionDeleted: (txId: string, deletedAppointmentId: string | null) => void;
}

const PAYMENT_OPTIONS: PaymentMethod[] = ['pix', 'dinheiro', 'debito', 'credito'];

export const FinanceView: React.FC<FinanceViewProps> = ({
  transactions,
  initialType = 'entrada',
  quickActionNonce = 0,
  onTransactionCreated,
  onTransactionUpdated,
  onTransactionDeleted,
}) => {
  const today = getTodayBR();

  const [type, setType] = useLocalDraft<TransactionType>('fin_type', initialType);
  const [category, setCategory] = useLocalDraft<string>(
    'fin_category',
    initialType === 'entrada' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]
  );
  const [description, setDescription] = useLocalDraft('fin_description', '');
  const [amount, setAmount] = useLocalDraft('fin_amount', '');
  const [paymentMethod, setPaymentMethod] = useLocalDraft<PaymentMethod>('fin_payment_method', 'pix');
  const [date, setDate] = useLocalDraft('fin_date', today);
  const [time, setTime] = useLocalDraft('fin_time', getNowTimeBR());
  const [notes, setNotes] = useLocalDraft('fin_notes', '');
  const [editingId, setEditingId] = useLocalDraft<string | null>('fin_editing_id', null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filters
  const [filterStart, setFilterStart] = useLocalDraft('fin_filter_start', addDaysISO(today, -30));
  const [filterEnd, setFilterEnd] = useLocalDraft('fin_filter_end', today);
  const [filterType, setFilterType] = useLocalDraft<'all' | TransactionType>('fin_filter_type', 'all');
  const [filterCategory, setFilterCategory] = useLocalDraft('fin_filter_category', 'all');
  const [filterPayment, setFilterPayment] = useLocalDraft<'all' | PaymentMethod>('fin_filter_payment', 'all');
  const [searchQuery, setSearchQuery] = useLocalDraft('fin_search_query', '');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useLocalDraft<'form' | 'history'>('fin_mobile_pane', 'form');

  const lastQuickNonceRef = useRef(quickActionNonce);
  useEffect(() => {
    if (quickActionNonce > 0 && quickActionNonce !== lastQuickNonceRef.current) {
      lastQuickNonceRef.current = quickActionNonce;
      if (!editingId) {
        setType(initialType);
        setCategory(initialType === 'entrada' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
      }
    }
  }, [quickActionNonce, initialType, editingId, setType, setCategory]);

  const categoriesForType = type === 'entrada' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const handleTypeSwitch = (nextType: TransactionType) => {
    setType(nextType);
    setCategory(nextType === 'entrada' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
  };

  const resetForm = () => {
    setEditingId(null);
    setDescription('');
    setAmount('');
    setNotes('');
    setDate(getTodayBR());
    setTime(getNowTimeBR());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const numAmount = parseCurrencyInput(amount);
    if (!description.trim() || !Number.isFinite(numAmount) || numAmount <= 0) {
      setFeedback({ type: 'err', text: 'Preencha a descrição e um valor maior que zero.' });
      return;
    }

    setSubmitting(true);
    try {
      if (editingId) {
        try {
          const updated = await apiRequest<Transaction>(`/api/transactions/${editingId}`, {
            method: 'PUT',
            body: JSON.stringify({
              type,
              category,
              description: description.trim(),
              amount: numAmount,
              paymentMethod,
              date,
              time,
              notes,
            }),
          });
          onTransactionUpdated(updated);
          setFeedback({ type: 'ok', text: 'Lançamento atualizado com sucesso.' });
          resetForm();
        } catch (err) {
          if (shouldFallbackToLocalPersistence(err)) {
            const existing = transactions.find((t) => t.id === editingId);
            const localUpdated: Transaction = {
              id: editingId,
              type,
              category,
              description: description.trim(),
              amount: numAmount,
              paymentMethod,
              date: date || getTodayBR(),
              time: time || getNowTimeBR(),
              appointmentId: existing?.appointmentId || null,
              notes: notes.trim(),
              createdBy: existing?.createdBy || 'usr_owner',
              createdAt: existing?.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            setPendingServerSync(true);
            onTransactionUpdated(localUpdated);
            setFeedback({ type: 'ok', text: 'Lançamento atualizado e salvo no navegador.' });
            resetForm();
          } else {
            throw err;
          }
        }
      } else {
        try {
          const created = await apiRequest<Transaction>('/api/transactions', {
            method: 'POST',
            body: JSON.stringify({
              type,
              category,
              description: description.trim(),
              amount: numAmount,
              paymentMethod,
              date,
              time,
              notes,
            }),
          });
          onTransactionCreated(created);
          setFeedback({
            type: 'ok',
            text: type === 'entrada' ? 'Entrada registrada no caixa.' : 'Despesa registrada com sucesso.',
          });
          resetForm();
        } catch (err) {
          if (shouldFallbackToLocalPersistence(err)) {
            const nowIso = new Date().toISOString();
            const localTx: Transaction = {
              id: `local_trx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              type,
              category,
              description: description.trim(),
              amount: numAmount,
              paymentMethod,
              date: date || getTodayBR(),
              time: time || getNowTimeBR(),
              appointmentId: null,
              notes: notes.trim(),
              createdBy: 'usr_owner',
              createdAt: nowIso,
              updatedAt: nowIso,
            };
            setPendingServerSync(true);
            onTransactionCreated(localTx);
            setFeedback({
              type: 'ok',
              text:
                type === 'entrada'
                  ? 'Entrada salva localmente! Será sincronizada com o servidor.'
                  : 'Despesa salva localmente! Será sincronizada com o servidor.',
            });
            resetForm();
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao salvar lançamento.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (tx: Transaction) => {
    setEditingId(tx.id);
    setType(tx.type);
    setCategory(tx.category);
    setDescription(tx.description);
    setAmount(String(tx.amount));
    setPaymentMethod(tx.paymentMethod);
    setDate(tx.date);
    setTime(tx.time);
    setNotes(tx.notes);
    setMobilePane('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    const existing = transactions.find((t) => t.id === id);
    try {
      const res = await apiRequest<{ ok: boolean; deletedAppointmentId: string | null }>(`/api/transactions/${id}`, {
        method: 'DELETE',
      });
      onTransactionDeleted(id, res.deletedAppointmentId);
      setConfirmDeleteId(null);
      setFeedback({ type: 'ok', text: 'Lançamento excluído do histórico.' });
    } catch (err) {
      if (shouldFallbackToLocalPersistence(err)) {
        setPendingServerSync(true);
        onTransactionDeleted(id, existing?.appointmentId || null);
        setConfirmDeleteId(null);
        setFeedback({ type: 'ok', text: 'Lançamento removido localmente.' });
      } else {
        setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao excluir lançamento.' });
      }
    }
  };

  const allCategories = useMemo(() => {
    const set = new Set<string>([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]);
    transactions.forEach((t) => set.add(t.category));
    return Array.from(set);
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (filterStart && t.date < filterStart) return false;
      if (filterEnd && t.date > filterEnd) return false;
      if (filterType !== 'all' && t.type !== filterType) return false;
      if (filterCategory !== 'all' && t.category !== filterCategory) return false;
      if (filterPayment !== 'all' && t.paymentMethod !== filterPayment) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!t.description.toLowerCase().includes(q) && !t.category.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [transactions, filterStart, filterEnd, filterType, filterCategory, filterPayment, searchQuery]);

  const summary = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    for (const t of filteredTransactions) {
      if (t.type === 'entrada') entradas += t.amount;
      else saidas += t.amount;
    }
    return { entradas, saidas, saldo: entradas - saidas };
  }, [filteredTransactions]);

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
          {editingId ? 'Editando' : 'Lançar'}
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('history')}
          className={`relative z-10 min-h-[40px] rounded-xl text-xs font-semibold apple-tab-spring ${
            mobilePane === 'history' ? 'text-[#09090B]' : 'text-zinc-300 hover:text-white'
          }`}
        >
          Extrato ({filteredTransactions.length})
        </button>
      </div>

      <div className="grid lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        {/* Form */}
        <section className={`lg:col-span-5 rounded-[22px] apple-glass p-4 sm:p-5 ${mobilePane === 'form' ? 'block' : 'hidden lg:block'}`}>
          <h2 className="text-base sm:text-lg font-bold text-white">
            {editingId ? 'Editar Movimentação' : 'Nova Movimentação Financeira'}
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5 hidden sm:block">Registre entradas extras ou despesas da barbearia</p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {/* Segmented Type Toggle */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl apple-glass-well">
              <button
                type="button"
                onClick={() => handleTypeSwitch('entrada')}
                className={`min-h-[42px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 apple-tab-spring ${
                  type === 'entrada' ? 'bg-emerald-500 text-[#09090B] shadow-md' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <ArrowUpCircle className="w-4 h-4" />
                <span>Entrada</span>
              </button>
              <button
                type="button"
                onClick={() => handleTypeSwitch('saida')}
                className={`min-h-[42px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 apple-tab-spring ${
                  type === 'saida' ? 'bg-rose-500 text-white shadow-md' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <ArrowDownCircle className="w-4 h-4" />
                <span>Despesa / Saída</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Categoria</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
              >
                {categoriesForType.map((c) => (
                  <option key={c} value={c} className="bg-[#121216]">
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Descrição</label>
              <input
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={type === 'entrada' ? 'Ex: Venda de pomada modeladora' : 'Ex: Compra de lâminas e toalhas'}
                className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D4AF37]/60"
              />
            </div>

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
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Forma de Pagamento</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full min-h-[44px] px-3 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                >
                  {PAYMENT_OPTIONS.map((pm) => (
                    <option key={pm} value={pm} className="bg-[#121216]">
                      {PAYMENT_LABELS[pm]}
                    </option>
                  ))}
                </select>
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
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Observações (opcional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalhes adicionais"
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
                <span>{submitting ? 'Salvando...' : editingId ? 'Salvar Alterações' : 'Registrar Lançamento'}</span>
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

        {/* History + Filters */}
        <section className={`lg:col-span-7 rounded-[22px] apple-glass p-4 sm:p-5 ${mobilePane === 'history' ? 'block' : 'hidden lg:block'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">Histórico de Movimentações</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {filteredTransactions.length} registro(s) no período selecionado
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="text-zinc-400">
                Entradas: <strong className="font-mono tabular-nums text-emerald-400">{formatBRL(summary.entradas)}</strong>
              </span>
              <span className="text-zinc-400">
                Saídas: <strong className="font-mono tabular-nums text-rose-400">{formatBRL(summary.saidas)}</strong>
              </span>
              <span className="text-zinc-400">
                Saldo: <strong className="font-mono tabular-nums text-[#E6C65C]">{formatBRL(summary.saldo)}</strong>
              </span>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">De</label>
              <input
                type="date"
                value={filterStart}
                onChange={(e) => setFilterStart(e.target.value)}
                className="w-full min-h-[40px] px-2.5 rounded-xl apple-glass-well text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Até</label>
              <input
                type="date"
                value={filterEnd}
                onChange={(e) => setFilterEnd(e.target.value)}
                className="w-full min-h-[40px] px-2.5 rounded-xl apple-glass-well text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Categoria</label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full min-h-[40px] px-2.5 rounded-xl apple-glass-well text-xs text-white"
              >
                <option value="all" className="bg-[#121216]">Todas</option>
                {allCategories.map((c) => (
                  <option key={c} value={c} className="bg-[#121216]">
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Pagamento</label>
              <select
                value={filterPayment}
                onChange={(e) => setFilterPayment(e.target.value as 'all' | PaymentMethod)}
                className="w-full min-h-[40px] px-2.5 rounded-xl apple-glass-well text-xs text-white"
              >
                <option value="all" className="bg-[#121216]">Todos</option>
                {PAYMENT_OPTIONS.map((pm) => (
                  <option key={pm} value={pm} className="bg-[#121216]">
                    {PAYMENT_LABELS[pm]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar descrição ou categoria..."
                className="w-full min-h-[42px] pl-10 pr-3 rounded-xl apple-glass-well text-xs text-white placeholder:text-zinc-500"
              />
            </div>
            <div className="flex items-center gap-1 p-1 rounded-2xl apple-glass-well self-start">
              {(['all', 'entrada', 'saida'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setFilterType(opt)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap min-h-[34px] ${
                    filterType === opt ? 'apple-btn-gold' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {opt === 'all' ? 'Todos' : opt === 'entrada' ? 'Entradas' : 'Saídas'}
                </button>
              ))}
            </div>
          </div>

          {filteredTransactions.length === 0 ? (
            <div className="py-12 text-center">
              <Filter className="w-7 h-7 text-zinc-600 mx-auto" />
              <p className="mt-2 text-sm text-zinc-400">Nenhuma movimentação encontrada para os filtros aplicados.</p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-white/[0.06]">
              {filteredTransactions.map((tx) => (
                <div key={tx.id} className="py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          tx.type === 'entrada' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {tx.type === 'entrada' ? 'Entrada' : 'Saída'}
                      </span>
                      <span aria-hidden="true" className="text-zinc-600">·</span>
                      <p className="text-sm font-medium text-white truncate">{tx.description}</p>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-400 flex items-center gap-1.5 flex-wrap">
                      <span>{tx.category}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{formatDateBR(tx.date)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{tx.time}</span>
                      <span aria-hidden="true">·</span>
                      <span>{PAYMENT_LABELS[tx.paymentMethod]}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-sm font-bold font-mono tabular-nums mr-1 ${
                        tx.type === 'entrada' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {tx.type === 'entrada' ? '+' : '-'} {formatBRL(tx.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleEdit(tx)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/5"
                      title="Editar lançamento"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {confirmDeleteId === tx.id ? (
                      <button
                        type="button"
                        onClick={() => void handleDelete(tx.id)}
                        className="min-h-[40px] px-2.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500"
                      >
                        Confirmar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(tx.id)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10"
                        title="Excluir lançamento"
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
    </div>
  );
};
