import { useState } from 'react';
import { Award, Download, FileSpreadsheet, Sparkles, Ticket } from 'lucide-react';
import {
  exportAdminConsolidatedToExcel,
  exportOrdersToExcel,
} from '../domain/excelExport';
import { formatMxn, formatMxnCurrency } from '../domain/money';
import {
  getBranchDisplayName,
  getEligibleRaffleTickets,
  getOpenShift,
  getOrderPendingCents,
} from '../domain/rules';
import type { BranchRole } from '../domain/sharedState';
import type { BranchId, DemoState, RaffleDraw } from '../domain/types';

type ReportDatePreset = 'todo' | 'hoy' | '7dias' | 'mes' | 'rango';
type ReportServiceFilter = 'todos' | 'autoservicio' | 'encargo';

interface AdminViewProps {
  state: DemoState;
  branches: BranchId[];
  activeBranchId: BranchId;
  role: BranchRole;
  section?: 'all' | 'finanzas' | 'rifa';
  onRunRaffleDraw: (
    branchId: BranchId,
    options: { year?: number; notes?: string },
  ) => Promise<{ ok: boolean; error?: string }>;
}

function matchesReportDate(
  iso: string,
  preset: ReportDatePreset,
  customFrom: string,
  customTo: string,
): boolean {
  if (preset === 'todo') return true;
  const date = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === 'hoy') {
    return date >= startToday;
  }
  if (preset === '7dias') {
    const startWeek = new Date(startToday);
    startWeek.setDate(startWeek.getDate() - 6);
    return date >= startWeek;
  }
  if (preset === 'mes') {
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return date >= startMonth;
  }
  // custom range
  const dayStr = iso.slice(0, 10);
  if (customFrom && dayStr < customFrom) return false;
  if (customTo && dayStr > customTo) return false;
  return true;
}

