import React, { useMemo, useState } from 'react';
import { Calculator, CheckCircle2, FileDown } from 'lucide-react';
import type { AppSettings, Appointment, CashClosing, Transaction, User } from '../types';
import {
  formatBRL,
  formatDateBR,
  getTodayBR,
  parseCurrencyInput,
  sanitizeDecimalInput,
} from '../lib/formatters';
import { apiRequest } from '../lib/api';
import { exportCashClosingPDF } from '../lib/exportReports';
import { setPendingServerSync, shouldFallbackToLocalPersistence, useLocalDraft } from '../lib/storage';

interface CashClosingViewProps {
  currentUser: User;
  settings: AppSettings;
  transactions: Transaction[];
  appointments: Appointment[];
  cashClosings: CashClosing[];
  onClosingSaved: (closing: CashClosing) => void;
}

export const CashClosingView: React.FC<CashClosingViewProps> = ({
  currentUser,
  settings,
  transactions,
  appointments,
  cashClosings,
  onClosingSaved,
}) => {
  const [targetDate, setTargetDate] = useLocalDraft('closing_target_date', getTodayBR());
  const [countedCash, setCountedCash] = useLocalDraft('closing_counted_cash', '');
  const [notes, setNotes] = useLocalDraft('closing_notes', '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const preview = useMemo(() => {
    let priorIn = 0;
    let priorOut = 0;
    let totalReceived = 0;
    let totalCash = 0;
    let totalPix = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    let totalExpenses = 0;

    for (const tx of transactions) {
      if (tx.date < targetDate) {
        if (tx.type === 'entrada') priorIn += tx.amount;
        else priorOut += tx.amount;
      } else if (tx.date === targetDate) {
        if (tx.type === 'entrada') {
          totalReceived += tx.amount;
          if (tx.paymentMethod === 'dinheiro') totalCash += tx.amount;
          else if (tx.paymentMethod === 'pix') totalPix += tx.amount;
          else if (tx.paymentMethod === 'debito') totalDebit += tx.amount;
          else if (tx.paymentMethod === 'credito') totalCredit += tx.amount;
        } else {
          totalExpenses += tx.amount;
        }
      }
    }

    const openingBalance = settings.openingCashBalance + priorIn - priorOut;
    const totalCard = totalDebit + totalCredit;
    const finalBalance = openingBalance + totalReceived - totalExpenses;
    const appointmentsCount = appointments.filter((a) => a.date === targetDate).length;

    return {
      openingBalance,
      totalReceived,
      totalCash,
      totalPix,
      totalDebit,
      totalCredit,
      totalCard,
      totalExpenses,
      finalBalance,
      appointmentsCount,
    };
  }, [transactions, appointments, settings.openingCashBalance, targetDate]);

  const existingForDate = useMemo(
    () => cashClosings.find((c) => c.date === targetDate) || null,
    [cashClosings, targetDate]
  );

  const handleCloseDay = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    const parsedCounted = countedCash.trim() !== '' ? parseCurrencyInput(countedCash) : null;
    const finalCounted = parsedCounted !== null && Number.isFinite(parsedCounted) ? parsedCounted : null;

    try {
      let saved: CashClosing;
      try {
        saved = await apiRequest<CashClosing>('/api/cash-closings', {
          method: 'POST',
          body: JSON.stringify({
            date: targetDate,
            countedCash: finalCounted,
            notes,
          }),
        });
      } catch (err) {
        if (shouldFallbackToLocalPersistence(err)) {
          saved = {
            id: existingForDate?.id || `local_cls_${Date.now().toString(36)}`,
            date: targetDate,
            openingBalance: Number(preview.openingBalance.toFixed(2)),
            totalReceived: Number(preview.totalReceived.toFixed(2)),
            totalCash: Number(preview.totalCash.toFixed(2)),
            totalPix: Number(preview.totalPix.toFixed(2)),
            totalDebit: Number(preview.totalDebit.toFixed(2)),
            totalCredit: Number(preview.totalCredit.toFixed(2)),
            totalCard: Number(preview.totalCard.toFixed(2)),
            totalExpenses: Number(preview.totalExpenses.toFixed(2)),
            finalBalance: Number(preview.finalBalance.toFixed(2)),
            countedCash: finalCounted,
            appointmentsCount: preview.appointmentsCount,
            notes: notes.trim(),
            closedBy: currentUser.name,
            closedAt: new Date().toISOString(),
          };
          setPendingServerSync(true);
        } else {
          throw err;
        }
      }
      onClosingSaved(saved);
      setFeedback({ type: 'ok', text: `Caixa de ${formatDateBR(targetDate)} fechado e salvo com sucesso!` });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao fechar caixa.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Daily Summary & Closing Form */}
        <section className="lg:col-span-7 rounded-[22px] apple-glass p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">Fechamento Diário de Caixa</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Conferência automática das entradas, formas de pagamento e despesas
              </p>
            </div>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="min-h-[42px] px-3 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
            />
          </div>

          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl apple-glass-well p-3.5">
              <span className="text-xs text-zinc-400">Total Recebido</span>
              <p className="mt-1 text-lg font-bold font-mono tabular-nums text-emerald-400">
                {formatBRL(preview.totalReceived)}
              </p>
            </div>
            <div className="rounded-2xl apple-glass-well p-3.5">
              <span className="text-xs text-zinc-400">Total de Despesas</span>
              <p className="mt-1 text-lg font-bold font-mono tabular-nums text-rose-400">
                {formatBRL(preview.totalExpenses)}
              </p>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-2xl apple-glass-well !border-[#D4AF37]/35 p-3.5">
              <span className="text-xs text-[#E6C65C]">Saldo Final</span>
              <p className="mt-1 text-lg font-bold font-mono tabular-nums text-white">
                {formatBRL(preview.finalBalance)}
              </p>
            </div>
          </div>

          {/* Payment Method Breakdown */}
          <div className="mt-5 divide-y divide-white/[0.06] border-y border-white/[0.06]">
            <div className="py-3 flex items-center justify-between text-sm">
              <span className="text-zinc-400">Saldo Inicial Acumulado</span>
              <span className="font-mono tabular-nums text-zinc-200">{formatBRL(preview.openingBalance)}</span>
            </div>
            <div className="py-3 flex items-center justify-between text-sm">
              <span className="text-zinc-400">Total em Dinheiro</span>
              <span className="font-mono tabular-nums font-semibold text-white">{formatBRL(preview.totalCash)}</span>
            </div>
            <div className="py-3 flex items-center justify-between text-sm">
              <span className="text-zinc-400">Total em PIX</span>
              <span className="font-mono tabular-nums font-semibold text-white">{formatBRL(preview.totalPix)}</span>
            </div>
            <div className="py-3 flex items-center justify-between text-sm">
              <span className="text-zinc-400">
                Total em Cartão (Débito {formatBRL(preview.totalDebit)} · Crédito {formatBRL(preview.totalCredit)})
              </span>
              <span className="font-mono tabular-nums font-semibold text-white">{formatBRL(preview.totalCard)}</span>
            </div>
            <div className="py-3 flex items-center justify-between text-sm">
              <span className="text-zinc-400">Atendimentos no Dia</span>
              <span className="font-mono tabular-nums font-semibold text-[#E6C65C]">{preview.appointmentsCount}</span>
            </div>
          </div>

          <form onSubmit={handleCloseDay} className="mt-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Dinheiro Contado na Gaveta (Opcional)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={countedCash}
                  onChange={(e) => setCountedCash(sanitizeDecimalInput(e.target.value))}
                  placeholder="Ex: 250,00"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Observações do Fechamento</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex: Caixa conferido sem divergências"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
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

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 min-h-[48px] rounded-2xl apple-btn-gold font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60"
              >
                <Calculator className="w-4 h-4" />
                <span>{saving ? 'Fechando...' : existingForDate ? 'Atualizar Fechamento do Dia' : 'Fechar Caixa do Dia'}</span>
              </button>

              {existingForDate && (
                <button
                  type="button"
                  onClick={() => exportCashClosingPDF(existingForDate)}
                  className="min-h-[48px] px-5 rounded-2xl apple-glass-well text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-white/[0.1] whitespace-nowrap transition-colors"
                >
                  <FileDown className="w-4 h-4 text-[#E6C65C]" />
                  <span>Relatório Diário (PDF)</span>
                </button>
              )}
            </div>
          </form>
        </section>

        {/* Closing History */}
        <section className="lg:col-span-5 rounded-[22px] apple-glass p-5">
          <h2 className="text-lg font-bold text-white">Histórico de Fechamentos</h2>
          <p className="text-xs text-zinc-400 mt-0.5">Registros salvos e disponíveis para relatório diário</p>

          {cashClosings.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-zinc-400">Nenhum fechamento registrado ainda.</p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-white/[0.06]">
              {cashClosings.map((cls) => (
                <div key={cls.id} className="py-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-sm font-bold font-mono text-white">{formatDateBR(cls.date)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => exportCashClosingPDF(cls)}
                      className="min-h-[36px] px-2.5 rounded-lg border border-white/10 text-xs font-medium text-[#E6C65C] hover:bg-white/5 flex items-center gap-1.5"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>PDF</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                    <span>
                      Recebido: <strong className="font-mono text-emerald-400">{formatBRL(cls.totalReceived)}</strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Despesas: <strong className="font-mono text-rose-400">{formatBRL(cls.totalExpenses)}</strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Saldo Final: <strong className="font-mono text-white">{formatBRL(cls.finalBalance)}</strong>
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-500">
                    Dinheiro: {formatBRL(cls.totalCash)} · PIX: {formatBRL(cls.totalPix)} · Cartão: {formatBRL(cls.totalCard)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
