import { useState } from 'react';
import {
  getBranchInfo,
  getBranchSettings,
  getOpenShift,
  getOrderPendingCents,
  suggestNextFolio,
  type CreateOrderInput,
  type PaymentInputLine,
} from '../domain/rules';
import type { BranchId, DemoState, Order } from '../domain/types';
import { CheckoutPanel } from './CheckoutPanel';
import { OrderList } from './OrderList';

interface MostradorViewProps {
  state: DemoState;
  branchId: BranchId;
  ordersOnly: boolean;
  initialFilter: string;
  initialQuery: string;
  onCreateOrder: (input: CreateOrderInput) => Promise<{ ok: boolean; error?: string; order?: Order }>;
  onCapturePayment: (orderId: string, lines: PaymentInputLine[]) => Promise<{ ok: boolean; error?: string; order?: Order }>;
  onConfirmPaymentLine: (lineId: string) => Promise<{ ok: boolean; error?: string }>;
  onAdvanceEncargo: (orderId: string) => Promise<{ ok: boolean; error?: string }>;
  onDeliverEncargo: (orderId: string) => Promise<{ ok: boolean; error?: string }>;
  onOpenTicket: (orderId: string) => void;
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase('es-MX').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function MostradorView({
  state,
  branchId,
  ordersOnly,
  initialFilter,
  initialQuery,
  onCreateOrder,
  onCapturePayment,
  onConfirmPaymentLine,
  onAdvanceEncargo,
  onDeliverEncargo,
  onOpenTicket,
}: MostradorViewProps) {
  const branch = getBranchInfo(branchId);
  const branchSettings = getBranchSettings(state, branchId);
  const openShift = Boolean(getOpenShift(state, branchId));

  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState(initialFilter);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const checkoutOrder = state.orders.find((order) => order.id === checkoutId) ?? null;
  const suggestedFolio = suggestNextFolio(state, branchId);

  const term = normalizeSearch(query.trim());
  const branchOrders = state.orders.filter((order) => order.branchId === branchId);
  const matchingOrders = branchOrders.filter((order) => {
    if (term && !normalizeSearch(`${order.folio} ${order.customerAlias}`).includes(term)) return false;
    if (filter === 'todas') return true;
    if (filter === 'pendientes') return getOrderPendingCents(state, order.id) > 0;
    if (filter === 'autoservicio') return order.serviceType === 'autoservicio';
    return order.encargoStage === filter;
  });

  async function handleConfirmPaymentLine(lineId: string) {
    const result = await onConfirmPaymentLine(lineId);
    if (!result.ok && result.error) setFeedback({ type: 'error', text: result.error });
  }

  async function handleAdvanceEncargo(orderId: string) {
    const result = await onAdvanceEncargo(orderId);
    if (!result.ok && result.error) setFeedback({ type: 'error', text: result.error });
  }

  async function handleDeliverEncargo(orderId: string) {
    const result = await onDeliverEncargo(orderId);
    if (!result.ok && result.error) setFeedback({ type: 'error', text: result.error });
  }

  return (
    <div className={ordersOnly && !checkoutOrder ? 'orders-page' : 'two-col'}>
      {(!ordersOnly || checkoutOrder) && (
        <CheckoutPanel
          branchName={branch.name}
          comboPriceCents={branchSettings.comboPriceCents}
          openShift={openShift}
          suggestedFolio={suggestedFolio}
          checkoutOrder={checkoutOrder}
          feedback={feedback}
          onFeedback={setFeedback}
          onCancelCheckout={() => setCheckoutId(null)}
          onCreateOrder={(input) => onCreateOrder({ ...input, branchId })}
          onCapturePayment={onCapturePayment}
        />
      )}

      <OrderList
        state={state}
        branchOrdersCount={branchOrders.length}
        matchingOrders={matchingOrders}
        ordersOnly={ordersOnly}
        query={query}
        filter={filter}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
        hasOpenShift={openShift}
        feedback={feedback}
        showFeedback={ordersOnly && !checkoutOrder}
        onStartCheckout={(order) => {
          setCheckoutId(order.id);
          setFeedback(null);
          requestAnimationFrame(() =>
            document.getElementById('checkout-form')?.scrollIntoView({ block: 'start' }),
          );
        }}
        onConfirmPaymentLine={handleConfirmPaymentLine}
        onOpenTicket={onOpenTicket}
        onAdvanceEncargo={handleAdvanceEncargo}
        onDeliverEncargo={handleDeliverEncargo}
      />
    </div>
  );
}
