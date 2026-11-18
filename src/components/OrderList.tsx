import { Search, X } from 'lucide-react';
import {
  ENCARGO_STAGES,
  canDeliverOrder,
  getBranchMachines,
  getOrderPaymentLines,
  getOrderPendingCents,
} from '../domain/rules';
import type { DemoState, Order } from '../domain/types';
import { CustomSelect } from './CustomSelect';
import { OrderCard } from './OrderCard';

interface OrderListProps {
  state: DemoState;
  branchOrdersCount: number;
  matchingOrders: Order[];
  ordersOnly: boolean;
  query: string;
  filter: string;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: string) => void;
  hasOpenShift: boolean;
  feedback: { type: 'error' | 'success'; text: string } | null;
  showFeedback: boolean;
  onStartCheckout: (order: Order) => void;
  onConfirmPaymentLine: (lineId: string, reference?: string) => Promise<void>;
  onOpenTicket: (orderId: string) => void;
  onAdvanceEncargo: (orderId: string, machineIds?: string[]) => Promise<void>;
  onDeliverEncargo: (orderId: string) => Promise<void>;
  onRecordWhatsappSent: (orderId: string) => Promise<void>;
}

export function OrderList({
  state,
  branchOrdersCount,
  matchingOrders,
  ordersOnly,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  hasOpenShift,
  feedback,
  showFeedback,
  onStartCheckout,
  onConfirmPaymentLine,
  onOpenTicket,
  onAdvanceEncargo,
  onDeliverEncargo,
  onRecordWhatsappSent,
}: OrderListProps) {
  const filterOptions = [
    { value: 'todas', label: 'Todas las órdenes' },
    { value: 'pendientes', label: 'Por cobrar' },
    { value: 'autoservicio', label: 'Autoservicio' },
    ...ENCARGO_STAGES.map((stage) => ({ value: stage.id, label: stage.label })),
  ];

  return (
    <section className="card" aria-label="Órdenes registradas" data-tour="orders-panel">
      <h2 className="card-title">
        <span>{ordersOnly ? 'Seguimiento' : 'Órdenes de la sucursal'}</span>
        <span className="badge badge-info">
          {matchingOrders.length} de {branchOrdersCount}
        </span>
      </h2>

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

      {showFeedback && feedback && (
        <div
          className={`alert alert-${feedback.type}`}
          role={feedback.type === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      )}

      {matchingOrders.length === 0 ? (
        <p className="muted">
          {branchOrdersCount
            ? 'No hay órdenes que coincidan con la búsqueda.'
            : 'Aún no hay órdenes en esta sucursal.'}
        </p>
      ) : (
        <div className="order-list">
          {matchingOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                branchMachines={getBranchMachines(state, order.branchId)}
                paymentLines={getOrderPaymentLines(state, order.id)}
                ticket={state.tickets[order.id]}
                pendingCents={getOrderPendingCents(state, order.id)}
                deliverCheck={canDeliverOrder(state, order.id)}
                hasOpenShift={hasOpenShift}
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
    </section>
  );
}
