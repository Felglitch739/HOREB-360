import { useState } from 'react';
import { ArrowRight, Banknote, CalendarDays, Plus, ScrollText, Wallet, WashingMachine } from 'lucide-react';
import { formatMxn, formatMxnCurrency } from '../domain/money';
import {
  ENCARGO_STAGES,
  buildDailyRevenueTrend,
  getBranchDisplayName,
  getBranchSummary,
  getOpenShift,
  getOrderPendingCents,
} from '../domain/rules';
import type { BranchId, DemoState } from '../domain/types';

const weekday = new Intl.DateTimeFormat('es-MX', { weekday: 'short' });
const dayLabel = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' });

interface Props {
  state: DemoState;
  branchId: BranchId;
  onNew: () => void;
  onOrders: (filter?: string, query?: string) => void;
  onOpenCaja?: () => void;
}

export function Overview({ state, branchId, onNew, onOrders, onOpenCaja }: Props) {
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);
  const branchName = getBranchDisplayName(state, branchId);
  const openShift = getOpenShift(state, branchId);
  const summary = getBranchSummary(state, branchId);
  const orders = state.orders.filter((order) => order.branchId === branchId);
  const ready = orders.filter((order) => order.encargoStage === 'listo').length;
  const today = new Date();
  const ids = new Set(orders.map((order) => order.id));

  const trend = buildDailyRevenueTrend(state, ids, 7, today);
  const days = trend.days;
  const max = Math.max(1, ...days.map((day) => day.totalCents));
  const rangeLabel = `${shortDate.format(trend.startDate)} – ${shortDate.format(trend.endDate)}`;

  const kpis = [
    { label: 'Cobrado', value: formatMxnCurrency(summary.totalConfirmedCents), note: 'Pagos confirmados', filter: undefined },
    { label: 'Por cobrar', value: formatMxnCurrency(summary.pendingCents), note: 'Ver saldos pendientes', filter: 'pendientes', warn: summary.pendingCents > 0 },
    { label: 'Listos para entregar', value: String(ready), note: 'Ver encargos listos', filter: 'listo' },
    { label: 'Órdenes en sucursal', value: String(orders.length), note: 'Ir al listado', filter: 'todas' },
  ];

  return (
    <div className="dashboard">
      <div className="page-intro">
        <div>
          <h1>Resumen · {branchName}</h1>
          <p style={{ textTransform: 'capitalize' }}>{dayLabel.format(today)}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onNew}>
          <Plus size={17} /> Nueva orden
        </button>
      </div>

      {!openShift && (
        <div className="alert alert-error offline-sync-bar" role="status">
          <span>
            <strong>Caja cerrada en {branchName}.</strong> Abre un turno para registrar ventas y confirmar cobros.
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
              <p>Importes confirmados por día ({rangeLabel})</p>
            </div>
            <span className="date-chip">
              <CalendarDays size={15} /> {trend.anchoredToHistory ? 'Últimos 7 días activos' : 'Últimos 7 días'}
            </span>
          </div>
          <div className="chart-summary">
            <Banknote size={17} aria-hidden="true" />
            <strong>
              {formatMxnCurrency(
                selectedDayIdx !== null
                  ? days[selectedDayIdx].totalCents
                  : trend.periodTotalCents,
              )}
            </strong>
            <span>
              {selectedDayIdx !== null
                ? dayLabel.format(days[selectedDayIdx].date)
                : trend.historicalTotalCents !== trend.periodTotalCents
                  ? `Ventana 7 días · Histórico: ${formatMxnCurrency(trend.historicalTotalCents)}`
                  : '7 días (toca un día para ver detalle)'}
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
                  title={dayLabel.format(day.date) + ' · ' + formatMxnCurrency(day.totalCents)}
                  onClick={() => setSelectedDayIdx((prev) => (prev === index ? null : index))}
                >
                  <div className="bar-track">
                    <div
                      className={'bar-fill' + (index === 6 ? ' current' : '') + (isSelected ? ' selected' : '')}
                      style={{ height: Math.max(day.totalCents ? 6 : 2, (day.totalCents / max) * 100) + '%' }}
                    />
                  </div>
                  <span>{weekday.format(day.date).replace('.', '')}</span>
                  <span className="sr-only">{formatMxn(day.totalCents)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card insight-card">
          <div className="section-head">
            <div>
              <h2>Encargos por etapa</h2>
              <p>Órdenes activas de {branchName}</p>
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
            <p>Últimos movimientos de {branchName}</p>
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
              const createdLabel = new Date(order.createdAt).toLocaleString('es-MX', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              });
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
                    <small>{order.customerAlias} · {createdLabel}</small>
                  </span>
                  <span className="recent-stage">{stage}</span>
                  <span>
                    <strong>{formatMxnCurrency(order.totalCents)}</strong>
                    <small>{balance > 0 ? formatMxnCurrency(balance) + ' pendientes' : 'Pagado'}</small>
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
