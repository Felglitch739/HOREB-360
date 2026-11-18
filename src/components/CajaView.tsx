import { useEffect, useState } from 'react';
import { Lock, PlayCircle } from 'lucide-react';
import { formatMxn, parsePesosToCents } from '../domain/money';
import { getBranchInfo, getOpenShift, getShiftMetrics } from '../domain/rules';
import type { BranchId, CashMovement, DemoState } from '../domain/types';

interface CajaViewProps {
  state: DemoState;
  canManage: boolean;
  branchId: BranchId;
  onCloseShift: (branchId: BranchId, countedCashCents: number) => Promise<{ ok: boolean; error?: string }>;
  onOpenNewShift: (branchId: BranchId, openingCashCents: number) => Promise<{ ok: boolean; error?: string }>;
  onMovement: (branchId: BranchId, kind: CashMovement['kind'], amount: number, reason: string) => Promise<{ ok: boolean; error?: string }>;
}

export function CajaView({ state, branchId, canManage, onCloseShift, onOpenNewShift, onMovement }: CajaViewProps) {
  const branch = getBranchInfo(branchId);
  const openShift = getOpenShift(state, branchId);
  const branchShifts = state.shifts
    .filter((s) => s.branchId === branchId)
    .sort((a, b) => b.number - a.number);

  const openMetrics = openShift ? getShiftMetrics(state, openShift.id) : null;

  const [openingCash, setOpeningCash] = useState('0');
  const [movementKind, setMovementKind] = useState<CashMovement['kind']>('entrada');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [countedCashInput, setCountedCashInput] = useState('0');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    if (openMetrics) {
      setCountedCashInput((openMetrics.expectedCashCents / 100).toFixed(2));
    }
  }, [branchId, openShift?.id, openMetrics?.expectedCashCents]);

  async function handleClose(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const cents = parsePesosToCents(countedCashInput);
    if (cents === null) {
      setFeedback({ type: 'error', text: 'Captura un efectivo contado válido en MXN.' });
      return;
    }
    const res = await onCloseShift(branchId, cents);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo cerrar el turno.' });
      return;
    }
    setFeedback({ type: 'success', text: `Corte guardado en ${branch.name}.` });
  }

  async function handleMovement(event: React.FormEvent) {
    event.preventDefault();
    const amount = parsePesosToCents(movementAmount);
    const result = await onMovement(branchId, movementKind, amount ?? 0, movementReason);
    if (!result.ok) {
      setFeedback({ type: 'error', text: result.error ?? 'No se pudo guardar el movimiento.' });
      return;
    }
    setMovementAmount('');
    setMovementReason('');
    setFeedback({ type: 'success', text: 'Movimiento registrado.' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="card">
        <h2 className="card-title">
          <span>
            Caja · {branch.name} {openShift ? `· Turno #${openShift.number} (Abierto)` : '· Sin turno abierto'}
          </span>
          <span className={`badge ${openShift ? 'badge-success' : 'badge-warning'}`}>
            {openShift ? `Turno #${openShift.number}` : 'Caja cerrada'}
          </span>
        </h2>

        {feedback && (
          <div className={`alert ${feedback.type === 'error' ? 'alert-error' : 'alert-success'}`}>
            {feedback.text}
          </div>
        )}

        {openShift && openMetrics ? (
          <>
            <div className="metrics-grid">
              <div className="metric-box">
                <div className="metric-label">Efectivo esperado</div>
                <div className="metric-value">{formatMxn(openMetrics.expectedCashCents)}</div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Tarjeta confirmada</div>
                <div className="metric-value">{formatMxn(openMetrics.confirmedCardCents)}</div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Transferencia confirmada</div>
                <div className="metric-value">{formatMxn(openMetrics.confirmedTransferCents)}</div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Saldo pendiente (sucursal)</div>
                <div className="metric-value" style={{ color: openMetrics.pendingBalanceCents > 0 ? 'var(--warning)' : 'inherit' }}>
                  {formatMxn(openMetrics.pendingBalanceCents)}
                </div>
              </div>
            </div>

            {canManage && <form onSubmit={handleClose} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
              <div className="field" style={{ marginBottom: 0, minWidth: 220, flex: '1 1 220px' }}>
                <label htmlFor="counted-cash">Efectivo contado al cierre (MXN)</label>
                <input
                  id="counted-cash"
                  className="input"
                  value={countedCashInput}
                  onChange={(e) => setCountedCashInput(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-danger">
                <Lock size={18} />
                Cerrar Turno #{openShift.number} y guardar corte
              </button>
            </form>}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p className="muted" style={{ margin: 0 }}>
              No hay un turno abierto en <strong>{branch.name}</strong>. Abre un turno nuevo para registrar ventas o confirmar pagos pendientes.
            </p>
            {canManage && <div className="cash-controls">
              <label className="field">Fondo inicial (MXN)
                <input className="input" inputMode="decimal" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const amount = parsePesosToCents(openingCash);
                  if (amount === null) {
                    setFeedback({ type: 'error', text: 'Captura el fondo inicial en MXN.' });
                    return;
                  }
                  const res = await onOpenNewShift(branchId, amount);
                  if (!res.ok && res.error) setFeedback({ type: 'error', text: res.error });
                  else setFeedback({ type: 'success', text: `Nuevo turno abierto en ${branch.name}.` });
                }}
              >
                <PlayCircle size={18} />
                Abrir turno nuevo en {branch.name}
              </button>
            </div>}
          </div>
        )}
      </section>

      {canManage && openShift && <section className="card">
        <div className="section-head"><div><h2>Movimientos de efectivo</h2><p>Fondo inicial del turno {formatMxn(openShift.openingCashCents ?? 0)}</p></div></div>
        <form className="cash-controls" onSubmit={handleMovement}>
          <label className="field">Movimiento<select className="input" value={movementKind} onChange={(event) => setMovementKind(event.target.value as CashMovement['kind'])}><option value="entrada">Entrada</option><option value="retiro">Retiro</option></select></label>
          <label className="field">Monto (MXN)<input className="input" inputMode="decimal" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} required /></label>
          <label className="field">Motivo<input className="input" value={movementReason} onChange={(event) => setMovementReason(event.target.value)} required maxLength={100} /></label>
          <button className="btn btn-primary" type="submit">Registrar movimiento</button>
        </form>
        {openShift.cashMovements?.length ? <div className="table-wrap cash-records"><table>
          <thead><tr><th>Movimiento</th><th>Motivo</th><th className="num">Monto</th></tr></thead>
          <tbody>{openShift.cashMovements.map((item, index) => <tr key={item.createdAt + index}>
            <td>{item.kind === 'entrada' ? 'Entrada' : 'Retiro'}</td><td>{item.reason}</td><td className="num">{formatMxn(item.amountCents)}</td>
          </tr>)}</tbody></table></div> : null}
      </section>}

      {/* Historial de turnos */}
      <section className="card">
        <h2 className="card-title">
          <span>Historial de turnos · {branch.name}</span>
        </h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Turno</th>
                <th>Estado</th>
                <th className="num">Efectivo esp.</th>
                <th className="num">Efectivo cont.</th>
                <th className="num">Diferencia</th>
                <th className="num">Tarjeta</th>
                <th className="num">Transferencia</th>
                <th className="num">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {branchShifts.map((shift) => {
                const m = getShiftMetrics(state, shift.id);
                return (
                  <tr key={shift.id}>
                    <td>
                      <strong>Turno #{shift.number}</strong>
                      {(shift.openingCashCents || shift.cashMovements?.length) ? <details>
                        <summary>Ver movimientos</summary>
                        <small>Fondo {formatMxn(shift.openingCashCents ?? 0)}</small>
                        {(shift.cashMovements ?? []).map((item, index) => <div key={item.createdAt + index}>
                          {item.kind === 'entrada' ? 'Entrada' : 'Retiro'} {formatMxn(item.amountCents)} · {item.reason}
                        </div>)}
                      </details> : null}
                    </td>
                    <td>
                      <span className={`badge ${shift.status === 'abierto' ? 'badge-success' : 'badge-info'}`}>
                        {shift.status === 'abierto' ? 'Abierto' : 'Cerrado'}
                      </span>
                    </td>
                    <td className="num">{formatMxn(m.expectedCashCents)}</td>
                    <td className="num">{shift.status === 'cerrado' ? formatMxn(m.countedCashCents) : '—'}</td>
                    <td className="num">{shift.status === 'cerrado' ? formatMxn(m.differenceCents) : '—'}</td>
                    <td className="num">{formatMxn(m.confirmedCardCents)}</td>
                    <td className="num">{formatMxn(m.confirmedTransferCents)}</td>
                    <td className="num">{formatMxn(m.pendingBalanceCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
