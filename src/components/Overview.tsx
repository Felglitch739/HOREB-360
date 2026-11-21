import { useState } from 'react';
import { ArrowRight, Banknote, CalendarDays, Plus, ScrollText, Wallet, WashingMachine } from 'lucide-react';
import { formatMxn } from '../domain/money';
import { ENCARGO_STAGES, getBranchInfo, getBranchSummary, getOpenShift, getOrderPendingCents } from '../domain/rules';
import type { BranchId, DemoState } from '../domain/types';

const weekday = new Intl.DateTimeFormat('es-MX', { weekday: 'short' });
const dayLabel = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

interface Props {
  state: DemoState;
  branchId: BranchId;
  onNew: () => void;
  onOrders: (filter?: string, query?: string) => void;
  onOpenCaja?: () => void;
}

export function Overview({ state, branchId, onNew, onOrders, onOpenCaja }: Props) {
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);
  const branch = getBranchInfo(branchId);
  const openShift = getOpenShift(state, branchId);
  const summary = getBranchSummary(state, branchId);
  const orders = state.orders.filter((order) => order.branchId === branchId);
  const ready = orders.filter((order) => order.encargoStage === 'listo').length;
  const today = new Date();
  const ids = new Set(orders.map((order) => order.id));
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const total = state.paymentLines.reduce((sum, line) => {
      if (!line.confirmedAt || !ids.has(line.orderId)) return sum;
      const timestamp = new Date(line.confirmedAt);
      return timestamp >= date && timestamp < end ? sum + line.amountCents : sum;
    }, 0);
    return { date, total };
  });
  const max = Math.max(1, ...days.map((day) => day.total));

  const kpis = [
    { label: 'Cobrado', value: formatMxn(summary.totalConfirmedCents), note: 'Pagos confirmados', filter: undefined },
    { label: 'Por cobrar', value: formatMxn(summary.pendingCents), note: 'Ver saldos pendientes', filter: 'pendientes', warn: summary.pendingCents > 0 },
    { label: 'Listos para entregar', value: String(ready), note: 'Ver encargos listos', filter: 'listo' },
    { label: 'Órdenes en sucursal', value: String(orders.length), note: 'Ir al listado', filter: 'todas' },
  ];

  return (
    <div className="dashboard">
      <div className="page-intro">
        <div>
          <h1>Resumen · {branch.name}</h1>
          <p style={{ textTransform: 'capitalize' }}>{dayLabel.format(today)}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onNew}>
          <Plus size={17} /> Nueva orden
        </button>
      </div>

      {!openShift && (
        <div className="alert alert-error offline-sync-bar" role="status">
          <span>
            <strong>Caja cerrada en {branch.name}.</strong> Abre un turno para registrar ventas y confirmar cobros.
          </span>
          {onOpenCaja && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenCaja}>
              <Wallet size={15} aria-hidden="true" /> Ir a Caja
            </button>
          )}
        </div>
      )}

      <div className="kpi-strip" data-tour="overview-stats">
        {kpis.map(({ label, value, note, filter, warn }) => {
          const inner = (
            <>
              <span className="kpi-label">{label}</span>
              <strong className="kpi-value" style={warn ? { color: 'var(--warning)' } : undefined}>
                {value}
              </strong>
              <span className="kpi-note">
                {note}
                {filter && <ArrowRight size={13} aria-hidden="true" />}
              </span>
            </>
          );
          return filter ? (
            <button key={label} type="button" className="kpi-cell interactive" onClick={() => onOrders(filter)}>
              {inner}
            </button>
          ) : (
            <div key={label} className="kpi-cell">
              {inner}
            </div>
          );
        })}
      </div>

      <div className="insight-grid">
        <section className="card insight-card">
          <div className="section-head">
            <div>
              <h2>Cobros de la semana</h2>
              <p>Importes confirmados por día</p>
            </div>
            <span className="date-chip">
              <CalendarDays size={15} /> Últimos 7 días
            </span>
          </div>
          <div className="chart-summary">
            <Banknote size={17} aria-hidden="true" />
            <strong>
              {formatMxn(
                selectedDayIdx !== null
                  ? days[selectedDayIdx].total
                  : days.reduce((sum, day) => sum + day.total, 0),
              )}
            </strong>
            <span>
              {selectedDayIdx !== null
                ? `MXN · ${dayLabel.format(days[selectedDayIdx].date)}`
                : 'MXN · 7 días (toca un día para ver detalle)'}
            </span>
          </div>
          <div className="histogram" aria-label="Importes por día">
            {days.map((day, index) => {
              const isSelected = selectedDayIdx === index;
              return (
                <button
                  type="button"
                  key={day.date.toISOString()}
                  className={`chart-column chart-column-btn${isSelected ? ' selected' : ''}`}
                  aria-pressed={isSelected}
                  title={dayLabel.format(day.date) + ' · ' + formatMxn(day.total)}
                  onClick={() => setSelectedDayIdx((prev) => (prev === index ? null : index))}
                >
                  <div className="bar-track">
                    <div
                      className={'bar-fill' + (index === 6 ? ' current' : '') + (isSelected ? ' selected' : '')}
                      style={{ height: Math.max(day.total ? 6 : 2, (day.total / max) * 100) + '%' }}
                    />
                  </div>
                  <span>{weekday.format(day.date).replace('.', '')}</span>
                  <span className="sr-only">{formatMxn(day.total)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card insight-card">
          <div className="section-head">
            <div>
              <h2>Encargos por etapa</h2>
              <p>Órdenes activas de {branch.name}</p>
            </div>
            <WashingMachine size={20} aria-hidden="true" />
          </div>
          <div className="stage-list">
            {ENCARGO_STAGES.filter((stage) => stage.id !== 'entregado').map((stage) => (
              <button
                type="button"
                key={stage.id}
                className="stage-row"
                onClick={() => onOrders(stage.id)}
              >
                <span className={'stage-dot ' + stage.id} />
                <span>{stage.label}</span>
                <strong>{orders.filter((order) => order.encargoStage === stage.id).length}</strong>
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="card insight-card">
        <div className="section-head">
          <div>
            <h2>Órdenes recientes</h2>
            <p>Últimos movimientos de {branch.name}</p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOrders()}>
            Ver órdenes <ArrowRight size={15} />
          </button>
        </div>
        {orders.length === 0 ? (
          <p className="empty-section">Aún no hay órdenes en esta sucursal.</p>
        ) : (
          <div className="recent-list">
            {orders.slice(0, 5).map((order) => {
              const balance = getOrderPendingCents(state, order.id);
              const stage =
                ENCARGO_STAGES.find((item) => item.id === order.encargoStage)?.label ?? 'Autoservicio';
              return (
                <button
                  type="button"
                  key={order.id}
                  className="recent-row"
                  onClick={() => onOrders('todas', order.folio)}
                >
                  <span className="recent-icon">
                    <ScrollText size={16} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{order.folio}</strong>
                    <small>{order.customerAlias}</small>
                  </span>
                  <span className="recent-stage">{stage}</span>
                  <span>
                    <strong>{formatMxn(order.totalCents)}</strong>
                    <small>{balance ? formatMxn(balance) + ' pendientes' : 'Pagado'}</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
