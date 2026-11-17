import React, { useMemo, useState } from 'react';
import { EyeOff, KeyRound, Lock, Plus, Trash2 } from 'lucide-react';
import { PRIVATE_TYPE_LABELS, type PrivateRecord, type PrivateRecordType } from '../types';
import {
  formatBRL,
  formatDateBR,
  getTodayBR,
  parseCurrencyInput,
  sanitizeDecimalInput,
} from '../lib/formatters';
import { apiRequest } from '../lib/api';
import { useLocalDraft } from '../lib/storage';

export const PrivateAreaView: React.FC = () => {
  const [pin, setPin] = useState('');
  const [unlockedPin, setUnlockedPin] = useState<string | null>(null);
  const [records, setRecords] = useState<PrivateRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Form drafts (never persisting PIN)
  const [title, setTitle] = useLocalDraft('prv_title', '');
  const [type, setType] = useLocalDraft<PrivateRecordType>('prv_type', 'reserva');
  const [amount, setAmount] = useLocalDraft('prv_amount', '');
  const [date, setDate] = useLocalDraft('prv_date', getTodayBR());
  const [details, setDetails] = useLocalDraft('prv_details', '');

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const list = await apiRequest<PrivateRecord[]>('/api/private/records-list', {
        method: 'POST',
        body: JSON.stringify({ pin }),
      });
      setUnlockedPin(pin);
      setRecords(list);
      setPin('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Senha da Área Privada incorreta.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockedPin || !title.trim()) return;
    setError('');
    const parsedAmount = amount.trim() === '' ? 0 : parseCurrencyInput(amount);
    try {
      const created = await apiRequest<PrivateRecord>('/api/private/records', {
        method: 'POST',
        body: JSON.stringify({
          pin: unlockedPin,
          title: title.trim(),
          type,
          amount: Number.isFinite(parsedAmount) ? parsedAmount : 0,
          date,
          details,
        }),
      });
      setRecords([created, ...records]);
      setTitle('');
      setAmount('');
      setDetails('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar registro confidencial.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!unlockedPin) return;
    try {
      await apiRequest(`/api/private/records/${id}/delete`, {
        method: 'POST',
        body: JSON.stringify({ pin: unlockedPin }),
      });
      setRecords(records.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover registro.');
    }
  };

  const totals = useMemo(() => {
    let reserva = 0;
    let proLabore = 0;
    let investimento = 0;
    for (const r of records) {
      if (r.type === 'reserva') reserva += r.amount;
      else if (r.type === 'pro_labore') proLabore += r.amount;
      else if (r.type === 'investimento') investimento += r.amount;
    }
    return { reserva, proLabore, investimento };
  }, [records]);

  if (!unlockedPin) {
    return (
      <div className="max-w-md mx-auto py-8">
        <section className="rounded-[26px] apple-glass-modal p-6">
          <div className="w-12 h-12 rounded-2xl apple-glass-well flex items-center justify-center text-[#E6C65C]">
            <EyeOff className="w-5 h-5" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-white">Área Privada Confidencial</h2>
          <p className="mt-1 text-xs text-zinc-400">
            Informações financeiras estratégicas do proprietário (reservas, pró-labore e metas confidenciais). Nunca exibidas na tela inicial.
          </p>

          <form onSubmit={handleUnlock} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Senha do Cofre Privado</label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Digite a senha do cofre privado"
                  className="w-full min-h-[48px] pl-10 pr-4 rounded-2xl apple-glass-well text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] rounded-2xl apple-btn-gold font-semibold text-sm transition-all"
            >
              {loading ? 'Validando...' : 'Abrir Área Privada'}
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[22px] apple-glass-hero p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Cofre Financeiro Privado</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Acesso exclusivo autenticado · Oculto do painel principal
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setUnlockedPin(null);
            setRecords([]);
          }}
          className="min-h-[42px] px-4 rounded-xl apple-glass-well text-xs font-semibold text-zinc-200 hover:bg-white/[0.1] flex items-center gap-2 self-start sm:self-auto transition-colors"
        >
          <Lock className="w-4 h-4 text-[#E6C65C]" />
          <span>Trancar Cofre</span>
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-[22px] apple-glass p-5">
          <p className="text-xs text-zinc-400">Reserva / Cofre</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#E6C65C]">
            {formatBRL(totals.reserva)}
          </p>
        </div>
        <div className="rounded-[22px] apple-glass p-5">
          <p className="text-xs text-zinc-400">Retiradas de Pró-Labore</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-400">
            {formatBRL(totals.proLabore)}
          </p>
        </div>
        <div className="rounded-[22px] apple-glass p-5">
          <p className="text-xs text-zinc-400">Investimentos Planejados</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">
            {formatBRL(totals.investimento)}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-5 rounded-[22px] apple-glass p-5">
          <h3 className="text-base font-bold text-white">Novo Registro Confidencial</h3>
          <form onSubmit={handleCreate} className="mt-4 space-y-3.5">
            <div>
              <label className="block text-xs text-zinc-300 mb-1">Título</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Reserva de Caixa Mensal"
                className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Classificação</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as PrivateRecordType)}
                  className="w-full min-h-[44px] px-3 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
                >
                  <option value="reserva" className="bg-[#121216]">Reserva / Cofre</option>
                  <option value="pro_labore" className="bg-[#121216]">Pró-Labore</option>
                  <option value="investimento" className="bg-[#121216]">Investimento</option>
                  <option value="nota" className="bg-[#121216]">Nota Confidencial</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Valor (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
                  placeholder="0,00"
                  className="w-full min-h-[44px] px-3.5 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-300 mb-1">Data</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl apple-glass-well text-sm font-mono text-white focus:outline-none focus:border-[#D4AF37]/60"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-300 mb-1">Anotações Estratégicas</label>
              <textarea
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Detalhes sigilosos do proprietário..."
                className="w-full p-3.5 rounded-xl apple-glass-well text-sm text-white focus:outline-none focus:border-[#D4AF37]/60"
              />
            </div>
            <button
              type="submit"
              className="w-full min-h-[46px] rounded-2xl apple-btn-gold font-semibold text-sm flex items-center justify-center gap-2 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Salvar no Cofre</span>
            </button>
          </form>
        </section>

        <section className="lg:col-span-7 rounded-[22px] apple-glass p-5">
          <h3 className="text-base font-bold text-white">Registros Confidenciais ({records.length})</h3>
          {records.length === 0 ? (
            <p className="py-10 text-center text-xs text-zinc-500">Nenhum registro confidencial cadastrado.</p>
          ) : (
            <div className="mt-4 divide-y divide-white/[0.06]">
              {records.map((rec) => (
                <div key={rec.id} className="py-3.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{rec.title}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {PRIVATE_TYPE_LABELS[rec.type]} · <span className="font-mono">{formatDateBR(rec.date)}</span>
                    </p>
                    {rec.details && <p className="text-xs text-zinc-300 mt-1.5 leading-relaxed">{rec.details}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {rec.amount > 0 && (
                      <span className="text-sm font-bold font-mono tabular-nums text-[#E6C65C]">
                        {formatBRL(rec.amount)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDelete(rec.id)}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10"
                      title="Excluir registro"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
