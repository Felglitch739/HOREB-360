import { useLayoutEffect, useRef, useState } from 'react';
import { formatMxn } from '../domain/money';
import {
  getBranchCatalog,
  getBranchInfo,
  getBranchMachines,
  getCustomers,
  getOpenShift,
  getOrderPendingCents,
  suggestNextFolio,
  type CreateOrderInput,
  type PaymentInputLine,
} from '../domain/rules';
import type { BranchId, Customer, DemoState, Order } from '../domain/types';
import { CheckoutPanel } from './CheckoutPanel';
import { OrderList } from './OrderList';

interface MostradorViewProps {
  state: DemoState;
  branchId: BranchId;
  ordersOnly: boolean;
  isOffline?: boolean;
  initialFilter: string;
  initialQuery: string;
  onCreateOrder: (input: CreateOrderInput) => Promise<{ ok: boolean; error?: string; order?: Order }>;
  onCapturePayment: (orderId: string, lines: PaymentInputLine[]) => Promise<{ ok: boolean; error?: string; order?: Order }>;
  onConfirmPaymentLine: (lineId: string, reference?: string) => Promise<{ ok: boolean; error?: string }>;
  onAdvanceEncargo: (orderId: string, machineIds?: string[]) => Promise<{ ok: boolean; error?: string }>;
  onDeliverEncargo: (orderId: string) => Promise<{ ok: boolean; error?: string }>;
  onRecordWhatsappSent: (orderId: string) => Promise<{ ok: boolean; error?: string }>;
  onUpsertCustomer: (
    branchId: BranchId,
    customer: { id?: string; name: string; phone: string; contactConsent: boolean },
  ) => Promise<{ ok: boolean; error?: string; customer?: Customer }>;
  onOpenTicket: (orderId: string) => void;
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase('es-MX').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function MostradorView({
  state,
  branchId,
  ordersOnly,
  isOffline = false,
  initialFilter,
  initialQuery,
  onCreateOrder,
  onCapturePayment,
  onConfirmPaymentLine,
  onAdvanceEncargo,
  onDeliverEncargo,
  onRecordWhatsappSent,
  onUpsertCustomer,
  onOpenTicket,
}: MostradorViewProps) {
  const branch = getBranchInfo(branchId);
  const catalog = getBranchCatalog(state, branchId);
  const machines = getBranchMachines(state, branchId);
  const customers = getCustomers(state);
  const openShift = Boolean(getOpenShift(state, branchId));

  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState(initialFilter);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [flightNonce, setFlightNonce] = useState(0);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string; orderId?: string } | null>(null);
  const pendingFlightRef = useRef<{
    key: number;
    orderId: string;
    folio: string;
    totalText: string;
    fromRect: DOMRect;
    sourceCard?: HTMLElement | null;
  } | null>(null);
  const activeGhostRef = useRef<HTMLDivElement | null>(null);

  const checkoutOrder = state.orders.find((order) => order.id === checkoutId) ?? null;

