import React, { useMemo } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { PAYMENT_LABELS, type Appointment, type PaymentMethod, type Transaction } from '../types';
import { addDaysISO, formatBRL, formatDateBR, getTodayBR } from '../lib/formatters';
import { exportReportCSV, exportReportPDF } from '../lib/exportReports';
import { useLocalDraft } from '../lib/storage';

interface ReportsViewProps {
  transactions: Transaction[];
  appointments: Appointment[];
}

type PeriodPreset = 'diario' | 'semanal' | 'mensal' | 'personalizado';

export const ReportsView: React.FC<ReportsViewProps> = ({ transactions, appointments }) => {
  const today = getTodayBR();
  const [preset, setPreset] = useLocalDraft<PeriodPreset>('rep_preset', 'mensal');
  const [customStart, setCustomStart] = useLocalDraft('rep_custom_start', addDaysISO(today, -30));
  const [customEnd, setCustomEnd] = useLocalDraft('rep_custom_end', today);

  const { startDate, endDate, periodLabel } = useMemo(() => {
    if (preset === 'diario') {
      return { startDate: today, endDate: today, periodLabel: `Hoje (${formatDateBR(today)})` };
    }
    if (preset === 'semanal') {
      const start = addDaysISO(today, -6);
      return { startDate: start, endDate: today, periodLabel: `${formatDateBR(start)} a ${formatDateBR(today)}` };
    }
    if (preset === 'mensal') {
      const start = `${today.slice(0, 7)}-01`;
      return { startDate: start, endDate: today, periodLabel: `Mês Atual (${formatDateBR(start)} a ${formatDateBR(today)})` };
    }
    return {
      startDate: customStart,
      endDate: customEnd,
      periodLabel: `${formatDateBR(customStart)} a ${formatDateBR(customEnd)}`,
    };
  }, [preset, today, customStart, customEnd]);

  const reportData = useMemo(() => {
    const txs = transactions.filter((t) => (!startDate || t.date >= startDate) && (!endDate || t.date <= endDate));
    const apts = appointments.filter((a) => (!startDate || a.date >= startDate) && (!endDate || a.date <= endDate));

    let totalRevenue = 0;
    let totalExpenses = 0;
    const payMap: Record<PaymentMethod, { total: number; count: number }> = {
      pix: { total: 0, count: 0 },
      dinheiro: { total: 0, count: 0 },
      debito: { total: 0, count: 0 },
      credito: { total: 0, count: 0 },
    };
    const expenseCatMap = new Map<string, number>();

    for (const t of txs) {
      if (t.type === 'entrada') {
        totalRevenue += t.amount;
        payMap[t.paymentMethod].total += t.amount;
        payMap[t.paymentMethod].count += 1;
      } else {
        totalExpenses += t.amount;
        expenseCatMap.set(t.category, (expenseCatMap.get(t.category) || 0) + t.amount);
      }
    }

    const serviceMap = new Map<string, { count: number; total: number }>();
    for (const a of apts) {
      const prev = serviceMap.get(a.serviceName) || { count: 0, total: 0 };
      serviceMap.set(a.serviceName, { count: prev.count + 1, total: prev.total + a.amount });
    }

    const topServices = Array.from(serviceMap.entries())
      .map(([name, v]) => ({ name, count: v.count, total: v.total }))
      .sort((a, b) => b.count - a.count || b.total - a.total);

    const paymentBreakdown = (['pix', 'dinheiro', 'credito', 'debito'] as PaymentMethod[])
      .map((method) => ({ method, ...payMap[method] }))
      .sort((a, b) => b.total - a.total);

    const expensesByCategory = Array.from(expenseCatMap.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    // Daily revenue breakdown inside period
    const dailyMap = new Map<string, { entradas: number; saidas: number }>();
    for (const t of txs) {
      const prev = dailyMap.get(t.date) || { entradas: 0, saidas: 0 };
      if (t.type === 'entrada') prev.entradas += t.amount;
      else prev.saidas += t.amount;
      dailyMap.set(t.date, prev);
    }
    const dailyRows = Array.from(dailyMap.entries())
      .map(([date, v]) => ({ date, entradas: v.entradas, saidas: v.saidas, lucro: v.entradas - v.saidas }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return {
      txs,
      totalRevenue,
      totalExpenses,
      estimatedProfit: totalRevenue - totalExpenses,
      appointmentsCount: apts.length,
      paymentBreakdown,
      topServices,
      expensesByCategory,
      dailyRows,
    };
  }, [transactions, appointments, startDate, endDate]);

  const handleExportPDF = () => {
    exportReportPDF({
      title: `Relatório Financeiro (${preset.toUpperCase()})`,
      periodLabel,
      totalRevenue: reportData.totalRevenue,
      totalExpenses: reportData.totalExpenses,
      estimatedProfit: reportData.estimatedProfit,
      appointmentsCount: reportData.appointmentsCount,
      paymentBreakdown: reportData.paymentBreakdown,
      topServices: reportData.topServices,
      transactions: reportData.txs,
    });
  };

  const handleExportCSV = () => {
    exportReportCSV({
      title: `Relatório Financeiro (${preset.toUpperCase()})`,
      periodLabel,
      totalRevenue: reportData.totalRevenue,
      totalExpenses: reportData.totalExpenses,
      estimatedProfit: reportData.estimatedProfit,
      appointmentsCount: reportData.appointmentsCount,
      paymentBreakdown: reportData.paymentBreakdown,
      topServices: reportData.topServices,
      transactions: reportData.txs,
    });
  };

  return (
    <div className="space-y-6">
      {/* Period Selector + Export Actions */}
      <section className="rounded-[22px] apple-glass p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">Relatórios Gerenciais</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Período analisado: {periodLabel}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-2xl apple-glass-well">
              {([
                { id: 'diario', label: 'Diário' },
                { id: 'semanal', label: 'Semanal' },
                { id: 'mensal', label: 'Mensal' },
                { id: 'personalizado', label: 'Período' },
              ] as const).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold apple-tab-spring whitespace-nowrap min-h-[36px] ${
                    preset === p.id ? 'apple-btn-gold' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleExportPDF}
              className="min-h-[44px] px-4 rounded-2xl apple-btn-gold font-semibold text-xs flex items-center gap-2 transition-all whitespace-nowrap"
            >
              <FileText className="w-4 h-4" />
              <span>Exportar PDF</span>
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              className="min-h-[44px] px-4 rounded-2xl apple-glass-well text-white font-semibold text-xs flex items-center gap-2 hover:bg-white/[0.1] transition-colors whitespace-nowrap"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Exportar CSV</span>
            </button>
          </div>
        </div>

        {preset === 'personalizado' && (
          <div className="mt-4 grid grid-cols-2 sm:max-w-sm gap-3">
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Data Inicial</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full min-h-[40px] px-3 rounded-xl apple-glass-well text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Data Final</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full min-h-[40px] px-3 rounded-xl apple-glass-well text-xs font-mono text-white"
              />
            </div>
          </div>
        )}
      </section>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-[22px] apple-glass p-4 sm:p-5">
          <p className="text-xs text-zinc-400">Faturamento no Período</p>
          <p className="mt-2 text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-400">
            {formatBRL(reportData.totalRevenue)}
          </p>
        </div>
        <div className="rounded-[22px] apple-glass p-4 sm:p-5">
          <p className="text-xs text-zinc-400">Total de Despesas</p>
          <p className="mt-2 text-xl sm:text-2xl font-bold font-mono tabular-nums text-rose-400">
            {formatBRL(reportData.totalExpenses)}
          </p>
        </div>
        <div className="rounded-[22px] apple-glass p-4 sm:p-5">
          <p className="text-xs text-zinc-400">Lucro Estimado</p>
          <p className={`mt-2 text-xl sm:text-2xl font-bold font-mono tabular-nums ${reportData.estimatedProfit >= 0 ? 'text-[#E6C65C]' : 'text-rose-400'}`}>
            {formatBRL(reportData.estimatedProfit)}
          </p>
        </div>
        <div className="rounded-[22px] apple-glass p-4 sm:p-5">
          <p className="text-xs text-zinc-400">Atendimentos</p>
          <p className="mt-2 text-xl sm:text-2xl font-bold font-mono tabular-nums text-white">
            {reportData.appointmentsCount}
          </p>
        </div>
      </div>

      {/* Rankings: Top Services + Payment Methods + Expense Categories */}
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Top Services */}
        <section className="rounded-[22px] apple-glass p-5">
          <h3 className="text-base font-bold text-white">Serviços Mais Vendidos</h3>
          <p className="text-xs text-zinc-400 mt-0.5">Ranking por volume e receita</p>

          {reportData.topServices.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-500">Sem atendimentos no período.</p>
          ) : (
            <div className="mt-4 space-y-3.5">
              {reportData.topServices.map((srv, i) => {
                const maxTotal = reportData.topServices[0]?.total || 1;
                const pct = Math.max(8, Math.round((srv.total / maxTotal) * 100));
                return (
                  <div key={srv.name}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-white truncate">
                        {i + 1}. {srv.name}
                      </span>
                      <span className="font-mono tabular-nums text-[#E6C65C] shrink-0 ml-2">
                        {formatBRL(srv.total)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
                      <span>{srv.count} atendimento(s)</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                      <div className="h-full rounded-full bg-[#D4AF37]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Payment Methods */}
        <section className="rounded-[22px] apple-glass p-5">
          <h3 className="text-base font-bold text-white">Formas de Pagamento</h3>
          <p className="text-xs text-zinc-400 mt-0.5">Distribuição das entradas no período</p>

          <div className="mt-4 space-y-3.5">
            {reportData.paymentBreakdown.map((pm) => {
              const pct = reportData.totalRevenue > 0 ? Math.round((pm.total / reportData.totalRevenue) * 100) : 0;
              return (
                <div key={pm.method}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-white">{PAYMENT_LABELS[pm.method]}</span>
                    <span className="font-mono tabular-nums text-emerald-400">{formatBRL(pm.total)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
                    <span>{pm.count} lançamento(s)</span>
                    <span className="font-mono">{pct}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Expenses by Category */}
        <section className="rounded-[22px] apple-glass p-5">
          <h3 className="text-base font-bold text-white">Despesas por Categoria</h3>
          <p className="text-xs text-zinc-400 mt-0.5">Onde o dinheiro saiu no período</p>

          {reportData.expensesByCategory.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-500">Nenhuma despesa registrada no período.</p>
          ) : (
            <div className="mt-4 space-y-3.5">
              {reportData.expensesByCategory.map((ex) => {
                const pct = reportData.totalExpenses > 0 ? Math.round((ex.total / reportData.totalExpenses) * 100) : 0;
                return (
                  <div key={ex.category}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-white truncate">{ex.category}</span>
                      <span className="font-mono tabular-nums text-rose-400 ml-2 shrink-0">{formatBRL(ex.total)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-end text-[11px] text-zinc-500">
                      <span className="font-mono">{pct}% das despesas</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                      <div className="h-full rounded-full bg-rose-500/80" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Daily Table */}
      <section className="rounded-[22px] apple-glass p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Detalhamento Diário</h3>
          <button
            type="button"
            onClick={handleExportCSV}
            className="text-xs font-semibold text-[#D4AF37] hover:text-[#E6C65C] flex items-center gap-1 min-h-[36px]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Baixar Planilha CSV</span>
          </button>
        </div>

        {reportData.dailyRows.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-500">Nenhuma movimentação encontrada neste período.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] text-zinc-400">
                  <th className="py-2.5 pr-4 font-medium">Data</th>
                  <th className="py-2.5 px-4 font-medium text-right">Entradas</th>
                  <th className="py-2.5 px-4 font-medium text-right">Despesas</th>
                  <th className="py-2.5 pl-4 font-medium text-right">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {reportData.dailyRows.map((row) => (
                  <tr key={row.date} className="hover:bg-white/[0.02]">
                    <td className="py-3 pr-4 font-mono text-zinc-200">{formatDateBR(row.date)}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-emerald-400">
                      {formatBRL(row.entradas)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-rose-400">
                      {formatBRL(row.saidas)}
                    </td>
                    <td className={`py-3 pl-4 font-mono tabular-nums text-right font-semibold ${row.lucro >= 0 ? 'text-white' : 'text-rose-400'}`}>
                      {formatBRL(row.lucro)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
