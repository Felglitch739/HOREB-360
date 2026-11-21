import { useState } from 'react';
import {
  ArrowRight,
  Columns3,
  FileSpreadsheet,
  List,
  PackageCheck,
  Receipt,
  Search,
  X,
} from 'lucide-react';
import { exportOrdersToExcel } from '../domain/excelExport';
import { formatMxn } from '../domain/money';
import {
  ENCARGO_STAGES,
  canDeliverOrder,
  getBranchMachines,
  getOrderPaymentLines,
  getOrderPendingCents,
} from '../domain/rules';
import type { BranchId, DemoState, EncargoStage, Order } from '../domain/types';
import { CustomSelect } from './CustomSelect';
import { OrderCard } from './OrderCard';

type DateRangeFilter = 'todas' | 'hoy' | 'ayer' | '7dias';
type ViewMode = 'lista' | 'kanban';

const KANBAN_STAGES: Array<{ id: EncargoStage; label: string; nextLabel?: string }> = [
  { id: 'recibido', label: 'Recibido', nextLabel: 'Iniciar lavado' },
  { id: 'lavado', label: 'Lavado', nextLabel: 'Pasar a secado' },
  { id: 'secado', label: 'Secado', nextLabel: 'Marcar listo' },
  { id: 'listo', label: 'Listo' },
];

function matchesDateRange(isoDate: string, range: DateRangeFilter): boolean {
  if (range === 'todas') return true;
  const created = new Date(isoDate);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === 'hoy') {
    return created >= startOfToday;
  }
  if (range === 'ayer') {
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    return created >= startOfYesterday && created < startOfToday;
  }
  // 7dias
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  return created >= startOfWeek;
}

interface OrderListProps {
  state: DemoState;
  branchId: BranchId;
  branchOrdersCount: number;
  matchingOrders: Order[];
  ordersOnly: boolean;
  embedded?: boolean;
  query: string;
  filter: string;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: string) => void;
  hasOpenShift: boolean;
  activeCheckoutId?: string | null;
  feedback: { type: 'error' | 'success'; text: string } | null;
  showFeedback: boolean;
  onStartCheckout: (order: Order, sourceElement?: HTMLElement | null) => void;
  onConfirmPaymentLine: (lineId: string, reference?: string) => Promise<void>;
  onOpenTicket: (orderId: string) => void;
  onAdvanceEncargo: (orderId: string, machineIds?: string[]) => Promise<void>;
  onDeliverEncargo: (orderId: string) => Promise<void>;
  onRecordWhatsappSent: (orderId: string) => Promise<void>;
}