  useLayoutEffect(() => {
    activeGhostRef.current?.remove();
    activeGhostRef.current = null;

    if (!checkoutOrder) return;
    const targetEl = document.getElementById('checkout-form');
    if (!targetEl) return;

    const reducedMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const targetRect = targetEl.getBoundingClientRect();

    if (targetRect.top < 12 || targetRect.top > window.innerHeight * 0.55) {
      targetEl.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    }

    const pending = pendingFlightRef.current;
    if (!pending || pending.orderId !== checkoutOrder.id) return;

    // Clear only after paint starts so React StrictMode's synchronous double-invoke does not drop the flight.
    const clearTimer = requestAnimationFrame(() => {
      if (pendingFlightRef.current?.key === pending.key) {
        pendingFlightRef.current = null;
      }
    });

    if (typeof targetEl.animate !== 'function') {
      return () => cancelAnimationFrame(clearTimer);
    }

    const cleanups: Array<() => void> = [() => cancelAnimationFrame(clearTimer)];

    const halo = document.createElement('div');
    halo.className = 'checkout-receive-halo';
    halo.setAttribute('aria-hidden', 'true');
    targetEl.appendChild(halo);
    const haloAnim = halo.animate(
      reducedMotion
        ? [{ opacity: 0.85 }, { opacity: 0 }]
        : [
            { opacity: 0.92, transform: 'scale(0.988)' },
            { opacity: 0, transform: 'scale(1.015)' },
          ],
      { duration: reducedMotion ? 220 : 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    );
    haloAnim.finished.catch(() => {}).finally(() => halo.remove());
    cleanups.push(() => {
      haloAnim.cancel();
      halo.remove();
    });

    if (!reducedMotion) {
      if (pending.sourceCard && typeof pending.sourceCard.animate === 'function') {
        const cardAnim = pending.sourceCard.animate(
          [
            { transform: 'scale(0.985)' },
            { transform: 'scale(1)' },
          ],
          { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
        cleanups.push(() => cardAnim.cancel());
      }

      const panelAnim = targetEl.animate(
        [
          { opacity: 0.72, transform: 'translate3d(24px, 0, 0) scale(0.985)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
        ],
        { duration: 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
      cleanups.push(() => panelAnim.cancel());

      const startX = pending.fromRect.left;
      const startY = pending.fromRect.top;
      const badgeEl = targetEl.querySelector('.card-title .badge') as HTMLElement | null;
      const destRect = badgeEl?.getBoundingClientRect() ?? targetRect;
      const endX = badgeEl ? destRect.left : targetRect.left + 20;
      const endY = Math.max(14, badgeEl ? destRect.top : targetRect.top + 18);

      const ghost = document.createElement('div');
      ghost.className = 'checkout-flight-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      const folioSpan = document.createElement('strong');
      folioSpan.textContent = pending.folio;
      const amountSpan = document.createElement('span');
      amountSpan.textContent = `${pending.totalText} → Cobrar`;
      ghost.append(folioSpan, amountSpan);
      document.body.appendChild(ghost);
      activeGhostRef.current = ghost;

      const midX = (startX + endX) / 2;
      const midY = Math.min(startY, endY) - 18;
      const flightAnim = ghost.animate(
        [
          {
            opacity: 0.96,
            transform: `translate3d(${startX}px, ${startY}px, 0) scale(0.96)`,
          },
          {
            opacity: 1,
            transform: `translate3d(${midX}px, ${midY}px, 0) scale(1.06)`,
            offset: 0.45,
          },
          {
            opacity: 0,
            transform: `translate3d(${endX}px, ${endY}px, 0) scale(0.92)`,
          },
        ],
        { duration: 340, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' },
      );

      flightAnim.finished
        .catch(() => {})
        .finally(() => {
          if (activeGhostRef.current === ghost) activeGhostRef.current = null;
          ghost.remove();
        });

      cleanups.push(() => {
        flightAnim.cancel();
        if (activeGhostRef.current === ghost) activeGhostRef.current = null;
        ghost.remove();
      });
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [checkoutOrder?.id, flightNonce]);
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

  async function handleConfirmPaymentLine(lineId: string, reference?: string) {
    const result = await onConfirmPaymentLine(lineId, reference);
    if (!result.ok && result.error) setFeedback({ type: 'error', text: result.error });
  }

  async function handleAdvanceEncargo(orderId: string, machineIds?: string[]) {
    const result = await onAdvanceEncargo(orderId, machineIds);
    if (!result.ok && result.error) setFeedback({ type: 'error', text: result.error });
  }

  async function handleDeliverEncargo(orderId: string) {
    const result = await onDeliverEncargo(orderId);
    if (!result.ok && result.error) setFeedback({ type: 'error', text: result.error });
  }

  async function handleRecordWhatsappSent(orderId: string) {
    const result = await onRecordWhatsappSent(orderId);
    if (!result.ok && result.error) setFeedback({ type: 'error', text: result.error });
  }

  return (
    <div className={ordersOnly && !checkoutOrder ? 'orders-page' : 'two-col'}>
      {(!ordersOnly || checkoutOrder) && (
        <CheckoutPanel
          branchId={branchId}
          branchName={branch.name}
          catalog={catalog}
          machines={machines}
          customers={customers}
          openShift={openShift}
          isOffline={isOffline}
          suggestedFolio={suggestedFolio}
          checkoutOrder={checkoutOrder}
          feedback={feedback}
          onFeedback={setFeedback}
          onCancelCheckout={() => setCheckoutId(null)}
          onCreateOrder={(input) => onCreateOrder({ ...input, branchId })}
          onCapturePayment={onCapturePayment}
          onUpsertCustomer={onUpsertCustomer}
          onOpenTicket={onOpenTicket}
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
        activeCheckoutId={checkoutId}
        feedback={feedback}
        showFeedback={ordersOnly && !checkoutOrder}
        onStartCheckout={(order, sourceElement) => {
          const fromRect = sourceElement?.getBoundingClientRect();
          const sourceCard = sourceElement?.closest<HTMLElement>('.order-card') ?? null;
          const nextNonce = flightNonce + 1;
          pendingFlightRef.current =
            fromRect && fromRect.width > 0 && fromRect.height > 0
              ? {
                  key: nextNonce,
                  orderId: order.id,
                  folio: order.folio,
                  totalText: formatMxn(order.totalCents),
                  fromRect,
                  sourceCard,
                }
              : null;
          setFlightNonce(nextNonce);
          setCheckoutId(order.id);
          setFeedback(null);
        }}
        onConfirmPaymentLine={handleConfirmPaymentLine}
        onOpenTicket={onOpenTicket}
        onAdvanceEncargo={handleAdvanceEncargo}
        onDeliverEncargo={handleDeliverEncargo}
        onRecordWhatsappSent={handleRecordWhatsappSent}
      />
    </div>
  );
}
