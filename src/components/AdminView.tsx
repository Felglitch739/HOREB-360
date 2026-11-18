import { Download } from 'lucide-react';
import { formatMxn } from '../domain/money';
import { getGlobalAdminTotals } from '../domain/rules';
import type { BranchId, DemoState } from '../domain/types';

interface AdminViewProps {
  state: DemoState;
  branches: BranchId[];
}

export function AdminView({ state, branches }: AdminViewProps) {
  const { byBranch, totals } = getGlobalAdminTotals(state, branches);

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
    </div>
  );
}
