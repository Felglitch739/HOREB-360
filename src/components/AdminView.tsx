import { useState } from 'react';
import { Award, Download, Sparkles, Ticket } from 'lucide-react';
import { formatMxn } from '../domain/money';
import { getBranchInfo, getEligibleRaffleTickets, getGlobalAdminTotals } from '../domain/rules';
import type { BranchRole } from '../domain/sharedState';
import type { BranchId, DemoState } from '../domain/types';

interface AdminViewProps {
  state: DemoState;
  branches: BranchId[];
  activeBranchId: BranchId;
  role: BranchRole;
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-tour="admin-panel">
      <section className="card">
        <h2 className="card-title">
          <span>Cobros por sucursal</span>
          <button className="btn btn-secondary btn-sm" onClick={exportReport}><Download size={16} /> Exportar CSV</button>
        </h2>

        <div className="metrics-grid">
          <div className="metric-box">
            <div className="metric-label">Total confirmado</div>
            <div className="metric-value">{formatMxn(totals.totalConfirmedCents)}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Efectivo confirmado</div>
            <div className="metric-value">{formatMxn(totals.cashCents)}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Tarjeta confirmada</div>
            <div className="metric-value">{formatMxn(totals.cardCents)}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Transferencia confirmada</div>
            <div className="metric-value">{formatMxn(totals.transferCents)}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Saldo pendiente total</div>
            <div className="metric-value" style={{ color: totals.pendingCents > 0 ? 'var(--warning)' : 'inherit' }}>
              {formatMxn(totals.pendingCents)}
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sucursal</th>
                <th>Turno activo</th>
                <th className="num">Folios</th>
                <th className="num">Efectivo</th>
                <th className="num">Tarjeta</th>
                <th className="num">Transferencia</th>
                <th className="num">Pendiente</th>
                <th className="num">Total confirmado</th>
              </tr>
            </thead>
            <tbody>
              {byBranch.map((row) => (
                <tr key={row.branch.id}>
                  <td>
                    <strong>{row.branch.name}</strong>
                  </td>
                  <td>
                    {row.openShiftNumber ? (
                      <span className="badge badge-success">Turno #{row.openShiftNumber}</span>
                    ) : (
                      <span className="badge badge-warning">Cerrada</span>
                    )}
                  </td>
                  <td className="num">{row.orderCount}</td>
                  <td className="num">{formatMxn(row.cashCents)}</td>
                  <td className="num">{formatMxn(row.cardCents)}</td>
                  <td className="num">{formatMxn(row.transferCents)}</td>
                  <td className="num">{formatMxn(row.pendingCents)}</td>
                  <td className="num">
                    <strong>{formatMxn(row.totalConfirmedCents)}</strong>
                  </td>
                </tr>
              ))}
              <tr style={{ background: 'var(--surface-alt)', fontWeight: 800 }}>
                <td colSpan={2}>Total general</td>
                <td className="num">{totals.orderCount}</td>
                <td className="num">{formatMxn(totals.cashCents)}</td>
                <td className="num">{formatMxn(totals.cardCents)}</td>
                <td className="num">{formatMxn(totals.transferCents)}</td>
                <td className="num">{formatMxn(totals.pendingCents)}</td>
                <td className="num">{formatMxn(totals.totalConfirmedCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {isSupervisor && (
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
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Boleto</th>
                    <th>Cliente</th>
                    <th>Teléfono</th>
                    <th>Sucursal</th>
                    <th>Folio origen</th>
                    <th>Emitido</th>
                  </tr>
                </thead>
                <tbody>
                  {eligibleTickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td><strong>{ticket.ticketCode}</strong></td>
                      <td>{ticket.customerName}</td>
                      <td>{ticket.customerPhone}</td>
                      <td>{getBranchInfo(ticket.branchId).name}</td>
                      <td>{ticket.orderFolio}</td>
                      <td>{new Date(ticket.issuedAt).toLocaleDateString('es-MX')}</td>
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
