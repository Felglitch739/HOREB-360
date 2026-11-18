import { Search } from 'lucide-react';
import {
  ENCARGO_STAGES,
  canDeliverOrder,
  getOrderPaymentLines,
  getOrderPendingCents,
} from '../domain/rules';
import type { DemoState, Order } from '../domain/types';
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
  onConfirmPaymentLine: (lineId: string) => Promise<void>;
  onOpenTicket: (orderId: string) => void;
  onAdvanceEncargo: (orderId: string) => Promise<void>;
  onDeliverEncargo: (orderId: string) => Promise<void>;
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
}: OrderListProps) {
  return (
    <section className="card" aria-label="Órdenes registradas">
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
        </label>
        <select
          className="input"
          aria-label="Filtrar órdenes"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        >
          <option value="todas">Todas las órdenes</option>
          <option value="pendientes">Por cobrar</option>
          <option value="autoservicio">Autoservicio</option>
          {ENCARGO_STAGES.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.label}
            </option>
          ))}
        </select>
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
            />
          ))}
        </div>
      )}
    </section>
  );
}