export function AdminView({
  state,
  branches,
  activeBranchId,
  role,
  section = 'all',
  onRunRaffleDraw,
}: AdminViewProps) {
  const isSupervisor = role === 'supervisor';
  const currentYear = new Date().getFullYear();

  const [datePreset, setDatePreset] = useState<ReportDatePreset>('todo');
  const [serviceFilter, setServiceFilter] = useState<ReportServiceFilter>('todos');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [raffleYear, setRaffleYear] = useState(currentYear);
  const [drawNotes, setDrawNotes] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [demoDraw, setDemoDraw] = useState<RaffleDraw | null>(null);
  const [raffleFeedback, setRaffleFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const filteredOrders = state.orders.filter((order) => {
    if (!branches.includes(order.branchId)) return false;
    if (serviceFilter !== 'todos' && order.serviceType !== serviceFilter) return false;
    return matchesReportDate(order.createdAt, datePreset, customFrom, customTo);
  });

  const byBranch = branches.map((branchId) => {
    const branchOrders = filteredOrders.filter((o) => o.branchId === branchId);
    const orderIds = new Set(branchOrders.map((o) => o.id));
    const confirmed = { efectivo: 0, tarjeta: 0, transferencia: 0 };
    let pendingCents = branchOrders.reduce((sum, o) => sum + getOrderPendingCents(state, o.id), 0);

    for (const line of state.paymentLines) {
      if (line.status !== 'confirmado' || !orderIds.has(line.orderId)) continue;
      confirmed[line.method] += line.amountCents;
    }

    const openShift = getOpenShift(state, branchId);
    return {
      branchId,
      branchName: getBranchDisplayName(state, branchId),
      cashCents: confirmed.efectivo,
      cardCents: confirmed.tarjeta,
      transferCents: confirmed.transferencia,
      pendingCents,
      totalConfirmedCents: confirmed.efectivo + confirmed.tarjeta + confirmed.transferencia,
      orderCount: branchOrders.length,
      openShiftNumber: openShift?.number ?? null,
    };
  });

  const totals = byBranch.reduce(
    (acc, row) => ({
      cashCents: acc.cashCents + row.cashCents,
      cardCents: acc.cardCents + row.cardCents,
      transferCents: acc.transferCents + row.transferCents,
      pendingCents: acc.pendingCents + row.pendingCents,
      totalConfirmedCents: acc.totalConfirmedCents + row.totalConfirmedCents,
      orderCount: acc.orderCount + row.orderCount,
    }),
    {
      cashCents: 0,
      cardCents: 0,
      transferCents: 0,
      pendingCents: 0,
      totalConfirmedCents: 0,
      orderCount: 0,
    },
  );

  const eligibleTickets = getEligibleRaffleTickets(state, raffleYear);
  const draws = (state.raffleDraws ?? []).filter((d) => d.year === raffleYear);
  const hasFilters = datePreset !== 'todo' || serviceFilter !== 'todos';

  function exportReport() {
    const header = 'Sucursal,Folios,Efectivo MXN,Tarjeta MXN,Transferencia MXN,Pendiente MXN,Total confirmado MXN';
    const money = (cents: number) => (cents / 100).toFixed(2);
    const rows = byBranch.map((row) => [
      row.branchName, row.orderCount, money(row.cashCents), money(row.cardCents),
      money(row.transferCents), money(row.pendingCents), money(row.totalConfirmedCents),
    ].join(','));
    const csv = new Blob(['\uFEFF', [header, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(csv);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `horeb360-reporte-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleRunDraw(event: React.FormEvent) {
    event.preventDefault();
    if (!isSupervisor || drawing) return;
    setDrawing(true);
    setRaffleFeedback(null);
    try {
      const res = await onRunRaffleDraw(activeBranchId, {
        year: raffleYear,
        notes: drawNotes,
      });
      if (!res.ok) {
        setRaffleFeedback({ type: 'error', text: res.error ?? 'No se pudo ejecutar el sorteo.' });
        return;
      }
      setDrawNotes('');
      setRaffleFeedback({ type: 'success', text: `Sorteo ${raffleYear} ejecutado y registrado en historial.` });
    } finally {
      setDrawing(false);
    }
  }

  function handleSimulateDemoDraw() {
    const demoPool = [
      { code: `DEMO-${raffleYear}-001`, name: 'María Fernanda López (Demo)', phone: '8681234567' },
      { code: `DEMO-${raffleYear}-002`, name: 'Carlos Eduardo Garza (Demo)', phone: '8689876543' },
      { code: `DEMO-${raffleYear}-003`, name: 'Lucía Vargas (Demo)', phone: '8682114455' },
    ];
    const picked = demoPool[Math.floor(Math.random() * demoPool.length)];
    setDemoDraw({
      id: `demo-draw-${Date.now()}`,
      year: raffleYear,
      drawnAt: new Date().toISOString(),
      drawnBy: 'Simulación Demo (no guardado)',
      winnerTicketId: 'demo-ticket',
      winnerTicketCode: picked.code,
      winnerCustomerId: 'demo-cust',
      winnerCustomerName: picked.name,
      winnerCustomerPhone: picked.phone,
      eligibleTicketsCount: demoPool.length,
      notes: drawNotes.trim() || 'Simulación demostrativa 23 de diciembre (no altera la base de datos)',
    });
  }

  const showFinanzas = section === 'all' || section === 'finanzas';
  const showRifa = (section === 'all' || section === 'rifa') && isSupervisor;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-tour="admin-panel">
      {showFinanzas && (
        <section className="card">
          <h2 className="card-title">
            <span>
              {branches.length > 1
                ? `Cobros consolidados (${branches.length} sucursales)`
                : `Cobros · ${getBranchDisplayName(state, branches[0] ?? activeBranchId)}`}
            </span>
            <div className="card-title-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  hasFilters
                    ? exportOrdersToExcel(state, filteredOrders, 'reporte-filtrado')
                    : exportAdminConsolidatedToExcel(state, branches)
                }
              >
                <FileSpreadsheet size={16} aria-hidden="true" />{' '}
                {hasFilters ? 'Exportar filtro (.xlsx)' : 'Exportar Excel (.xlsx)'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={exportReport}>
                <Download size={15} aria-hidden="true" /> CSV
              </button>
            </div>
          </h2>

          {/* Report Filters (Date Range + Service Type) */}
          <div className="report-filters-bar">
            <div className="filter-pills-bar" style={{ marginBottom: 0 }} role="group" aria-label="Periodo del reporte">
              {(
                [
                  { id: 'todo', label: 'Todo' },
                  { id: 'hoy', label: 'Hoy' },
                  { id: '7dias', label: '7 días' },
                  { id: 'mes', label: 'Este mes' },
                  { id: 'rango', label: 'Rango' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`filter-pill${datePreset === p.id ? ' active' : ''}`}
                  aria-pressed={datePreset === p.id}
                  onClick={() => setDatePreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="view-toggle-group" role="group" aria-label="Tipo de servicio">
              {(
                [
                  { id: 'todos', label: 'Todos' },
                  { id: 'autoservicio', label: 'Autoservicio' },
                  { id: 'encargo', label: 'Encargo' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`view-toggle-btn${serviceFilter === s.id ? ' active' : ''}`}
                  aria-pressed={serviceFilter === s.id}
                  onClick={() => setServiceFilter(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {datePreset === 'rango' && (
            <div className="cash-controls" style={{ marginBottom: 12 }}>
              <label className="field" style={{ maxWidth: 180 }}>
                Desde
                <input
                  type="date"
                  className="input input-sm"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </label>
              <label className="field" style={{ maxWidth: 180 }}>
                Hasta
                <input
                  type="date"
                  className="input input-sm"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </label>
            </div>
          )}

          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-label">Total confirmado</div>
              <div className="metric-value">{formatMxnCurrency(totals.totalConfirmedCents)}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Efectivo</div>
              <div className="metric-value">{formatMxnCurrency(totals.cashCents)}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Tarjeta</div>
              <div className="metric-value">{formatMxnCurrency(totals.cardCents)}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Transferencia</div>
              <div className="metric-value">{formatMxnCurrency(totals.transferCents)}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Por cobrar</div>
              <div className="metric-value" style={{ color: totals.pendingCents > 0 ? 'var(--warning)' : 'inherit' }}>
                {formatMxnCurrency(totals.pendingCents)}
              </div>
            </div>
          </div>

          <div className="table-wrap stacked-table">
            <table role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader">Sucursal</th>
                  <th role="columnheader">Turno activo</th>
                  <th role="columnheader" className="num">Folios</th>
                  <th role="columnheader" className="num">Efectivo</th>
                  <th role="columnheader" className="num">Tarjeta</th>
                  <th role="columnheader" className="num">Transferencia</th>
                  <th role="columnheader" className="num">Pendiente</th>
                  <th role="columnheader" className="num">Total confirmado</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {byBranch.map((row) => (
                  <tr role="row" key={row.branchId}>
                    <td role="cell" data-row-heading>
                      <strong>{row.branchName}</strong>
                    </td>
                    <td role="cell" data-label="Turno activo">
                      {row.openShiftNumber ? (
                        <span className="badge badge-success">Turno #{row.openShiftNumber}</span>
                      ) : (
                        <span className="badge badge-warning">Cerrada</span>
                      )}
                    </td>
                    <td role="cell" data-label="Folios" className="num">{row.orderCount}</td>
                    <td role="cell" data-label="Efectivo" className="num">{formatMxn(row.cashCents)}</td>
                    <td role="cell" data-label="Tarjeta" className="num">{formatMxn(row.cardCents)}</td>
                    <td role="cell" data-label="Transferencia" className="num">{formatMxn(row.transferCents)}</td>
                    <td role="cell" data-label="Pendiente" className="num">{formatMxn(row.pendingCents)}</td>
                    <td role="cell" data-label="Total confirmado" className="num">
                      <strong>{formatMxnCurrency(row.totalConfirmedCents)}</strong>
                    </td>
                  </tr>
                ))}
                {byBranch.length > 1 && (
                  <tr role="row" style={{ background: 'var(--surface-alt)', fontWeight: 800 }}>
                    <td role="cell" data-row-heading colSpan={2}>Total general</td>
                    <td role="cell" data-label="Folios" className="num">{totals.orderCount}</td>
                    <td role="cell" data-label="Efectivo" className="num">{formatMxn(totals.cashCents)}</td>
                    <td role="cell" data-label="Tarjeta" className="num">{formatMxn(totals.cardCents)}</td>
                    <td role="cell" data-label="Transferencia" className="num">{formatMxn(totals.transferCents)}</td>
                    <td role="cell" data-label="Pendiente" className="num">{formatMxn(totals.pendingCents)}</td>
                    <td role="cell" data-label="Total confirmado" className="num">{formatMxnCurrency(totals.totalConfirmedCents)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showRifa && (
        <section className="card">
          <h2 className="card-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Ticket size={18} aria-hidden="true" />
              Rifa anual (23 dic) y boletos elegibles · {raffleYear}
            </span>
            <span className="badge badge-info">{eligibleTickets.length} boletos reales</span>
          </h2>

          <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
            Participan boletos generados por combos gratis completados en el año calendario. Supervisión ejecuta el sorteo manual y conserva el historial completo.
          </p>

          {raffleFeedback && (
            <div className={`alert alert-${raffleFeedback.type}`} role={raffleFeedback.type === 'error' ? 'alert' : 'status'}>
              {raffleFeedback.text}
            </div>
          )}

          <form className="cash-controls" onSubmit={handleRunDraw} style={{ marginBottom: 14 }}>
            <label className="field" style={{ maxWidth: 110 }}>
              Año
              <input
                className="input"
                type="number"
                min={2025}
                max={2100}
                value={raffleYear}
                onChange={(e) => setRaffleYear(Number(e.target.value) || currentYear)}
              />
            </label>
            <label className="field">
              Nota / premio del sorteo (opcional)
              <input
                className="input"
                placeholder="Ej. Rifa 23 de diciembre · Premio principal"
                value={drawNotes}
                onChange={(e) => setDrawNotes(e.target.value)}
                maxLength={140}
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={drawing || eligibleTickets.length === 0}
            >
              <Sparkles size={16} />
              {drawing ? 'Sorteando…' : 'Realizar sorteo real'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleSimulateDemoDraw}
            >
              <Ticket size={16} />
              Simular sorteo demo
            </button>
          </form>

          {demoDraw && (
            <div style={{ marginBottom: 16 }}>
              <div className="raffle-winner-card" style={{ borderColor: 'var(--warning-border)', background: 'var(--warning-soft)' }}>
                <div>
                  <span className="badge badge-warning">
                    <Award size={13} /> DEMO · Ganador simulado {demoDraw.winnerTicketCode}
                  </span>
                  <strong style={{ display: 'block', marginTop: 4 }}>
                    {demoDraw.winnerCustomerName} ({demoDraw.winnerCustomerPhone})
                  </strong>
                  {demoDraw.notes && <small style={{ display: 'block' }}>{demoDraw.notes}</small>}
                </div>
                <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                  <small className="muted">Simulación local · No guardada en BD</small>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setDemoDraw(null)}
                  >
                    Cerrar demo
                  </button>
                </div>
              </div>
            </div>
          )}

          {draws.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <strong style={{ display: 'block', marginBottom: 8 }}>Historial de sorteos ({raffleYear})</strong>
              <div style={{ display: 'grid', gap: 8 }}>
                {draws.map((draw) => (
                  <div key={draw.id} className="raffle-winner-card">
                    <div>
                      <span className="badge badge-success">
                        <Award size={13} /> Ganador {draw.winnerTicketCode}
                      </span>
                      <strong style={{ display: 'block', marginTop: 4 }}>
                        {draw.winnerCustomerName} ({draw.winnerCustomerPhone})
                      </strong>
                      {draw.notes && <small style={{ display: 'block' }}>{draw.notes}</small>}
                    </div>
                    <small className="muted" style={{ textAlign: 'right' }}>
                      {new Date(draw.drawnAt).toLocaleString('es-MX')}
                      <br />
                      Por {draw.drawnBy} · {draw.eligibleTicketsCount} boleto(s)
                    </small>
                  </div>
                ))}
              </div>
            </div>
          )}

          <strong style={{ display: 'block', marginBottom: 8 }}>Boletos elegibles activos</strong>
          {eligibleTickets.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No hay boletos reales emitidos aún para {raffleYear}. Se generan cuando un cliente completa su combo gratis tras 10 combos pagados. Usa "Simular sorteo demo" arriba para demostrar el flujo sin tocar datos reales.
            </p>
          ) : (
            <div className="table-wrap stacked-table">
              <table role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader">Boleto</th>
                    <th role="columnheader">Cliente</th>
                    <th role="columnheader">Teléfono</th>
                    <th role="columnheader">Sucursal</th>
                    <th role="columnheader">Folio origen</th>
                    <th role="columnheader">Emitido</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {eligibleTickets.map((ticket) => (
                    <tr role="row" key={ticket.id}>
                      <td role="cell" data-row-heading><strong>{ticket.ticketCode}</strong></td>
                      <td role="cell" data-label="Cliente">{ticket.customerName}</td>
                      <td role="cell" data-label="Teléfono">{ticket.customerPhone}</td>
                      <td role="cell" data-label="Sucursal">{getBranchDisplayName(state, ticket.branchId)}</td>
                      <td role="cell" data-label="Folio origen">{ticket.orderFolio}</td>
                      <td role="cell" data-label="Emitido">{new Date(ticket.issuedAt).toLocaleDateString('es-MX')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