export function OrderList({
  state,
  branchId,
  branchOrdersCount,
  matchingOrders,
  ordersOnly,
  embedded = false,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  hasOpenShift,
  activeCheckoutId = null,
  feedback,
  showFeedback,
  onStartCheckout,
  onConfirmPaymentLine,
  onOpenTicket,
  onAdvanceEncargo,
  onDeliverEncargo,
  onRecordWhatsappSent,
}: OrderListProps) {
  const [dateRange, setDateRange] = useState<DateRangeFilter>('todas');
  const [viewMode, setViewMode] = useState<ViewMode>('lista');
  const [busyKanbanId, setBusyKanbanId] = useState<string | null>(null);

  const filterOptions = [
    { value: 'todas', label: 'Todas las órdenes' },
    { value: 'pendientes', label: 'Por cobrar' },
    { value: 'autoservicio', label: 'Autoservicio' },
    ...ENCARGO_STAGES.map((stage) => ({ value: stage.id, label: stage.label })),
  ];

  const visibleOrders = matchingOrders.filter((order) => matchesDateRange(order.createdAt, dateRange));
  const showKanban = ordersOnly && !embedded && viewMode === 'kanban';
  const kanbanEncargos = visibleOrders.filter(
    (o) => o.serviceType === 'encargo' && o.encargoStage && o.encargoStage !== 'entregado',
  );
  const nonKanbanCount = visibleOrders.length - kanbanEncargos.length;

  async function runKanbanAction(key: string, fn: () => Promise<void>) {
    if (busyKanbanId) return;
    setBusyKanbanId(key);
    try {
      await fn();
    } finally {
      setBusyKanbanId(null);
    }
  }

  const content = (
    <>
      {!embedded && (
        <h2 className="card-title">
          <span className="card-title-main">
            <span>{ordersOnly ? 'Seguimiento' : 'Órdenes de la sucursal'}</span>
            <span className="badge badge-info">
              {visibleOrders.length} de {branchOrdersCount}
            </span>
          </span>
          <div className="card-title-actions">
            {ordersOnly && (
              <div className="view-toggle-group" role="group" aria-label="Modo de vista">
                <button
                  type="button"
                  className={`view-toggle-btn${viewMode === 'lista' ? ' active' : ''}`}
                  aria-pressed={viewMode === 'lista'}
                  onClick={() => setViewMode('lista')}
                >
                  <List size={15} aria-hidden="true" />
                  <span>Lista</span>
                </button>
                <button
                  type="button"
                  className={`view-toggle-btn${viewMode === 'kanban' ? ' active' : ''}`}
                  aria-pressed={viewMode === 'kanban'}
                  onClick={() => setViewMode('kanban')}
                >
                  <Columns3 size={15} aria-hidden="true" />
                  <span>Kanban</span>
                </button>
              </div>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={visibleOrders.length === 0}
              onClick={() => exportOrdersToExcel(state, visibleOrders, branchId)}
            >
              <FileSpreadsheet size={15} aria-hidden="true" />
              <span>Excel</span>
            </button>
          </div>
        </h2>
      )}

      <div className="order-toolbar">
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Buscar por folio o cliente</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar por folio o cliente"
          />
          {query && (
            <button
              type="button"
              className="search-clear-btn"
              aria-label="Limpiar búsqueda"
              onClick={() => onQueryChange('')}
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </label>
        <CustomSelect
          ariaLabel="Filtrar órdenes"
          value={filter}
          options={filterOptions}
          onChange={onFilterChange}
        />
      </div>

      <div className="filter-pills-bar" role="group" aria-label="Filtrar por fecha">
        {(
          [
            { id: 'todas', label: 'Todas las fechas' },
            { id: 'hoy', label: 'Hoy' },
            { id: 'ayer', label: 'Ayer' },
            { id: '7dias', label: 'Últimos 7 días' },
          ] as const
        ).map((pill) => (
          <button
            key={pill.id}
            type="button"
            className={`filter-pill${dateRange === pill.id ? ' active' : ''}`}
            aria-pressed={dateRange === pill.id}
            onClick={() => setDateRange(pill.id)}
          >
            {pill.label}
          </button>
        ))}
        {embedded && (
          <button
            type="button"
            className="filter-pill filter-pill-action"
            disabled={visibleOrders.length === 0}
            onClick={() => exportOrdersToExcel(state, visibleOrders, branchId)}
          >
            <FileSpreadsheet size={13} aria-hidden="true" />
            Excel
          </button>
        )}
      </div>

      {showFeedback && feedback && (
        <div
          className={`alert alert-${feedback.type}`}
          role={feedback.type === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      )}

      {visibleOrders.length === 0 ? (
        <p className="muted">
          {branchOrdersCount
            ? 'No hay órdenes que coincidan con el filtro seleccionado.'
            : 'Aún no hay órdenes en esta sucursal.'}
        </p>
      ) : showKanban ? (
        <>
          <div className="kanban-board" role="region" aria-label="Tablero de encargos por etapa">
            {KANBAN_STAGES.map((stage) => {
              const stageOrders = kanbanEncargos.filter((o) => o.encargoStage === stage.id);
              return (
                <div key={stage.id} className="kanban-column">
                  <div className="kanban-column-head">
                    <span className="kanban-column-title">
                      <span className={`stage-dot ${stage.id}`} aria-hidden="true" />
                      <strong>{stage.label}</strong>
                    </span>
                    <span className="badge badge-info">{stageOrders.length}</span>
                  </div>
                  <div className="kanban-column-body">
                    {stageOrders.length === 0 ? (
                      <p className="kanban-empty">Sin encargos</p>
                    ) : (
                      stageOrders.map((order) => {
                        const pendingCents = getOrderPendingCents(state, order.id);
                        const paymentLines = getOrderPaymentLines(state, order.id);
                        const deliverCheck = canDeliverOrder(state, order.id);
                        const activeCheckout = activeCheckoutId === order.id;
                        const timeStr = new Date(order.createdAt).toLocaleTimeString('es-MX', {
                          hour: '2-digit',
                          minute: '2-digit',
                        });

                        return (
                          <article
                            key={order.id}
                            className={`kanban-card${activeCheckout ? ' charging' : ''}`}
                          >
                            <div className="kanban-card-top">
                              <strong className="order-folio">{order.folio}</strong>
                              <strong className="order-total">{formatMxn(order.totalCents)}</strong>
                            </div>
                            <div className="kanban-card-meta">
                              <span className="order-client">{order.customerAlias}</span>
                              <span className="muted">· {timeStr}</span>
                            </div>
                            {pendingCents > 0 && (
                              <span className="badge badge-warning">Pendiente {formatMxn(pendingCents)}</span>
                            )}
                            {order.assignedMachineLabels && order.assignedMachineLabels.length > 0 && (
                              <div className="kanban-machines">
                                {order.assignedMachineLabels.map((lbl) => (
                                  <span key={lbl} className="badge badge-info">{lbl}</span>
                                ))}
                              </div>
                            )}
                            <div className="kanban-card-actions">
                              {paymentLines.length === 0 && order.totalCents > 0 && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={!hasOpenShift && !activeCheckout}
                                  onClick={(event) => onStartCheckout(order, event.currentTarget)}
                                >
                                  {activeCheckout ? 'En cobro' : 'Cobrar'}
                                </button>
                              )}
                              {stage.nextLabel && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={busyKanbanId !== null}
                                  onClick={() =>
                                    void runKanbanAction(`adv-${order.id}`, () => onAdvanceEncargo(order.id))
                                  }
                                >
                                  {stage.nextLabel}
                                  <ArrowRight size={13} aria-hidden="true" />
                                </button>
                              )}
                              {deliverCheck.allowed && (
                                <button
                                  type="button"
                                  className="btn btn-success btn-sm"
                                  disabled={busyKanbanId !== null}
                                  onClick={() =>
                                    void runKanbanAction(`del-${order.id}`, () => onDeliverEncargo(order.id))
                                  }
                                >
                                  <PackageCheck size={14} aria-hidden="true" />
                                  Entregar
                                </button>
                              )}
                              {pendingCents === 0 && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  aria-label={`Ticket ${order.folio}`}
                                  onClick={() => onOpenTicket(order.id)}
                                >
                                  <Receipt size={14} aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {nonKanbanCount > 0 && (
            <div className="kanban-footnote">
              <span>
                Hay <strong>{nonKanbanCount}</strong> orden(es) de autoservicio o ya entregadas.
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setViewMode('lista')}
              >
                Ver todas en Lista
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="order-list">
          {visibleOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              branchMachines={getBranchMachines(state, order.branchId)}
              paymentLines={getOrderPaymentLines(state, order.id)}
              ticket={state.tickets[order.id]}
              pendingCents={getOrderPendingCents(state, order.id)}
              deliverCheck={canDeliverOrder(state, order.id)}
              hasOpenShift={hasOpenShift}
              activeCheckout={activeCheckoutId === order.id}
              onStartCheckout={onStartCheckout}
              onConfirmPaymentLine={onConfirmPaymentLine}
              onOpenTicket={onOpenTicket}
              onAdvanceEncargo={onAdvanceEncargo}
              onDeliverEncargo={onDeliverEncargo}
              onRecordWhatsappSent={onRecordWhatsappSent}
            />
          ))}
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="orders-embedded-body" aria-label="Órdenes registradas">
        {content}
      </div>
    );
  }

  return (
    <section className="card" aria-label="Órdenes registradas" data-tour="orders-panel">
      {content}
    </section>
  );
}
