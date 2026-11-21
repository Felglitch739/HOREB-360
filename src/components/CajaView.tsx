import { useEffect, useState } from 'react';
import { Calculator, FileSpreadsheet, Lock, MoonStar, PlayCircle, RotateCcw } from 'lucide-react';
import { exportShiftsToExcel } from '../domain/excelExport';
import { formatMxn, parsePesosToCents } from '../domain/money';
import { getBranchInfo, getOpenShift, getShiftMetrics } from '../domain/rules';
import type { BranchId, CashMovement, DemoState } from '../domain/types';
import { CustomSelect } from './CustomSelect';
import { TransferInboxPanel } from './TransferInboxPanel';
import { usePendingAction } from './usePendingAction';

const MXN_DENOMINATIONS = [
  { key: '1000', label: '$1,000', cents: 100000, group: 'billete' },
  { key: '500', label: '$500', cents: 50000, group: 'billete' },
  { key: '200', label: '$200', cents: 20000, group: 'billete' },
  { key: '100', label: '$100', cents: 10000, group: 'billete' },
  { key: '50', label: '$50', cents: 5000, group: 'billete' },
  { key: '20', label: '$20', cents: 2000, group: 'billete' },
  { key: '10', label: '$10', cents: 1000, group: 'moneda' },
  { key: '5', label: '$5', cents: 500, group: 'moneda' },
  { key: '2', label: '$2', cents: 200, group: 'moneda' },
  { key: '1', label: '$1', cents: 100, group: 'moneda' },
  { key: '0.5', label: '$0.50', cents: 50, group: 'moneda' },
] as const;

interface CajaViewProps {
  state: DemoState;
  canManage: boolean;
  branchId: BranchId;
  onCloseShift: (branchId: BranchId, countedCashCents: number) => Promise<{ ok: boolean; error?: string }>;
  onOpenNewShift: (branchId: BranchId, openingCashCents: number) => Promise<{ ok: boolean; error?: string }>;
  onMovement: (branchId: BranchId, kind: CashMovement['kind'], amount: number, reason: string) => Promise<{ ok: boolean; error?: string }>;
  onConfirmPaymentLine: (lineId: string, reference?: string) => Promise<{ ok: boolean; error?: string }>;
  onConfirmTransferBatch: (
    branchId: BranchId,
    items: Array<{ lineId: string; reference?: string }>,
  ) => Promise<{ ok: boolean; error?: string }>;
  onRunNightClosing: (
    branchId: BranchId,
    options: { closingDate?: string; enforce2300Rule?: boolean },
  ) => Promise<{ ok: boolean; error?: string }>;
}

