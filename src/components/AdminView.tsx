import { useState } from 'react';
import { Award, Download, FileSpreadsheet, Sparkles, Ticket } from 'lucide-react';
import { exportAdminConsolidatedToExcel } from '../domain/excelExport';
import { formatMxn } from '../domain/money';
import { getBranchInfo, getEligibleRaffleTickets, getGlobalAdminTotals } from '../domain/rules';
import type { BranchRole } from '../domain/sharedState';
import type { BranchId, DemoState } from '../domain/types';

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

export function AdminView({
  state,
  branches,
  activeBranchId,
  role,
  section = 'all',
  onRunRaffleDraw,
}: AdminViewProps) {
  const { byBranch, totals } = getGlobalAdminTotals(state, branches);
  const isSupervisor = role === 'supervisor';
  const currentYear = new Date().getFullYear();
  const [raffleYear, setRaffleYear] = useState(currentYear);
  const [drawNotes, setDrawNotes] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [raffleFeedback, setRaffleFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const eligibleTickets = getEligibleRaffleTickets(state, raffleYear);
  const draws = (state.raffleDraws ?? []).filter((d) => d.year === raffleYear);

  function exportReport() {
    const header = 'Sucursal,Folios,Efectivo MXN,Tarjeta MXN,Transferencia MXN,Pendiente MXN,Total confirmado MXN';
    const money = (cents: number) => (cents / 100).toFixed(2);
    const rows = byBranch.map((row) => [
      row.branch.name, row.orderCount, money(row.cashCents), money(row.cardCents),
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
                : `Cobros · ${getBranchInfo(branches[0] ?? activeBranchId).name}`}
            </span>
            <div className="card-title-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => exportAdminConsolidatedToExcel(state, branches)}
              >
                <FileSpreadsheet size={16} aria-hidden="true" /> Exportar Excel (.xlsx)
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={exportReport}>
                <Download size={15} aria-hidden="true" /> CSV
              </button>
            </div>
          </h2>

          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-label">Total confirmado</div>
              <div className="metric-value">{formatMxn(totals.totalConfirmedCents)}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Efectivo</div>
              <div className="metric-value">{formatMxn(totals.cashCents)}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Tarjeta</div>
              <div className="metric-value">{formatMxn(totals.cardCents)}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Transferencia</div>
              <div className="metric-value">{formatMxn(totals.transferCents)}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Por cobrar</div>
              <div className="metric-value" style={{ color: totals.pendingCents > 0 ? 'var(--warning)' : 'inherit' }}>
                {formatMxn(totals.pendingCents)}
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
                  <tr role="row" key={row.branch.id}>
                    <td role="cell" data-row-heading>
                      <strong>{row.branch.name}</strong>
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
                      <strong>{formatMxn(row.totalConfirmedCents)}</strong>
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
                    <td role="cell" data-label="Total confirmado" className="num">{formatMxn(totals.totalConfirmedCents)}</td>
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
              Rifa anual y boletos elegibles · {raffleYear}
            </span>
            <span className="badge badge-info">{eligibleTickets.length} boletos elegibles</span>
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
              {drawing ? 'Sorteando…' : 'Realizar sorteo manual'}
            </button>
          </form>

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
              No hay boletos elegibles disponibles para {raffleYear}. Se generan cuando un cliente completa su combo gratis tras 10 combos pagados.
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
                      <td role="cell" data-label="Sucursal">{getBranchInfo(ticket.branchId).name}</td>
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
