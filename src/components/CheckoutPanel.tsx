import { useEffect, useState } from 'react';
import { ArrowLeftRight, Banknote, ChevronDown, CreditCard, Gift, Layers, Minus, Plus, Receipt, Trash2, UserPlus } from 'lucide-react';
import { calculateTender, formatMxn, formatMxnCurrency, parsePesosToCents } from '../domain/money';
import type { CreateOrderInput, PaymentInputLine } from '../domain/rules';
import type { BranchId, CatalogItem, Customer, Machine, Order, ServiceType } from '../domain/types';
import { CustomSelect } from './CustomSelect';

type PaymentMode = 'efectivo' | 'tarjeta' | 'transferencia' | 'mixto';
type EncargoPayTiming = 'defer' | 'partial' | 'full';

const QUICK_CASH_BILLS_CENTS = [5000, 10000, 20000, 50000, 100000];

function formatInputPesos(cents: number): string {
  if (cents <= 0) return '0';
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

interface CheckoutPanelProps {
  branchId: BranchId;
  branchName: string;
  catalog: CatalogItem[];
  machines: Machine[];
  customers: Customer[];
  openShift: boolean;
  isOffline?: boolean;
  suggestedFolio: string;
  checkoutOrder: Order | null;
  checkoutPendingCents?: number;
  feedback: { type: 'error' | 'success'; text: string; orderId?: string } | null;
  onFeedback: (next: { type: 'error' | 'success'; text: string; orderId?: string } | null) => void;
  onCancelCheckout: (restoreFocus?: boolean) => void;
  onCreateOrder: (
    input: Omit<CreateOrderInput, 'branchId'>,
  ) => Promise<{ ok: boolean; error?: string; order?: Order }>;
  onCapturePayment: (
    orderId: string,
    lines: PaymentInputLine[],
  ) => Promise<{ ok: boolean; error?: string; order?: Order }>;
  onUpsertCustomer: (
    branchId: BranchId,
    customer: { id?: string; name: string; phone: string; contactConsent: boolean },
  ) => Promise<{ ok: boolean; error?: string; customer?: Customer }>;
  onOpenTicket: (orderId: string) => void;
}

export function CheckoutPanel({
  branchId,
  branchName,
  catalog,
  machines,
  customers,
  openShift,
  isOffline = false,
  suggestedFolio,
  checkoutOrder,
  checkoutPendingCents,
  feedback,
  onFeedback,
  onCancelCheckout,
  onCreateOrder,
  onCapturePayment,
  onUpsertCustomer,
  onOpenTicket,
}: CheckoutPanelProps) {
  const activeCatalog = catalog.filter((item) => item.active);
  const [serviceType, setServiceType] = useState<ServiceType>('autoservicio');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustConsent, setNewCustConsent] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);

  const [customerAlias, setCustomerAlias] = useState('');
  const [catalogCategory, setCatalogCategory] = useState<'todos' | 'servicios' | 'extras'>('todos');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [redeemFreeCombo, setRedeemFreeCombo] = useState(false);
  const [selectedMachineIds, setSelectedMachineIds] = useState<string[]>([]);
  const [showMachinePicker, setShowMachinePicker] = useState(false);
  const [encargoPayTiming, setEncargoPayTiming] = useState<EncargoPayTiming>('defer');
  const [showExtraDetails, setShowExtraDetails] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [promisedDeliveryAt, setPromisedDeliveryAt] = useState('');
  const [discountInput, setDiscountInput] = useState('');
  const [orderNotes, setOrderNotes] = useState('');

  const [paymentMode, setPaymentMode] = useState<PaymentMode>('efectivo');
  const [cashInput, setCashInput] = useState('');
  const [cardInput, setCardInput] = useState('0');
  const [transferInput, setTransferInput] = useState('0');
  const [confirmCardNow, setConfirmCardNow] = useState(false);
  const [cardReference, setCardReference] = useState('');
  const [confirmTransferNow, setConfirmTransferNow] = useState(false);
  const [transferReference, setTransferReference] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null;

  const selectedItems = activeCatalog
    .map((item) => ({ item, quantity: quantities[item.id] ?? 0 }))
    .filter((entry) => entry.quantity > 0);

  const comboEntry = selectedItems.find((entry) => (entry.item.loyaltyCredits ?? 0) > 0);
  const canRedeemFreeCombo =
    Boolean(selectedCustomer && selectedCustomer.freeCombosAvailable >= 1 && comboEntry);

  const loyaltyDiscountCents =
    !checkoutOrder && redeemFreeCombo && canRedeemFreeCombo && comboEntry
      ? comboEntry.item.priceCents
      : 0;

  const subtotalBeforeManualCents = Math.max(
    0,
    selectedItems.reduce((sum, entry) => sum + entry.item.priceCents * entry.quantity, 0) -
      loyaltyDiscountCents,
  );
  const parsedDiscountCents = discountInput.trim() ? parsePesosToCents(discountInput) ?? 0 : 0;
  const manualDiscountCents = !checkoutOrder
    ? Math.min(Math.max(0, parsedDiscountCents), subtotalBeforeManualCents)
    : 0;

  const cartTotalCents = Math.max(0, subtotalBeforeManualCents - manualDiscountCents);

  const deferPayment =
    !checkoutOrder && serviceType === 'encargo' && encargoPayTiming === 'defer' && cartTotalCents > 0;
  const isPartialMode =
    !checkoutOrder && serviceType === 'encargo' && encargoPayTiming === 'partial' && cartTotalCents > 0;
  const totalCents = checkoutOrder
    ? (checkoutPendingCents ?? checkoutOrder.totalCents)
    : cartTotalCents;
  const freeCoverAll = !checkoutOrder && cartTotalCents === 0 && (loyaltyDiscountCents > 0 || manualDiscountCents > 0) && selectedItems.length > 0;
  const tender = calculateTender(totalCents, cashInput, cardInput, transferInput);
  const paidCents = tender.ok ? tender.cashApplied + tender.card + tender.transfer : 0;

  useEffect(() => {
    if (checkoutOrder) {
      setPaymentMode('efectivo');
      setCashInput('');
      setCardInput('0');
      setTransferInput('0');
      setConfirmCardNow(false);
      setCardReference('');
      setConfirmTransferNow(false);
      setTransferReference('');
    }
  }, [checkoutOrder?.id]);

  useEffect(() => {
    if (paymentMode === 'tarjeta') {
      setCardInput(totalCents > 0 ? formatInputPesos(totalCents) : '0');
    } else if (paymentMode === 'transferencia') {
      setTransferInput(totalCents > 0 ? formatInputPesos(totalCents) : '0');
    }
  }, [totalCents, paymentMode]);

  function resetPaymentInputs() {
    setPaymentMode('efectivo');
    setCashInput('');
    setCardInput('0');
    setTransferInput('0');
    setConfirmCardNow(false);
    setCardReference('');
    setConfirmTransferNow(false);
    setTransferReference('');
  }

  function selectPaymentMode(mode: PaymentMode) {
    setPaymentMode(mode);
    onFeedback(null);
    if (mode === 'efectivo') {
      setCardInput('0');
      setTransferInput('0');
      setConfirmCardNow(false);
      setConfirmTransferNow(false);
      if (cashInput === '0') setCashInput('');
    } else if (mode === 'tarjeta') {
      setCashInput('0');
      setCardInput(totalCents > 0 ? formatInputPesos(totalCents) : '0');
      setTransferInput('0');
      setConfirmTransferNow(false);
    } else if (mode === 'transferencia') {
      setCashInput('0');
      setCardInput('0');
      setTransferInput(totalCents > 0 ? formatInputPesos(totalCents) : '0');
      setConfirmCardNow(false);
    }
  }

  function updateItemQuantity(itemId: string, delta: number) {
    setQuantities((prev) => {
      const nextQty = Math.max(0, Math.min(99, (prev[itemId] ?? 0) + delta));
      return { ...prev, [itemId]: nextQty };
    });
    onFeedback(null);
  }

  const washers = machines.filter((m) => m.kind === 'lavadora');
  const availableWashersCount = washers.filter((m) => m.status === 'disponible').length;
  const needsMachine = selectedItems.some((entry) => entry.item.requiresMachine);
  const hasMachineItems = activeCatalog.some((item) => item.requiresMachine);
  const hasExtraItems = activeCatalog.some((item) => !item.requiresMachine);
  const normalizedCatSearch = catalogSearch.trim().toLowerCase();
  const visibleCatalog = activeCatalog.filter((item) => {
    if (catalogCategory === 'servicios' && !item.requiresMachine) return false;
    if (catalogCategory === 'extras' && item.requiresMachine) return false;
    if (normalizedCatSearch && !item.name.toLowerCase().includes(normalizedCatSearch)) return false;
    return true;
  });

  function toggleMachine(machineId: string) {
    setSelectedMachineIds((prev) =>
      prev.includes(machineId) ? prev.filter((id) => id !== machineId) : [...prev, machineId],
    );
  }

  const quickCashOptions =
    totalCents > 0
      ? [
          { label: 'Exacto', cents: totalCents },
          ...QUICK_CASH_BILLS_CENTS.filter((bill) => bill > totalCents)
            .slice(0, 3)
            .map((bill) => ({ label: `$${bill / 100}`, cents: bill })),
        ]
      : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    onFeedback(null);

    if (!checkoutOrder && selectedItems.length === 0) {
      onFeedback({ type: 'error', text: 'Agrega al menos un servicio o producto al carrito.' });
      return;
    }

    const paymentLines: PaymentInputLine[] = [];
    let change = 0;

    if (!deferPayment && !freeCoverAll) {
      if (!tender.ok) {
        onFeedback({ type: 'error', text: tender.error });
        return;
      }
      if (isPartialMode) {
        if (paidCents <= 0) {
          onFeedback({
            type: 'error',
            text: 'Captura un anticipo mayor a $0.00 MXN o selecciona "Cobrar al recoger".',
          });
          return;
        }
      } else if (tender.remaining > 0) {
        onFeedback({
          type: 'error',
          text: `Faltan ${formatMxn(tender.remaining)} para el total de ${formatMxn(totalCents)}.`,
        });
        return;
      }
      change = tender.change;
      if (tender.cashApplied > 0) {
        paymentLines.push({
          method: 'efectivo',
          amountCents: tender.cashApplied,
          cashReceivedCents: tender.cash,
        });
      }
      if (tender.card > 0) {
        paymentLines.push({
          method: 'tarjeta',
          amountCents: tender.card,
          confirmImmediately: confirmCardNow,
          reference: cardReference.trim() || undefined,
        });
      }
      if (tender.transfer > 0) {
        paymentLines.push({
          method: 'transferencia',
          amountCents: tender.transfer,
          confirmImmediately: confirmTransferNow,
          reference: transferReference.trim() || undefined,
        });
      }
    }

    setSubmitting(true);
    try {
      const parsedWeight = weightInput.trim() ? Number.parseFloat(weightInput) : NaN;
      const weightKg = Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : undefined;
      const allowPartialPayment = Boolean(isPartialMode && paidCents > 0 && paidCents < totalCents);

      const res = checkoutOrder
        ? await onCapturePayment(checkoutOrder.id, paymentLines)
        : await onCreateOrder({
            serviceType,
            customerAlias: customerAlias.trim() || selectedCustomer?.name,
            customerId: selectedCustomer?.id,
            redeemFreeCombo: Boolean(canRedeemFreeCombo && redeemFreeCombo),
            items: selectedItems.map(({ item, quantity }) => ({
              itemId: item.id,
              quantity,
            })),
            machineIds: needsMachine && selectedMachineIds.length > 0 ? selectedMachineIds : undefined,
            paymentLines: deferPayment || freeCoverAll ? [] : paymentLines,
            allowPartialPayment,
            weightKg,
            promisedDeliveryAt: promisedDeliveryAt.trim() || undefined,
            notes: orderNotes.trim() || undefined,
            manualDiscountCents: manualDiscountCents > 0 ? manualDiscountCents : undefined,
          });

      if (!res.ok) {
        onFeedback({ type: 'error', text: res.error ?? 'No se pudo registrar la orden.' });
        return;
      }

      const savedOrder = res.order ?? checkoutOrder;
      const savedFolio = savedOrder?.folio ?? '';
      onFeedback({
        type: 'success',
        orderId: savedOrder?.id,
        text:
          (checkoutOrder
            ? `Cobro registrado en folio ${savedFolio}.`
            : `Orden guardada · Folio ${savedFolio} (${branchName}).`) +
          (change > 0 ? ` Entrega ${formatMxn(change)} de cambio.` : ''),
      });
      if (checkoutOrder) onCancelCheckout();
      setCustomerAlias('');
      setSelectedCustomerId('');
      setRedeemFreeCombo(false);
      setQuantities({});
      setSelectedMachineIds([]);
      setWeightInput('');
      setPromisedDeliveryAt('');
      setDiscountInput('');
      setOrderNotes('');
      setShowExtraDetails(false);
      resetPaymentInputs();
    } finally {
      setSubmitting(false);
    }
  }

  const paymentSection = deferPayment ? (
    <div className="alert alert-info">
      El encargo se registrará con saldo pendiente ({formatMxn(totalCents)}) para cobrarse al entregar.
    </div>
  ) : freeCoverAll ? (
    <div className="alert alert-success">
      Orden cubierta al 100% con <strong>1 combo gratis de lealtad ($0.00)</strong>. Al completar la orden se emitirá su boleto de rifa.
    </div>
  ) : (
    <div className="pos-payment-block">
      <div className="pos-section-label">Método de pago</div>
      <div className="payment-mode-tabs" role="group" aria-label="Método de pago">
        <button
          type="button"
          className={`payment-mode-btn${paymentMode === 'efectivo' ? ' active' : ''}`}
          aria-pressed={paymentMode === 'efectivo'}
          onClick={() => selectPaymentMode('efectivo')}
        >
          <Banknote size={15} aria-hidden="true" />
          <span>Efectivo</span>
        </button>
        <button
          type="button"
          className={`payment-mode-btn${paymentMode === 'tarjeta' ? ' active' : ''}`}
          aria-pressed={paymentMode === 'tarjeta'}
          onClick={() => selectPaymentMode('tarjeta')}
        >
          <CreditCard size={15} aria-hidden="true" />
          <span>Tarjeta</span>
        </button>
        <button
          type="button"
          className={`payment-mode-btn${paymentMode === 'transferencia' ? ' active' : ''}`}
          aria-pressed={paymentMode === 'transferencia'}
          onClick={() => selectPaymentMode('transferencia')}
        >
          <ArrowLeftRight size={15} aria-hidden="true" />
          <span>Transf.</span>
        </button>
        <button
          type="button"
          className={`payment-mode-btn${paymentMode === 'mixto' ? ' active' : ''}`}
          aria-pressed={paymentMode === 'mixto'}
          onClick={() => selectPaymentMode('mixto')}
        >
          <Layers size={15} aria-hidden="true" />
          <span>Mixto</span>
        </button>
      </div>

      {paymentMode === 'efectivo' && (
        <div className="pos-single-payment">
          <div className="split-row-top">
            <label htmlFor="cash-received-input" className="pos-input-label">
              Efectivo recibido
            </label>
            <div className="split-amount-wrap">
              <span>$</span>
              <input
                id="cash-received-input"
                aria-label="Monto efectivo MXN"
                placeholder="0.00"
                inputMode="decimal"
                className="input"
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
              />
            </div>
          </div>
          {quickCashOptions.length > 0 && (
            <div className="quick-cash-chips" role="group" aria-label="Montos rápidos en efectivo">
              {quickCashOptions.map((option) => {
                const valueStr = formatInputPesos(option.cents);
                const isSelected = cashInput === valueStr;
                return (
                  <button
                    key={option.label}
                    type="button"
                    className={`quick-cash-chip${isSelected ? ' active' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setCashInput(valueStr);
                      onFeedback(null);
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {paymentMode === 'tarjeta' && (
        <div className="pos-single-payment">
          <div className="split-row-top">
            <label htmlFor="card-amount-input" className="pos-input-label">
              Tarjeta (terminal)
            </label>
            <div className="split-amount-wrap">
              <span>$</span>
              <input
                id="card-amount-input"
                aria-label="Monto tarjeta MXN"
                inputMode="decimal"
                className="input"
                value={cardInput}
                onChange={(e) => setCardInput(e.target.value)}
              />
            </div>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={confirmCardNow}
              onChange={(e) => setConfirmCardNow(e.target.checked)}
            />
            Registrar pago aprobado en terminal
          </label>
          {confirmCardNow && (
            <input
              className="input input-sm"
              aria-label="Referencia de pago en terminal"
              placeholder="Referencia / folio terminal (opcional)"
              value={cardReference}
              onChange={(e) => setCardReference(e.target.value)}
              maxLength={60}
            />
          )}
        </div>
      )}

      {paymentMode === 'transferencia' && (
        <div className="pos-single-payment">
          <div className="split-row-top">
            <label htmlFor="transfer-amount-input" className="pos-input-label">
              Transferencia
            </label>
            <div className="split-amount-wrap">
              <span>$</span>
              <input
                id="transfer-amount-input"
                aria-label="Monto transferencia MXN"
                inputMode="decimal"
                className="input"
                value={transferInput}
                onChange={(e) => setTransferInput(e.target.value)}
              />
            </div>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={confirmTransferNow}
              onChange={(e) => setConfirmTransferNow(e.target.checked)}
            />
            Marcar transferencia verificada
          </label>
          {isOffline && (
            <small className="muted" style={{ display: 'block' }}>
              Sin internet: valida manualmente en terminal o app bancaria antes de confirmar.
            </small>
          )}
          {confirmTransferNow && (
            <input
              className="input input-sm"
              aria-label="Referencia de transferencia verificada"
              placeholder="Referencia bancaria / clave rastreo (opcional)"
              value={transferReference}
              onChange={(e) => setTransferReference(e.target.value)}
              maxLength={60}
            />
          )}
        </div>
      )}

      {paymentMode === 'mixto' && (
        <div className="split-grid">
          <div className="split-row">
            <div className="split-row-top">
              <strong>Efectivo recibido</strong>
              <div className="split-amount-wrap">
                <span>$</span>
                <input
                  aria-label="Monto efectivo MXN"
                  placeholder="0.00"
                  inputMode="decimal"
                  className="input"
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="split-row">
            <div className="split-row-top">
              <strong>Tarjeta (terminal)</strong>
              <div className="split-amount-wrap">
                <span>$</span>
                <input
                  aria-label="Monto tarjeta MXN"
                  inputMode="decimal"
                  className="input"
                  value={cardInput}
                  onChange={(e) => setCardInput(e.target.value)}
                />
              </div>
            </div>
            {(tender.ok && tender.card > 0) || confirmCardNow ? (
              <>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={confirmCardNow}
                    onChange={(e) => setConfirmCardNow(e.target.checked)}
                  />
                  Registrar pago aprobado en terminal
                </label>
                {confirmCardNow && (
                  <input
                    className="input input-sm"
                    aria-label="Referencia de pago en terminal"
                    placeholder="Referencia / folio terminal (opcional)"
                    value={cardReference}
                    onChange={(e) => setCardReference(e.target.value)}
                    maxLength={60}
                  />
                )}
              </>
            ) : null}
          </div>

          <div className="split-row">
            <div className="split-row-top">
              <strong>Transferencia</strong>
              <div className="split-amount-wrap">
                <span>$</span>
                <input
                  aria-label="Monto transferencia MXN"
                  inputMode="decimal"
                  className="input"
                  value={transferInput}
                  onChange={(e) => setTransferInput(e.target.value)}
                />
              </div>
            </div>
            {(tender.ok && tender.transfer > 0) || confirmTransferNow ? (
              <>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={confirmTransferNow}
                    onChange={(e) => setConfirmTransferNow(e.target.checked)}
                  />
                  Marcar transferencia verificada
                </label>
                {isOffline && (
                  <small className="muted" style={{ display: 'block' }}>
                    Sin internet: valida manualmente en terminal o app bancaria antes de confirmar.
                  </small>
                )}
                {confirmTransferNow && (
                  <input
                    className="input input-sm"
                    aria-label="Referencia de transferencia verificada"
                    placeholder="Referencia bancaria / clave rastreo (opcional)"
                    value={transferReference}
                    onChange={(e) => setTransferReference(e.target.value)}
                    maxLength={60}
                  />
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );

  const feedbackBanner = feedback && (
    <div
      role={feedback.type === 'error' ? 'alert' : 'status'}
      className={`alert ${feedback.type === 'error' ? 'alert-error' : 'alert-success'}`}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>{feedback.text}</span>
        {feedback.type === 'success' && feedback.orderId && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onOpenTicket(feedback.orderId!)}
          >
            <Receipt size={15} />
            Ver / emitir comprobante
          </button>
        )}
      </div>
    </div>
  );

  const footerBar = (
    <div className="checkout-footer-bar">
      <div className="summary-bar" aria-live="polite">
        <span className="checkout-total"><span>Total</span> <strong>{formatMxnCurrency(totalCents)}</strong></span>
        {deferPayment ? (
          <strong>Por cobrar al entregar</strong>
        ) : freeCoverAll ? (
          <strong style={{ color: 'var(--success)' }}>Cubierto ($0.00)</strong>
        ) : isPartialMode && tender.ok ? (
          <strong style={{ color: paidCents > 0 ? 'var(--primary)' : 'var(--warning)' }}>
            {paidCents <= 0
              ? 'Captura el anticipo'
              : tender.remaining === 0
                ? 'Pago completo'
                : `Anticipo ${formatMxn(paidCents)} · Restan ${formatMxn(tender.remaining)}`}
          </strong>
        ) : tender.ok ? (
          <strong style={{ color: tender.remaining > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {tender.remaining > 0
              ? `Faltan ${formatMxn(tender.remaining)}`
              : tender.change > 0 ? `Cambio ${formatMxn(tender.change)}` : 'Monto completo'}
          </strong>
        ) : null}
      </div>

      <button
        type="submit"
        className="btn btn-primary btn-full checkout-submit-btn"
        disabled={!openShift || submitting || (!checkoutOrder && selectedItems.length === 0)}
      >
        {submitting ? 'Guardando…'
          : checkoutOrder ? 'Guardar cobro'
          : deferPayment ? 'Guardar encargo (por cobrar)'
          : isPartialMode && paidCents > 0 && paidCents < totalCents ? 'Guardar encargo con anticipo'
          : freeCoverAll ? 'Guardar orden'
          : 'Guardar orden y pago'}
      </button>
    </div>
  );

  if (checkoutOrder) {
    return (
      <section id="checkout-form" className="card pos-checkout-single" aria-labelledby="checkout-heading" data-active-payment="">
        <h2 id="checkout-heading" className="card-title" tabIndex={-1} aria-describedby="checkout-order-summary">
          <span>Cobro en curso</span>
        </h2>

        <div id="checkout-order-summary" className="checkout-active-order">
          <div className="checkout-order-identity">
            <strong>{checkoutOrder.folio}</strong>
            {checkoutOrder.customerAlias && <span>{checkoutOrder.customerAlias}</span>}
          </div>
          <div className="checkout-order-amount">
            <span>Importe a cobrar</span>
            <strong>{formatMxn(totalCents)}</strong>
          </div>
        </div>

        {!openShift && (
          <div className="alert alert-error">
            No hay turno abierto en {branchName}. Ve a <strong>Caja</strong> para abrir un turno antes de cobrar.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {paymentSection}
          {feedbackBanner}
          {footerBar}

          <button
            type="button"
            className="btn btn-secondary btn-full"
            style={{ marginTop: 8 }}
            onClick={() => {
              onCancelCheckout(true);
              resetPaymentInputs();
              onFeedback(null);
            }}
          >
            Cancelar cobro
          </button>
        </form>
        <div className="field" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="pos-machine-toggle"
            aria-expanded={showExtraDetails}
            onClick={() => setShowExtraDetails((prev) => !prev)}
          >
            <span className="pos-machine-toggle-left">
              <strong>Datos adicionales (entrega, peso, notas, descuento)</strong>
              {(weightInput || promisedDeliveryAt || discountInput || orderNotes) && (
                <span className="badge badge-info">Capturado</span>
              )}
            </span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              style={{
                transform: showExtraDetails ? 'rotate(180deg)' : undefined,
                transition: 'transform 0.15s ease',
              }}
            />
          </button>
          {showExtraDetails && (
            <div className="quick-customer-box" style={{ marginTop: 8 }}>
              <div className="quick-customer-inputs">
                <label className="field" style={{ marginBottom: 0 }}>
                  Peso aprox. (kg)
                  <input
                    className="input input-sm"
                    inputMode="decimal"
                    placeholder="Ej. 6.5"
                    value={weightInput}
                    onChange={(e) => setWeightInput(e.target.value)}
                  />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Entrega prometida
                  <input
                    className="input input-sm"
                    placeholder="Ej. Hoy 18:00"
                    value={promisedDeliveryAt}
                    onChange={(e) => setPromisedDeliveryAt(e.target.value)}
                    maxLength={40}
                  />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Descuento manual (MXN)
                  <input
                    className="input input-sm"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                  />
                </label>
              </div>
              <label className="field" style={{ marginBottom: 0 }}>
                Notas del pedido
                <input
                  className="input input-sm"
                  placeholder="Ej. Ropa delicada, sin suavizante…"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  maxLength={160}
                />
              </label>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <form id="checkout-form" className="pos-layout" onSubmit={handleSubmit} aria-labelledby="checkout-heading">
      <section className="card pos-builder">
        <h2 id="checkout-heading" className="card-title" tabIndex={-1}>
          <span>Nueva orden</span>
          <span className="badge badge-info">Próx. folio {suggestedFolio}</span>
        </h2>

        {!openShift && (
          <div className="alert alert-error">
            No hay turno abierto en {branchName}. Ve a <strong>Caja</strong> para abrir un turno antes de cobrar.
          </div>
        )}

        <div className="pos-top-grid">
          <div className="field">
            <span className="checkout-field-label" id="checkout-service-label">Tipo de servicio</span>
            <div className="segmented" role="group" aria-labelledby="checkout-service-label">
              <button
                type="button"
                className={`seg-btn ${serviceType === 'autoservicio' ? 'active' : ''}`}
                aria-pressed={serviceType === 'autoservicio'}
                onClick={() => setServiceType('autoservicio')}
              >
                Autoservicio
              </button>
              <button
                type="button"
                className={`seg-btn ${serviceType === 'encargo' ? 'active' : ''}`}
                aria-pressed={serviceType === 'encargo'}
                onClick={() => setServiceType('encargo')}
              >
                Encargo
              </button>
            </div>
          </div>

          <div className="field">
            <div className="catalog-head-row">
              <span className="checkout-field-label">Cliente y lealtad</span>
              <button
                type="button"
                className="ticket-fallback-link"
                aria-expanded={showNewCustomer}
                onClick={() => setShowNewCustomer((prev) => !prev)}
              >
                <UserPlus size={15} aria-hidden="true" />
                {showNewCustomer ? 'Cerrar alta' : 'Nuevo cliente'}
              </button>
            </div>

            <CustomSelect
              ariaLabel="Cliente para la orden"
              value={selectedCustomerId}
              options={[
                { value: '', label: 'Cobro rápido (sin ficha)' },
                ...customers.map((c) => ({
                  value: c.id,
                  label: `${c.name} (${c.combosTowardFree}/10${c.freeCombosAvailable > 0 ? ` · ${c.freeCombosAvailable} gratis` : ''})`,
                })),
              ]}
              onChange={(val) => {
                setSelectedCustomerId(val);
                setRedeemFreeCombo(false);
              }}
            />
          </div>
        </div>

        {selectedCustomer && (
          <div className="loyalty-inline-pill" style={{ marginTop: 0, marginBottom: 12 }}>
            <span>
              Lealtad: <strong>{selectedCustomer.combosTowardFree}/10 combos</strong>
              {selectedCustomer.freeCombosAvailable > 0
                ? ` · ¡Tiene ${selectedCustomer.freeCombosAvailable} combo(s) gratis!`
                : ''}
            </span>
          </div>
        )}

        {showNewCustomer && (
          <div className="quick-customer-box" style={{ marginTop: 0, marginBottom: 14 }}>
            <div className="quick-customer-inputs">
              <input
                className="input input-sm"
                aria-label="Nombre del cliente"
                placeholder="Nombre del cliente *"
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                maxLength={80}
              />
              <input
                className="input input-sm"
                type="tel"
                aria-label="Teléfono del cliente"
                inputMode="tel"
                placeholder="Teléfono 10 dígitos *"
                value={newCustPhone}
                onChange={(e) => setNewCustPhone(e.target.value)}
                maxLength={20}
              />
            </div>
            <div className="quick-customer-actions">
              <label className="checkbox-row" style={{ minHeight: 36, padding: '4px 10px' }}>
                <input
                  type="checkbox"
                  checked={newCustConsent}
                  onChange={(e) => setNewCustConsent(e.target.checked)}
                />
                Autoriza avisos por WhatsApp
              </label>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={savingCustomer}
                onClick={async () => {
                  setSavingCustomer(true);
                  const res = await onUpsertCustomer(branchId, {
                    name: newCustName,
                    phone: newCustPhone,
                    contactConsent: newCustConsent,
                  });
                  setSavingCustomer(false);
                  if (!res.ok) {
                    onFeedback({ type: 'error', text: res.error ?? 'No se pudo registrar el cliente.' });
                    return;
                  }
                  if (res.customer) {
                    setSelectedCustomerId(res.customer.id);
                  }
                  setNewCustName('');
                  setNewCustPhone('');
                  setNewCustConsent(false);
                  setShowNewCustomer(false);
                }}
              >
                Guardar ficha y seleccionar
              </button>
            </div>
          </div>
        )}

        {serviceType === 'encargo' && (
          <div className="field" style={{ display: 'grid', gap: 10 }}>
            <div>
              <label htmlFor="alias-input">Referencia de encargo *</label>
              <input
                id="alias-input"
                className="input"
                value={customerAlias}
                onChange={(e) => setCustomerAlias(e.target.value)}
                placeholder={selectedCustomer ? selectedCustomer.name : 'Ej. María López'}
              />
            </div>
            <div>
              <span className="checkout-field-label" id="encargo-timing-label">Modalidad de cobro</span>
              <div className="segmented segmented-3" role="group" aria-labelledby="encargo-timing-label">
                <button
                  type="button"
                  className={`seg-btn ${encargoPayTiming === 'full' ? 'active' : ''}`}
                  aria-pressed={encargoPayTiming === 'full'}
                  onClick={() => setEncargoPayTiming('full')}
                >
                  Pago completo
                </button>
                <button
                  type="button"
                  className={`seg-btn ${encargoPayTiming === 'partial' ? 'active' : ''}`}
                  aria-pressed={encargoPayTiming === 'partial'}
                  onClick={() => setEncargoPayTiming('partial')}
                >
                  Anticipo parcial
                </button>
                <button
                  type="button"
                  className={`seg-btn ${encargoPayTiming === 'defer' ? 'active' : ''}`}
                  aria-pressed={encargoPayTiming === 'defer'}
                  onClick={() => setEncargoPayTiming('defer')}
                >
                  Al recoger
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="field">
          <div className="catalog-head-row">
            <span className="checkout-field-label" id="checkout-catalog-label">Servicios y productos</span>
            {selectedItems.length > 0 && (
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                {selectedItems.reduce((sum, entry) => sum + entry.quantity, 0)} seleccionado(s)
              </span>
            )}
          </div>

          {(hasMachineItems && hasExtraItems) || activeCatalog.length >= 6 ? (
            <div className="pos-catalog-toolbar">
              {hasMachineItems && hasExtraItems && (
                <div className="filter-pills-bar" style={{ marginBottom: 0 }} role="group" aria-label="Categoría del catálogo">
                  {(
                    [
                      { id: 'todos', label: 'Todos' },
                      { id: 'servicios', label: 'Lavado / Secado' },
                      { id: 'extras', label: 'Insumos y extras' },
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`filter-pill${catalogCategory === cat.id ? ' active' : ''}`}
                      aria-pressed={catalogCategory === cat.id}
                      onClick={() => setCatalogCategory(cat.id)}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              )}
              {activeCatalog.length >= 6 && (
                <input
                  className="input input-sm pos-catalog-search"
                  aria-label="Filtrar catálogo"
                  placeholder="Filtrar producto o servicio…"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                />
              )}
            </div>
          ) : null}

          <div className="catalog-grid pos-catalog-grid" role="group" aria-labelledby="checkout-catalog-label">
            {visibleCatalog.map((item) => {
              const qty = quantities[item.id] ?? 0;
              return (
                <div key={item.id} className={`catalog-row ${qty > 0 ? 'selected' : ''}`}>
                  <button
                    type="button"
                    className="catalog-row-tap"
                    onClick={() => updateItemQuantity(item.id, 1)}
                    aria-label={`Agregar 1 ${item.name}`}
                  >
                    <div className="catalog-row-info">
                      <strong>{item.name}</strong>
                      <small>
                        {formatMxn(item.priceCents)} c/u
                        {item.pricePendingConfirmation ? ' · Ref.' : ''}
                      </small>
                    </div>
                  </button>
                  <div className="catalog-qty-controls">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm qty-btn"
                      onClick={() => updateItemQuantity(item.id, -1)}
                      disabled={qty === 0}
                      aria-label={`Quitar ${item.name}`}
                    >
                      <Minus size={14} />
                    </button>
                    <span className="qty-value" aria-live="polite">
                      {qty}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm qty-btn"
                      onClick={() => updateItemQuantity(item.id, 1)}
                      aria-label={`Agregar ${item.name}`}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {canRedeemFreeCombo && comboEntry && (
          <label className="checkbox-row field" style={{ border: '1px solid var(--success-border)', background: 'var(--success-soft)' }}>
            <input
              type="checkbox"
              checked={redeemFreeCombo}
              onChange={(event) => setRedeemFreeCombo(event.target.checked)}
            />
            <Gift size={16} aria-hidden="true" />
            Aplicar 1 combo gratis disponible (-{formatMxn(comboEntry.item.priceCents)}) y generar boleto rifa al completar
          </label>
        )}

        {needsMachine && washers.length > 0 && (
          <div className="field" style={{ marginBottom: 0 }}>
            <button
              type="button"
              className="pos-machine-toggle"
              aria-expanded={showMachinePicker}
              onClick={() => setShowMachinePicker((prev) => !prev)}
            >
              <span className="pos-machine-toggle-left">
                <strong>Asignar lavadora (opcional)</strong>
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  {selectedMachineIds.length > 0
                    ? `${selectedMachineIds.length} seleccionada(s)`
                    : `${availableWashersCount} de ${washers.length} disponible(s)`}
                </span>
              </span>
              <ChevronDown
                size={16}
                aria-hidden="true"
                style={{
                  transform: showMachinePicker ? 'rotate(180deg)' : undefined,
                  transition: 'transform 0.15s ease',
                }}
              />
            </button>
            {showMachinePicker && (
              <div className="machine-picker" style={{ marginTop: 8 }} role="group" aria-label="Lavadoras de la sucursal">
                {washers.map((machine) => {
                  const available = machine.status === 'disponible';
                  const active = selectedMachineIds.includes(machine.id);
                  return (
                    <button
                      key={machine.id}
                      type="button"
                      disabled={!available}
                      aria-pressed={active}
                      className={`machine-chip ${active ? 'active' : ''} status-${machine.status}`}
                      onClick={() => toggleMachine(machine.id)}
                    >
                      <strong>{machine.code}</strong>
                      <small>
                        {machine.status === 'disponible'
                          ? 'Disponible'
                          : machine.status === 'en_uso'
                            ? `En uso (${machine.currentOrderFolio ?? ''})`
                            : 'Fuera de serv.'}
                      </small>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="field" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="pos-machine-toggle"
            aria-expanded={showExtraDetails}
            onClick={() => setShowExtraDetails((prev) => !prev)}
          >
            <span className="pos-machine-toggle-left">
              <strong>Datos adicionales (entrega, peso, notas, descuento)</strong>
              {(weightInput || promisedDeliveryAt || discountInput || orderNotes) && (
                <span className="badge badge-info">Capturado</span>
              )}
            </span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              style={{
                transform: showExtraDetails ? 'rotate(180deg)' : undefined,
                transition: 'transform 0.15s ease',
              }}
            />
          </button>
          {showExtraDetails && (
            <div className="quick-customer-box" style={{ marginTop: 8 }}>
              <div className="quick-customer-inputs">
                <label className="field" style={{ marginBottom: 0 }}>
                  Peso aprox. (kg)
                  <input
                    className="input input-sm"
                    inputMode="decimal"
                    placeholder="Ej. 6.5"
                    value={weightInput}
                    onChange={(e) => setWeightInput(e.target.value)}
                  />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Entrega prometida
                  <input
                    className="input input-sm"
                    placeholder="Ej. Hoy 18:00"
                    value={promisedDeliveryAt}
                    onChange={(e) => setPromisedDeliveryAt(e.target.value)}
                    maxLength={40}
                  />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  Descuento manual (MXN)
                  <input
                    className="input input-sm"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                  />
                </label>
              </div>
              <label className="field" style={{ marginBottom: 0 }}>
                Notas del pedido
                <input
                  className="input input-sm"
                  placeholder="Ej. Ropa delicada, sin suavizante…"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  maxLength={160}
                />
              </label>
            </div>
          )}
        </div>
      </section>

      <aside className="card pos-payment-col" aria-label="Resumen y pago">
        <h3 className="card-title pos-payment-title">
          <span>Resumen y pago</span>
          <div className="card-title-actions">
            {selectedItems.length > 0 && (
              <button
                type="button"
                className="ticket-fallback-link"
                onClick={() => {
                  setQuantities({});
                  setRedeemFreeCombo(false);
                  setSelectedMachineIds([]);
                  onFeedback(null);
                }}
              >
                <Trash2 size={13} aria-hidden="true" /> Vaciar
              </button>
            )}
            <span className="badge badge-info">{serviceType === 'encargo' ? 'Encargo' : 'Autoservicio'}</span>
          </div>
        </h3>

        <div className="pos-summary-box">
          {selectedItems.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
              Agrega servicios del catálogo para calcular el total.
            </p>
          ) : (
            <ul className="pos-summary-list">
              {selectedItems.map(({ item, quantity }) => (
                <li key={item.id}>
                  <span>
                    <strong>{quantity}×</strong> {item.name}
                  </span>
                  <span>{formatMxn(item.priceCents * quantity)}</span>
                </li>
              ))}
              {loyaltyDiscountCents > 0 && (
                <li className="pos-summary-discount">
                  <span>Combo gratis (lealtad)</span>
                  <span>-{formatMxn(loyaltyDiscountCents)}</span>
                </li>
              )}
              {manualDiscountCents > 0 && (
                <li className="pos-summary-discount">
                  <span>Descuento aplicado</span>
                  <span>-{formatMxn(manualDiscountCents)}</span>
                </li>
              )}
            </ul>
          )}
        </div>

        {paymentSection}
        {feedbackBanner}
        {footerBar}
      </aside>
    </form>
  );
}