export function CajaView({
  state,
  branchId,
  canManage,
  onCloseShift,
  onOpenNewShift,
  onMovement,
  onConfirmPaymentLine,
  onConfirmTransferBatch,
  onRunNightClosing,
}: CajaViewProps) {
  const branch = getBranchInfo(branchId);
  const openShift = getOpenShift(state, branchId);
  const branchShifts = state.shifts
    .filter((s) => s.branchId === branchId)
    .sort((a, b) => b.number - a.number);
  const branchNightClosings = (state.nightClosings ?? [])
    .filter((nc) => nc.branchId === branchId)
    .sort((a, b) => b.closingDate.localeCompare(a.closingDate));

  const openMetrics = openShift ? getShiftMetrics(state, openShift.id) : null;

  const [openingCash, setOpeningCash] = useState('0');
  const [movementKind, setMovementKind] = useState<CashMovement['kind']>('entrada');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [countedCashInput, setCountedCashInput] = useState('0');
  const [showDenomCounter, setShowDenomCounter] = useState(false);
  const [denomCounts, setDenomCounts] = useState<Record<string, number>>({});
  const [controlledDate, setControlledDate] = useState(() => new Date().toISOString().slice(0, 10));
  const { pending, run } = usePendingAction();
  const [nightFeedback, setNightFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [feedbackAction, setFeedbackAction] = useState<'close' | 'open' | 'movement'>('close');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    if (openMetrics) {
      setCountedCashInput((openMetrics.expectedCashCents / 100).toFixed(2));
      setDenomCounts({});
    }
  }, [branchId, openShift?.id, openMetrics?.expectedCashCents]);

  function updateDenom(key: string, rawValue: string) {
    const parsed = Math.max(0, Math.min(9999, Math.floor(Number(rawValue) || 0)));
    setDenomCounts((prev) => {
      const next = { ...prev, [key]: parsed };
      const sumCents = MXN_DENOMINATIONS.reduce(
        (acc, item) => acc + (next[item.key] ?? 0) * item.cents,
        0,
      );
      setCountedCashInput((sumCents / 100).toFixed(2));
      return next;
    });
  }

  function clearDenoms() {
    setDenomCounts({});
    setCountedCashInput('0.00');
  }

  const parsedCountedCents = parsePesosToCents(countedCashInput);
  const liveDiffCents =
    openMetrics && parsedCountedCents !== null
      ? parsedCountedCents - openMetrics.expectedCashCents
      : null;

  function saveCashAction(
    action: 'close' | 'open' | 'movement',
    save: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
    failure: string,
    onSaved?: () => void,
  ) {
    return run(action, async () => {
      setFeedbackAction(action);
      setFeedback(null);
      const result = await save();
      if (result.ok) {
        onSaved?.();
        setFeedback({ type: 'success', text: success });
      } else {
        setFeedback({ type: 'error', text: result.error ?? failure });
      }
    }, () => setFeedback({
      type: 'error',
      text: 'No se pudo verificar el resultado. Revisa el turno y sus movimientos antes de repetir la operación.',
    }));
  }

  function handleClose(event: React.FormEvent) {
    event.preventDefault();
    const cents = parsePesosToCents(countedCashInput);
    if (cents === null) {
      setFeedbackAction('close');
      setFeedback({ type: 'error', text: 'Captura un efectivo contado válido en MXN.' });
      return;
    }
    void saveCashAction('close', () => onCloseShift(branchId, cents),
      `Corte guardado en ${branch.name}.`, 'No se pudo cerrar el turno.');
  }

  function handleOpen() {
    const amount = parsePesosToCents(openingCash);
    if (amount === null) {
      setFeedbackAction('open');
      setFeedback({ type: 'error', text: 'Captura el fondo inicial en MXN.' });
      return;
    }
    void saveCashAction('open', () => onOpenNewShift(branchId, amount),
      `Nuevo turno abierto en ${branch.name}.`, 'No se pudo abrir el turno.');
  }

  function handleMovement(event: React.FormEvent) {
    event.preventDefault();
    const amount = parsePesosToCents(movementAmount);
    if (amount === null || amount <= 0) {
      setFeedbackAction('movement');
      setFeedback({ type: 'error', text: 'Captura un monto mayor a cero en MXN.' });
      return;
    }
    void saveCashAction('movement', () => onMovement(branchId, movementKind, amount, movementReason),
      'Movimiento registrado.', 'No se pudo guardar el movimiento.', () => {
        setMovementAmount('');
        setMovementReason('');
      });
  }

  function handleNight(testDate?: string) {
    const action = testDate ? 'night-test' : 'night';
    void run(action, async () => {
      setNightFeedback(null);
      const result = await onRunNightClosing(branchId, testDate
        ? { closingDate: testDate, enforce2300Rule: false }
        : { enforce2300Rule: true });
      setNightFeedback(result.ok
        ? { type: 'success', text: `Cierre nocturno verificado para ${branch.name}.` }
        : { type: 'error', text: result.error ?? 'No se pudo ejecutar el cierre.' });
    }, () => setNightFeedback({
      type: 'error',
      text: 'No se pudo verificar el cierre nocturno. Revisa el historial antes de repetirlo.',
    }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-tour="caja-panel">
      <section className="card">
        <h2 className="card-title">
          <span>
            Caja · {branch.name} {openShift ? `· Turno #${openShift.number} (Abierto)` : '· Sin turno abierto'}
          </span>
          <span className={`badge ${openShift ? 'badge-success' : 'badge-warning'}`}>
            {openShift ? `Turno #${openShift.number}` : 'Caja cerrada'}
          </span>
        </h2>

        {feedback && feedbackAction !== 'movement' && (
          <div role={feedback.type === 'error' ? 'alert' : 'status'} className={`alert ${feedback.type === 'error' ? 'alert-error' : 'alert-success'}`}>
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

            {canManage && (
              <div className="caja-close-panel">
                <div className="caja-close-head">
                  <button
                    type="button"
                    className={`btn btn-secondary btn-sm${showDenomCounter ? ' active' : ''}`}
                    aria-expanded={showDenomCounter}
                    onClick={() => setShowDenomCounter((prev) => !prev)}
                  >
                    <Calculator size={15} aria-hidden="true" />
                    {showDenomCounter ? 'Ocultar desglose de efectivo' : 'Contar billetes y monedas'}
                  </button>
                  {liveDiffCents !== null && (
                    <span
                      className={`badge ${
                        liveDiffCents === 0
                          ? 'badge-success'
                          : liveDiffCents > 0
                            ? 'badge-info'
                            : 'badge-danger'
                      }`}
                    >
                      {liveDiffCents === 0
                        ? 'Cuadrado ($0.00)'
                        : liveDiffCents > 0
                          ? `Sobrante +${formatMxn(liveDiffCents)}`
                          : `Faltante ${formatMxn(liveDiffCents)}`}
                    </span>
                  )}
                </div>

                {showDenomCounter && (
                  <div className="denom-panel">
                    <div className="denom-panel-head">
                      <span>Captura cuántas piezas tienes de cada denominación</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={clearDenoms}
                      >
                        <RotateCcw size={13} aria-hidden="true" /> Limpiar
                      </button>
                    </div>
                    <div className="denom-grid">
                      {MXN_DENOMINATIONS.map((item) => {
                        const qty = denomCounts[item.key] ?? 0;
                        return (
                          <label key={item.key} className={`denom-cell${qty > 0 ? ' active' : ''}`}>
                            <span className="denom-label">{item.label}</span>
                            <input
                              type="number"
                              min={0}
                              max={9999}
                              inputMode="numeric"
                              className="input input-sm denom-input"
                              aria-label={`Cantidad de ${item.label}`}
                              value={qty === 0 ? '' : String(qty)}
                              placeholder="0"
                              onChange={(e) => updateDenom(item.key, e.target.value)}
                            />
                            <small className="denom-sub">
                              {qty > 0 ? formatMxn(qty * item.cents) : '—'}
                            </small>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <form onSubmit={handleClose} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                  <div className="field" style={{ marginBottom: 0, minWidth: 220, flex: '1 1 220px' }}>
                    <label htmlFor="counted-cash">Efectivo contado al cierre (MXN)</label>
                    <input
                      id="counted-cash"
                      className="input"
                      inputMode="decimal"
                      value={countedCashInput}
                      onChange={(e) => setCountedCashInput(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="btn btn-danger" disabled={pending !== null}>
                    <Lock size={18} />
                    {pending === 'close' ? 'Guardando corte…' : `Cerrar turno #${openShift.number} y guardar corte`}
                  </button>
                </form>
              </div>
            )}
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
                disabled={pending !== null}
                onClick={handleOpen}
              >
                <PlayCircle size={18} />
                {pending === 'open' ? 'Abriendo turno…' : `Abrir turno nuevo en ${branch.name}`}
              </button>
            </div>}
          </div>
        )}
      </section>

      {canManage && openShift && <section className="card">
        <div className="section-head"><div><h2>Movimientos de efectivo</h2><p>Fondo inicial del turno {formatMxn(openShift.openingCashCents ?? 0)}</p></div></div>
        {feedback && feedbackAction === 'movement' && (
          <div className={`alert alert-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
            {feedback.text}
          </div>
        )}
        <form className="cash-controls" onSubmit={handleMovement}>
          <div className="field">
            <label htmlFor="movement-kind">Movimiento</label>
            <CustomSelect
              id="movement-kind"
              ariaLabel="Tipo de movimiento"
              value={movementKind}
              options={[
                { value: 'entrada', label: 'Entrada' },
                { value: 'retiro', label: 'Retiro' },
              ]}
              onChange={(val) => setMovementKind(val)}
            />
          </div>
          <label className="field">Monto (MXN)<input className="input" inputMode="decimal" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} required /></label>
          <label className="field">Motivo<input className="input" value={movementReason} onChange={(event) => setMovementReason(event.target.value)} required maxLength={100} /></label>
          <button className="btn btn-primary" type="submit" disabled={pending !== null}>
            {pending === 'movement' ? 'Guardando movimiento…' : 'Registrar movimiento'}
          </button>
        </form>
        {openShift.cashMovements?.length ? (
          <div className="table-wrap stacked-table cash-records">
            <table role="table">
              <thead role="rowgroup"><tr role="row"><th role="columnheader">Movimiento</th><th role="columnheader">Motivo</th><th role="columnheader" className="num">Monto</th></tr></thead>
              <tbody role="rowgroup">{openShift.cashMovements.map((item, index) => <tr role="row" key={item.createdAt + index}>
                <td role="cell" data-row-heading>{item.kind === 'entrada' ? 'Entrada' : 'Retiro'}</td><td role="cell" data-label="Motivo">{item.reason}</td><td role="cell" data-label="Monto" className="num">{formatMxn(item.amountCents)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.88rem' }}>
            Sin entradas ni retiros registrados en este turno.
          </p>
        )}
      </section>}

      {/* Historial de turnos */}
      <section className="card">
        <h2 className="card-title">
          <span>Historial de turnos · {branch.name}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={branchShifts.length === 0}
            onClick={() => exportShiftsToExcel(state, branchShifts, branchId)}
          >
            <FileSpreadsheet size={15} aria-hidden="true" /> Exportar Excel
          </button>
        </h2>
        <div className="table-wrap stacked-table">
          <table role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">Turno</th>
                <th role="columnheader">Estado</th>
                <th role="columnheader" className="num">Efectivo esp.</th>
                <th role="columnheader" className="num">Efectivo cont.</th>
                <th role="columnheader" className="num">Diferencia</th>
                <th role="columnheader" className="num">Tarjeta</th>
                <th role="columnheader" className="num">Transferencia</th>
                <th role="columnheader" className="num">Pendiente</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {branchShifts.map((shift) => {
                const m = getShiftMetrics(state, shift.id);
                return (
                  <tr role="row" key={shift.id}>
                    <td role="cell" data-row-heading>
                      <strong>Turno #{shift.number}</strong>
                      {(shift.openingCashCents || shift.cashMovements?.length) ? <details>
                        <summary>Ver movimientos</summary>
                        <small>Fondo {formatMxn(shift.openingCashCents ?? 0)}</small>
                        {(shift.cashMovements ?? []).map((item, index) => <div key={item.createdAt + index}>
                          {item.kind === 'entrada' ? 'Entrada' : 'Retiro'} {formatMxn(item.amountCents)} · {item.reason}
                        </div>)}
                      </details> : null}
                    </td>
                    <td role="cell" data-label="Estado">
                      <span className={`badge ${shift.status === 'abierto' ? 'badge-success' : 'badge-info'}`}>
                        {shift.status === 'abierto' ? 'Abierto' : 'Cerrado'}
                      </span>
                    </td>
                    <td role="cell" data-label="Efectivo esperado" className="num">{formatMxn(m.expectedCashCents)}</td>
                    <td role="cell" data-label="Efectivo contado" className="num">{shift.status === 'cerrado' ? formatMxn(m.countedCashCents) : '—'}</td>
                    <td role="cell" data-label="Diferencia" className={`num ${shift.status === 'cerrado' ? (m.differenceCents < 0 ? 'diff-neg' : m.differenceCents > 0 ? 'diff-pos' : '') : ''}`}>
                      {shift.status === 'cerrado'
                        ? `${m.differenceCents > 0 ? '+' : ''}${formatMxn(m.differenceCents)}`
                        : '—'}
                    </td>
                    <td role="cell" data-label="Tarjeta" className="num">{formatMxn(m.confirmedCardCents)}</td>
                    <td role="cell" data-label="Transferencia" className="num">{formatMxn(m.confirmedTransferCents)}</td>
                    <td role="cell" data-label="Pendiente" className="num">{formatMxn(m.pendingBalanceCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <TransferInboxPanel
        state={state}
        branchId={branchId}
        onConfirmPaymentLine={onConfirmPaymentLine}
        onConfirmTransferBatch={onConfirmTransferBatch}
      />

      <section className="card">
        <h2 className="card-title">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <MoonStar size={18} aria-hidden="true" />
            Cierre nocturno (23:00) y reportes · {branch.name}
          </span>
          <span className="badge badge-info">{branchNightClosings.length} reporte(s)</span>
        </h2>

        <p className="muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
          Registra un único corte nocturno por sucursal y fecha (23:00 hora Matamoros). Si el turno sigue abierto, se cierra en automático con el efectivo esperado; si ya se cerró manualmente, se conserva sin duplicar.
        </p>

        {nightFeedback && (
          <div className={`alert alert-${nightFeedback.type}`} role={nightFeedback.type === 'error' ? 'alert' : 'status'}>
            {nightFeedback.text}
          </div>
        )}

        {canManage && (
          <div className="cash-controls" style={{ marginBottom: 14 }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending !== null}
              onClick={() => handleNight()}
            >
              <MoonStar size={16} />
              {pending === 'night' ? 'Ejecutando corte…' : 'Ejecutar corte de las 23:00'}
            </button>

            {import.meta.env.DEV && (
              <>
                <label className="field" style={{ maxWidth: 170 }}>
                  Fecha controlada (prueba)
                  <input
                    type="date"
                    className="input"
                    value={controlledDate}
                    onChange={(e) => setControlledDate(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pending !== null}
                  onClick={() => handleNight(controlledDate)}
                >
                  {pending === 'night-test' ? 'Simulando cierre…' : 'Simular cierre en fecha (desarrollo)'}
                </button>
              </>
            )}
          </div>
        )}

        {branchNightClosings.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Aún no hay reportes de cierre nocturno guardados para {branch.name}.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {branchNightClosings.map((report) => (
              <details key={report.id} className="night-closing-card">
                <summary>
                  <div>
                    <strong>{report.closingDate}</strong> · {branch.name}{' '}
                    <span className={`badge ${report.wasAutoClosed ? 'badge-warning' : 'badge-success'}`}>
                      {report.wasAutoClosed ? `Turno #${report.shiftNumber ?? '-'} cerrado 23:00` : 'Corte manual previo'}
                    </span>
                  </div>
                  <strong>{formatMxn(report.totalConfirmedCents)} confirmado</strong>
                </summary>
                <pre className="night-report-pre">{report.reportText}</pre>
                <small className="muted">
                  Ejecutado: {new Date(report.executedAt).toLocaleString('es-MX')} · {report.executedBy}
                </small>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
