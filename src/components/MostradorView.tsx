import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  getBranchCatalog,
  getBranchDisplayName,
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
  ordersDrawerOpen?: boolean;
  onOrdersDrawerOpenChange?: (open: boolean) => void;
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
  ordersDrawerOpen = false,
  onOrdersDrawerOpenChange,
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
  const branchName = getBranchDisplayName(state, branchId);
  const catalog = getBranchCatalog(state, branchId);
  const machines = getBranchMachines(state, branchId);
  const customers = getCustomers(state);
  const openShift = Boolean(getOpenShift(state, branchId));

  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState(initialFilter);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string; orderId?: string } | null>(null);
  const checkoutOrigin = useRef<HTMLButtonElement | null>(null);
  const checkoutSourceRect = useRef<DOMRect | undefined>(undefined);
  const checkoutCue = useRef<Animation | null>(null);
  const checkoutOrder = state.orders.find((order) => order.id === checkoutId) ?? null;

  useEffect(() => {
    setQuery(initialQuery);
    setFilter(initialFilter);
  }, [branchId, initialQuery, initialFilter]);

  useEffect(() => {
    if (ordersOnly || !ordersDrawerOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onOrdersDrawerOpenChange?.(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ordersOnly, ordersDrawerOpen, onOrdersDrawerOpenChange]);

  useLayoutEffect(() => {
    if (!checkoutOrder) return;
    const { target, inView } = revealCheckout();
    const source = checkoutSourceRect.current;
    if (!target || !source || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const destination = target.getBoundingClientRect();
    const sourceCenter = source.top + source.height / 2;
    const bothVisible = inView && sourceCenter > 0 && sourceCenter < window.innerHeight;
    if (!bothVisible || destination.right >= source.left || typeof target.animate !== 'function') return;

    const preview = target.cloneNode(true) as HTMLElement;
    preview.removeAttribute('id');
    preview.classList.add('checkout-flight-ghost');
    preview.setAttribute('aria-hidden', 'true');
    preview.inert = true;
    preview.style.width = `${destination.width}px`;
    document.body.appendChild(preview);

    const flight = preview.animate(
      [
        {
          transform: `translate3d(${source.left}px, ${source.top}px, 0) scale(${source.width / destination.width}, ${source.height / destination.height})`,
          opacity: 1,
        },
        { transform: `translate3d(${destination.left}px, ${destination.top}px, 0)`, opacity: 1, offset: 0.88 },
        { transform: `translate3d(${destination.left}px, ${destination.top}px, 0)`, opacity: 0 },
      ],
      { duration: 430, easing: 'cubic-bezier(0.25, 0.65, 0.3, 1)', fill: 'both' },
    );
    const arrival = target.animate(
      [{ opacity: 0 }, { opacity: 0, offset: 0.82 }, { opacity: 1 }],
      { duration: 430 },
    );
    void flight.finished.then(() => preview.remove(), () => preview.remove());

    return () => {
      flight.cancel();
      arrival.cancel();
      preview.remove();
    };
  }, [checkoutOrder?.id]);

  function revealCheckout() {
    const heading = document.getElementById('checkout-heading');
    const target = document.querySelector<HTMLElement>('#checkout-form .checkout-active-order');
    const bounds = target?.getBoundingClientRect();
    const headingTop = heading?.getBoundingClientRect().top;
    const inView = Boolean(bounds && headingTop !== undefined && headingTop >= 0 && bounds.bottom <= window.innerHeight);
    heading?.focus({ preventScroll: true });

    checkoutCue.current?.cancel();
    const highlight = { boxShadow: 'inset 0 0 0 2px var(--primary)' };
    checkoutCue.current = target?.animate?.([highlight, highlight], { duration: 950 }) ?? null;

    if (heading && !inView) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      heading.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'instant' : 'smooth' });
    }

    return { target, inView };
  }

  function closeCheckout(restoreFocus = false) {
    checkoutCue.current?.cancel();
    setCheckoutId(null);
    if (!restoreFocus) return;
    const origin = checkoutOrigin.current;
    requestAnimationFrame(() => {
      if (checkoutOrigin.current !== origin) return;
      if (origin?.isConnected && !origin.disabled) {
        origin.focus();
      } else if (document.activeElement === document.body) {
        document.querySelector<HTMLElement>('[aria-label="Órdenes registradas"] input')?.focus();
      }
    });
  }

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

  function handleStartCheckout(order: Order, sourceElement?: HTMLElement | null) {
    if (!ordersOnly) {
      onOrdersDrawerOpenChange?.(false);
    }
    if (order.id === checkoutId) {
      revealCheckout();
      return;
    }
    checkoutOrigin.current = sourceElement instanceof HTMLButtonElement ? sourceElement : null;
    checkoutSourceRect.current = sourceElement?.closest('.order-summary-row')?.getBoundingClientRect();
    setCheckoutId(order.id);
    setFeedback(null);
  }

  const orderListProps = {
    state,
    branchId,
    branchOrdersCount: branchOrders.length,
    matchingOrders,
    ordersOnly,
    query,
    filter,
    onQueryChange: setQuery,
    onFilterChange: setFilter,
    hasOpenShift: openShift,
    activeCheckoutId: checkoutId,
    feedback,
    showFeedback: ordersOnly && !checkoutOrder,
    onStartCheckout: handleStartCheckout,
    onConfirmPaymentLine: handleConfirmPaymentLine,
    onOpenTicket,
    onAdvanceEncargo: handleAdvanceEncargo,
    onDeliverEncargo: handleDeliverEncargo,
    onRecordWhatsappSent: handleRecordWhatsappSent,
  };

  const checkoutPendingCents = checkoutOrder ? getOrderPendingCents(state, checkoutOrder.id) : 0;

  if (!ordersOnly) {
    return (
      <div className="mostrador-stage">
        <CheckoutPanel
          branchId={branchId}
          branchName={branchName}
          catalog={catalog}
          machines={machines}
          customers={customers}
          openShift={openShift}
          isOffline={isOffline}
          suggestedFolio={suggestedFolio}
          checkoutOrder={checkoutOrder}
          checkoutPendingCents={checkoutPendingCents}
          feedback={feedback}
          onFeedback={setFeedback}
          onCancelCheckout={closeCheckout}
          onCreateOrder={(input) => onCreateOrder({ ...input, branchId })}
          onCapturePayment={onCapturePayment}
          onUpsertCustomer={onUpsertCustomer}
          onOpenTicket={onOpenTicket}
        />

        {ordersDrawerOpen && (
          <div
            className="orders-drawer-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                onOrdersDrawerOpenChange?.(false);
              }
            }}
          >
            <aside
              id="mostrador-orders-drawer"
              className="orders-drawer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="orders-drawer-title"
            >
              <div className="orders-drawer-head">
                <div className="orders-drawer-title-group">
                  <h2 id="orders-drawer-title">Órdenes de la sucursal</h2>
                  <span className="badge badge-info">
                    {matchingOrders.length} de {branchOrders.length}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm orders-drawer-close"
                  aria-label="Cerrar panel de órdenes"
                  onClick={() => onOrdersDrawerOpenChange?.(false)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="orders-drawer-body">
                <OrderList {...orderListProps} embedded />
              </div>
            </aside>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={!checkoutOrder ? 'orders-page' : 'two-col'}>
      {checkoutOrder && (
        <CheckoutPanel
          branchId={branchId}
          branchName={branchName}
          catalog={catalog}
          machines={machines}
          customers={customers}
          openShift={openShift}
          isOffline={isOffline}
          suggestedFolio={suggestedFolio}
          checkoutOrder={checkoutOrder}
          checkoutPendingCents={checkoutPendingCents}
          feedback={feedback}
          onFeedback={setFeedback}
          onCancelCheckout={closeCheckout}
          onCreateOrder={(input) => onCreateOrder({ ...input, branchId })}
          onCapturePayment={onCapturePayment}
          onUpsertCustomer={onUpsertCustomer}
          onOpenTicket={onOpenTicket}
        />
      )}

      <OrderList {...orderListProps} />
    </div>
  );
}
